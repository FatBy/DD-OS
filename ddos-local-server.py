#!/usr/bin/env python3
"""
DD-OS Native Server v3.0
独立运行的本地 AI 操作系统后端

功能:
    - 文件操作 (读/写/列目录)
    - 命令执行 (Shell)
    - 任务管理 (后台执行)
    - 记忆持久化

用法:
    python ddos-local-server.py [--port 3001] [--path ~/clawd]

API:
    GET  /status              - 服务状态
    GET  /files               - 列出所有文件
    GET  /file/<name>         - 获取文件内容
    GET  /skills              - 获取技能列表
    GET  /memories            - 获取记忆数据
    GET  /all                 - 获取所有数据
    POST /api/tools/execute   - 执行工具 (新)
    POST /task/execute        - 执行任务 (兼容旧接口)
    GET  /task/status/<id>    - 查询任务状态
"""

import os
import sys
import json
import argparse
import threading
import time
import uuid
import subprocess
import shlex
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs
from datetime import datetime

VERSION = "3.0.0"

# 🛡️ 安全配置
ALLOWED_TOOLS = {'readFile', 'writeFile', 'listDir', 'runCmd', 'appendFile', 'weather', 'webSearch'}
DANGEROUS_COMMANDS = {'rm -rf /', 'format', 'mkfs', 'dd if=/dev/zero'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB 最大文件大小
MAX_OUTPUT_SIZE = 512 * 1024      # 512KB 最大输出


class ClawdDataHandler(BaseHTTPRequestHandler):
    clawd_path = None
    tasks = {}
    tasks_lock = threading.Lock()
    
    def log_message(self, format, *args):
        timestamp = datetime.now().strftime('%H:%M:%S')
        print(f"[{timestamp}] {format % args}")
    
    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))
    
    def send_text(self, text, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(text.encode('utf-8'))
    
    def send_error_json(self, message, status=404):
        self.send_json({'error': message, 'status': 'error'}, status)
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        
        routes = {
            '/status': self.handle_status,
            '/files': self.handle_files,
            '/skills': self.handle_skills,
            '/memories': self.handle_memories,
            '/all': self.handle_all,
            '/': self.handle_index,
            '': self.handle_index,
        }
        
        if path in routes:
            routes[path]()
        elif path.startswith('/file/'):
            self.handle_file(path[6:])
        elif path.startswith('/task/status/'):
            task_id = path[13:]
            offset = int(query.get('offset', ['0'])[0])
            self.handle_task_status(task_id, offset)
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_error_json('Invalid JSON', 400)
            return
        
        # 🌟 新增：工具执行接口
        if path == '/api/tools/execute':
            self.handle_tool_execution(data)
        elif path == '/task/execute':
            self.handle_task_execute(data)
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    # ============================================
    # 🛠️ 工具执行 (核心新功能)
    # ============================================
    
    def handle_tool_execution(self, data):
        """处理工具调用请求"""
        tool_name = data.get('name', '')
        args = data.get('args', {})
        
        if tool_name not in ALLOWED_TOOLS:
            self.send_json({
                'tool': tool_name,
                'status': 'error',
                'result': f'Tool not allowed: {tool_name}. Allowed: {", ".join(ALLOWED_TOOLS)}'
            }, 403)
            return
        
        result = ""
        status = "success"
        
        try:
            # 1. 读取文件
            if tool_name == 'readFile':
                result = self._tool_read_file(args)
            
            # 2. 写入文件
            elif tool_name == 'writeFile':
                result = self._tool_write_file(args)
            
            # 3. 追加文件
            elif tool_name == 'appendFile':
                result = self._tool_append_file(args)
            
            # 4. 列出目录
            elif tool_name == 'listDir':
                result = self._tool_list_dir(args)
            
            # 5. 执行命令 (⚠️ 高危)
            elif tool_name == 'runCmd':
                result = self._tool_run_cmd(args)
            
            # 6. 天气查询 (OpenClaw weather skill)
            elif tool_name == 'weather':
                result = self._tool_weather(args)
            
            # 7. 网页搜索
            elif tool_name == 'webSearch':
                result = self._tool_web_search(args)
        
        except Exception as e:
            status = "error"
            result = f"Tool execution failed: {str(e)}"
        
        self.send_json({
            'tool': tool_name,
            'status': status,
            'result': result,
            'timestamp': datetime.now().isoformat()
        })
    
    def _resolve_path(self, relative_path: str, allow_outside: bool = False) -> Path:
        """解析并验证路径安全性"""
        if not relative_path:
            raise ValueError("Path cannot be empty")
        
        # 移除开头的斜杠
        clean_path = relative_path.lstrip('/')
        
        # 默认在 clawd 目录下操作
        if allow_outside and os.path.isabs(relative_path):
            file_path = Path(relative_path)
        else:
            file_path = self.clawd_path / clean_path
        
        # 安全检查：防止路径遍历
        try:
            resolved = file_path.resolve()
            if not allow_outside:
                resolved.relative_to(self.clawd_path.resolve())
        except ValueError:
            raise PermissionError(f"Access denied: path outside allowed directory")
        
        return resolved
    
    def _tool_read_file(self, args: dict) -> str:
        """读取文件内容"""
        path = args.get('path', '')
        file_path = self._resolve_path(path, allow_outside=args.get('allowOutside', False))
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        if not file_path.is_file():
            raise ValueError(f"Not a file: {path}")
        if file_path.stat().st_size > MAX_FILE_SIZE:
            raise ValueError(f"File too large (>{MAX_FILE_SIZE} bytes)")
        
        return file_path.read_text(encoding='utf-8')
    
    def _tool_write_file(self, args: dict) -> str:
        """写入文件"""
        path = args.get('path', '')
        content = args.get('content', '')
        
        file_path = self._resolve_path(path)
        
        # 确保父目录存在
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        file_path.write_text(content, encoding='utf-8')
        return f"Written {len(content)} bytes to {file_path.name}"
    
    def _tool_append_file(self, args: dict) -> str:
        """追加内容到文件"""
        path = args.get('path', '')
        content = args.get('content', '')
        
        file_path = self._resolve_path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(content)
        
        return f"Appended {len(content)} bytes to {file_path.name}"
    
    def _tool_list_dir(self, args: dict) -> str:
        """列出目录内容"""
        path = args.get('path', '.')
        dir_path = self._resolve_path(path)
        
        if not dir_path.exists():
            raise FileNotFoundError(f"Directory not found: {path}")
        if not dir_path.is_dir():
            raise ValueError(f"Not a directory: {path}")
        
        items = []
        for item in sorted(dir_path.iterdir()):
            item_type = 'dir' if item.is_dir() else 'file'
            size = item.stat().st_size if item.is_file() else 0
            items.append({
                'name': item.name,
                'type': item_type,
                'size': size
            })
        
        return json.dumps(items, ensure_ascii=False)
    
    def _tool_run_cmd(self, args: dict) -> str:
        """执行 Shell 命令 (⚠️ 高危操作)"""
        command = args.get('command', '')
        cwd = args.get('cwd', str(self.clawd_path))
        timeout = min(args.get('timeout', 60), 300)  # 最大 5 分钟
        
        if not command:
            raise ValueError("Command cannot be empty")
        
        # 安全检查
        cmd_lower = command.lower()
        for dangerous in DANGEROUS_COMMANDS:
            if dangerous in cmd_lower:
                raise PermissionError(f"Dangerous command blocked: {command}")
        
        try:
            process = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            stdout = process.stdout[:MAX_OUTPUT_SIZE] if process.stdout else ''
            stderr = process.stderr[:MAX_OUTPUT_SIZE] if process.stderr else ''
            
            result_parts = []
            if stdout:
                result_parts.append(f"STDOUT:\n{stdout}")
            if stderr:
                result_parts.append(f"STDERR:\n{stderr}")
            result_parts.append(f"Exit Code: {process.returncode}")
            
            return '\n'.join(result_parts)
        
        except subprocess.TimeoutExpired:
            return f"Command timed out after {timeout}s"
    
    def _tool_weather(self, args: dict) -> str:
        """查询天气 (基于 OpenClaw weather skill)"""
        import urllib.request
        import urllib.parse
        
        location = args.get('location', args.get('city', ''))
        if not location:
            raise ValueError("Location/city is required")
        
        # 使用 wttr.in API (无需 API Key)
        encoded_location = urllib.parse.quote(location)
        
        try:
            # 获取详细天气信息
            url = f"https://wttr.in/{encoded_location}?format=j1"
            req = urllib.request.Request(url, headers={'User-Agent': 'curl/7.68.0'})
            
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode('utf-8'))
            
            current = data.get('current_condition', [{}])[0]
            area = data.get('nearest_area', [{}])[0]
            
            # 格式化输出
            city_name = area.get('areaName', [{}])[0].get('value', location)
            country = area.get('country', [{}])[0].get('value', '')
            
            result = f"""天气查询结果 - {city_name}, {country}

当前温度: {current.get('temp_C', 'N/A')}°C (体感: {current.get('FeelsLikeC', 'N/A')}°C)
天气状况: {current.get('weatherDesc', [{}])[0].get('value', 'N/A')}
湿度: {current.get('humidity', 'N/A')}%
风速: {current.get('windspeedKmph', 'N/A')} km/h ({current.get('winddir16Point', '')})
能见度: {current.get('visibility', 'N/A')} km
紫外线指数: {current.get('uvIndex', 'N/A')}
"""
            return result
            
        except Exception as e:
            # 降级方案：使用简单格式
            try:
                simple_url = f"https://wttr.in/{encoded_location}?format=%l:+%c+%t+(%f)+%h+%w"
                req = urllib.request.Request(simple_url, headers={'User-Agent': 'curl/7.68.0'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.read().decode('utf-8')
            except:
                return f"无法查询 {location} 的天气: {str(e)}"
    
    def _tool_web_search(self, args: dict) -> str:
        """网页搜索 (使用 DuckDuckGo HTML)"""
        import urllib.request
        import urllib.parse
        import re
        
        query = args.get('query', args.get('q', ''))
        if not query:
            raise ValueError("Search query is required")
        
        encoded_query = urllib.parse.quote(query)
        
        try:
            # 使用 DuckDuckGo HTML 版本
            url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            
            with urllib.request.urlopen(req, timeout=15) as response:
                html = response.read().decode('utf-8')
            
            # 提取搜索结果
            results = []
            # 匹配结果链接和标题
            pattern = r'<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)</a>'
            matches = re.findall(pattern, html)
            
            for i, (link, title) in enumerate(matches[:5]):  # 取前5个结果
                # 清理 DuckDuckGo 重定向链接
                if 'uddg=' in link:
                    actual_link = urllib.parse.unquote(link.split('uddg=')[-1].split('&')[0])
                else:
                    actual_link = link
                results.append(f"{i+1}. {title.strip()}\n   {actual_link}")
            
            if results:
                return f"搜索 '{query}' 的结果:\n\n" + "\n\n".join(results)
            else:
                return f"未找到 '{query}' 的相关结果"
                
        except Exception as e:
            return f"搜索失败: {str(e)}"
    
    # ============================================
    # 原有处理器 (保持兼容)
    # ============================================
    
    def handle_index(self):
        html = f"""<!DOCTYPE html>
<html>
<head><title>DD-OS Native Server</title></head>
<body style="font-family: monospace; background: #0f172a; color: #e2e8f0; padding: 30px;">
<h1>DD-OS Native Server v{VERSION}</h1>
<p style="color: #94a3b8;">独立运行的本地 AI 操作系统后端</p>
<p>Clawd Path: <code style="color: #22d3ee;">{self.clawd_path}</code></p>

<h2>📡 API Endpoints</h2>
<div style="background: #1e293b; padding: 15px; border-radius: 8px;">
<h3 style="color: #f59e0b;">数据读取</h3>
<ul>
<li><a href="/status" style="color: #60a5fa;">/status</a> - 服务状态</li>
<li><a href="/files" style="color: #60a5fa;">/files</a> - 文件列表</li>
<li><a href="/file/SOUL.md" style="color: #60a5fa;">/file/SOUL.md</a> - 读取 SOUL</li>
<li><a href="/skills" style="color: #60a5fa;">/skills</a> - 技能列表</li>
<li><a href="/all" style="color: #60a5fa;">/all</a> - 所有数据</li>
</ul>

<h3 style="color: #10b981;">🛠️ 工具执行 (POST)</h3>
<ul>
<li><code>/api/tools/execute</code> - 执行工具</li>
<li>支持: readFile, writeFile, listDir, runCmd, appendFile</li>
</ul>
</div>

<h2>🧪 测试</h2>
<pre style="background: #1e293b; padding: 15px; border-radius: 8px; overflow-x: auto;">
curl -X POST http://localhost:3001/api/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '{{"name": "listDir", "args": {{"path": "."}}}}'
</pre>
</body>
</html>"""
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))
    
    def handle_status(self):
        files = list_files(self.clawd_path)
        skills_dir = self.clawd_path / 'skills'
        skill_count = len(list(skills_dir.iterdir())) if skills_dir.exists() else 0
        
        self.send_json({
            'status': 'ok',
            'version': VERSION,
            'mode': 'native',
            'clawdPath': str(self.clawd_path),
            'fileCount': len(files),
            'skillCount': skill_count,
            'tools': list(ALLOWED_TOOLS),
            'timestamp': datetime.now().isoformat()
        })
    
    def handle_files(self):
        files = list_files(self.clawd_path)
        self.send_json(files)
    
    def handle_file(self, filename):
        filepath = self.clawd_path / filename
        if not filepath.exists():
            self.send_error_json(f'File not found: {filename}', 404)
            return
        
        if not filepath.is_file():
            self.send_error_json(f'Not a file: {filename}', 400)
            return
        
        try:
            filepath.resolve().relative_to(self.clawd_path.resolve())
        except ValueError:
            self.send_error_json('Access denied', 403)
            return
        
        try:
            content = filepath.read_text(encoding='utf-8')
            self.send_text(content)
        except Exception as e:
            self.send_error_json(f'Read error: {str(e)}', 500)
    
    def handle_skills(self):
        skills = []
        skills_dir = self.clawd_path / 'skills'
        
        if skills_dir.exists() and skills_dir.is_dir():
            for item in skills_dir.iterdir():
                if item.is_dir():
                    skill_md = item / 'SKILL.md'
                    description = ''
                    if skill_md.exists():
                        try:
                            content = skill_md.read_text(encoding='utf-8')
                            for line in content.split('\n'):
                                line = line.strip()
                                if line and not line.startswith('#'):
                                    description = line[:100]
                                    break
                        except:
                            pass
                    
                    skills.append({
                        'name': item.name,
                        'description': description,
                        'location': 'local',
                        'path': str(item),
                        'status': 'active',
                        'enabled': True,
                    })
        
        self.send_json(skills)
    
    def handle_memories(self):
        memories = []
        
        memory_md = self.clawd_path / 'MEMORY.md'
        if memory_md.exists():
            try:
                content = memory_md.read_text(encoding='utf-8')
                memories.extend(parse_memory_md(content))
            except:
                pass
        
        memory_dir = self.clawd_path / 'memory'
        if memory_dir.exists() and memory_dir.is_dir():
            for item in memory_dir.iterdir():
                if item.is_file() and item.suffix == '.md':
                    try:
                        content = item.read_text(encoding='utf-8')
                        memories.append({
                            'id': f'file-{item.stem}',
                            'title': item.stem.replace('-', ' ').replace('_', ' ').title(),
                            'content': content[:500],
                            'type': 'long-term',
                            'timestamp': item.stat().st_mtime,
                            'tags': [],
                        })
                    except:
                        pass
        
        self.send_json(memories)
    
    def handle_all(self):
        data = {
            'soul': None,
            'identity': None,
            'skills': [],
            'memories': [],
            'files': list_files(self.clawd_path),
        }
        
        soul_path = self.clawd_path / 'SOUL.md'
        if soul_path.exists():
            try:
                data['soul'] = soul_path.read_text(encoding='utf-8')
            except:
                pass
        
        identity_path = self.clawd_path / 'IDENTITY.md'
        if identity_path.exists():
            try:
                data['identity'] = identity_path.read_text(encoding='utf-8')
            except:
                pass
        
        skills_dir = self.clawd_path / 'skills'
        if skills_dir.exists():
            for item in skills_dir.iterdir():
                if item.is_dir():
                    data['skills'].append({
                        'name': item.name,
                        'location': 'local',
                        'status': 'active',
                        'enabled': True,
                    })
        
        memory_md = self.clawd_path / 'MEMORY.md'
        if memory_md.exists():
            try:
                content = memory_md.read_text(encoding='utf-8')
                data['memories'] = parse_memory_md(content)
            except:
                pass
        
        self.send_json(data)
    
    def handle_task_execute(self, data):
        """兼容旧的任务执行接口"""
        prompt = data.get('prompt', '').strip()
        if not prompt:
            self.send_error_json('Missing prompt', 400)
            return
        
        task_id = str(uuid.uuid4())[:8]
        
        thread = threading.Thread(
            target=run_task_in_background,
            args=(task_id, prompt, self.clawd_path),
            daemon=True,
        )
        thread.start()
        
        self.send_json({
            'taskId': task_id,
            'status': 'running',
        })
    
    def handle_task_status(self, task_id, offset=0):
        with self.tasks_lock:
            task = self.tasks.get(task_id)
        
        if not task:
            self.send_error_json(f'Task not found: {task_id}', 404)
            return
        
        log_path = task.get('logPath')
        content = ''
        new_offset = offset
        has_more = False
        file_size = task.get('fileSize', 0)
        
        if log_path:
            content, new_offset, has_more = read_log_chunk(log_path, offset)
            try:
                file_size = Path(log_path).stat().st_size
            except:
                pass
        
        self.send_json({
            'taskId': task_id,
            'status': task['status'],
            'content': content,
            'offset': new_offset,
            'hasMore': has_more,
            'fileSize': file_size,
        })


# ============================================
# 辅助函数
# ============================================

def list_files(clawd_path):
    files = []
    try:
        for item in clawd_path.iterdir():
            if item.is_file():
                files.append(item.name)
    except:
        pass
    return sorted(files)


def parse_memory_md(content):
    memories = []
    sections = content.split('## ')
    
    for i, section in enumerate(sections[1:], 1):
        lines = section.strip().split('\n')
        if not lines:
            continue
        
        title = lines[0].strip()
        body = '\n'.join(lines[1:]).strip()
        
        if title:
            memories.append({
                'id': f'memory-{i}',
                'title': title,
                'content': body[:500] if body else title,
                'type': 'long-term',
                'timestamp': None,
                'tags': [],
            })
    
    return memories


def read_log_chunk(log_path, offset=0, max_bytes=51200):
    path = Path(log_path)
    if not path.exists():
        return ('', offset, False)
    
    try:
        file_size = path.stat().st_size
    except:
        return ('', offset, False)
    
    if offset >= file_size:
        return ('', offset, False)
    
    try:
        with open(path, 'rb') as f:
            f.seek(offset)
            raw = f.read(max_bytes)
        
        content = raw.decode('utf-8', errors='replace')
        new_offset = offset + len(raw)
        has_more = new_offset < file_size
        return (content, new_offset, has_more)
    except Exception as e:
        return (f'[日志读取错误: {e}]', offset, False)


def run_task_in_background(task_id, prompt, clawd_path):
    logs_dir = clawd_path / 'logs'
    logs_dir.mkdir(exist_ok=True)
    log_file = logs_dir / f"{task_id}.log"
    
    with ClawdDataHandler.tasks_lock:
        ClawdDataHandler.tasks[task_id] = {
            'taskId': task_id,
            'status': 'running',
            'logPath': str(log_file),
            'fileSize': 0,
        }
    
    try:
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(f"Task: {prompt}\n")
            f.write(f"Started: {datetime.now().isoformat()}\n")
            f.write("-" * 50 + "\n\n")
        
        # 尝试运行 clawdbot，如果不存在则模拟
        try:
            with open(log_file, 'ab') as f:
                process = subprocess.Popen(
                    ['clawdbot', 'agent', '--agent', 'main', '--message', prompt],
                    cwd=str(clawd_path),
                    stdout=f,
                    stderr=subprocess.STDOUT,
                )
                
                start_time = time.time()
                timeout = 300
                
                while process.poll() is None:
                    time.sleep(0.5)
                    try:
                        with ClawdDataHandler.tasks_lock:
                            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
                    except:
                        pass
                    
                    if time.time() - start_time > timeout:
                        process.kill()
                        process.wait()
                        with ClawdDataHandler.tasks_lock:
                            ClawdDataHandler.tasks[task_id]['status'] = 'error'
                            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
                        with open(log_file, 'a', encoding='utf-8') as ef:
                            ef.write(f'\n\n[错误] 任务执行超时 ({timeout}s)\n')
                        return
                
                process.wait()
            
            with ClawdDataHandler.tasks_lock:
                ClawdDataHandler.tasks[task_id]['status'] = 'done' if process.returncode == 0 else 'error'
                ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
        
        except FileNotFoundError:
            # clawdbot 不存在，使用 Native 模式提示
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write("\n[DD-OS Native] clawdbot 未安装。\n")
                f.write("在 Native 模式下，请使用 /api/tools/execute 接口直接执行工具。\n")
                f.write("\n任务已记录，等待 AI 引擎处理。\n")
            
            with ClawdDataHandler.tasks_lock:
                ClawdDataHandler.tasks[task_id]['status'] = 'done'
                ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
    
    except Exception as e:
        with open(log_file, 'a', encoding='utf-8') as ef:
            ef.write(f'\n\n[错误] {str(e)}\n')
        with ClawdDataHandler.tasks_lock:
            ClawdDataHandler.tasks[task_id]['status'] = 'error'
            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size


def cleanup_old_logs(clawd_path, max_age_hours=24):
    logs_dir = clawd_path / 'logs'
    if not logs_dir.exists():
        return
    
    now = time.time()
    count = 0
    for f in logs_dir.glob('*.log'):
        try:
            age = now - f.stat().st_mtime
            if age > max_age_hours * 3600:
                f.unlink()
                count += 1
        except:
            pass
    
    if count > 0:
        print(f"[Cleanup] Removed {count} old log files")


def main():
    parser = argparse.ArgumentParser(description='DD-OS Native Server')
    parser.add_argument('--port', type=int, default=3001, help='Server port (default: 3001)')
    parser.add_argument('--path', type=str, default='~/clawd', help='Data directory path (default: ~/clawd)')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Server host (default: 0.0.0.0)')
    args = parser.parse_args()
    
    clawd_path = Path(args.path).expanduser().resolve()
    
    if not clawd_path.exists():
        print(f"Creating data directory: {clawd_path}")
        clawd_path.mkdir(parents=True, exist_ok=True)
        
        # 创建默认 SOUL.md
        soul_file = clawd_path / 'SOUL.md'
        soul_file.write_text("""# DD-OS Native Soul

You are DD-OS, a local AI operating system running directly on the user's computer.

## Core Principles
- Be helpful and efficient
- Protect user data and privacy
- Execute tasks safely
- Learn from interactions

## Available Tools
- readFile: Read file contents
- writeFile: Write file contents
- listDir: List directory contents
- runCmd: Execute shell commands

## Safety Rules
- Never delete system files
- Ask before destructive operations
- Keep execution logs
""", encoding='utf-8')
        print(f"Created default SOUL.md")
    
    logs_dir = clawd_path / 'logs'
    logs_dir.mkdir(exist_ok=True)
    
    memory_dir = clawd_path / 'memory'
    memory_dir.mkdir(exist_ok=True)
    
    cleanup_old_logs(clawd_path)
    
    ClawdDataHandler.clawd_path = clawd_path
    
    server = HTTPServer((args.host, args.port), ClawdDataHandler)
    
    print(f"""
+==================================================================+
|              DD-OS Native Server v{VERSION}                         |
+==================================================================+
|  Mode:    NATIVE (standalone, no OpenClaw needed)                |
|  Server:  http://{args.host}:{args.port}                                    |
|  Data:    {str(clawd_path)[:50]:<50} |
+------------------------------------------------------------------+
|  Tools: readFile, writeFile, listDir, runCmd, appendFile         |
|  API:   /api/tools/execute (POST)                                |
+==================================================================+
    """)
    
    print(f"Press Ctrl+C to stop\n")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
