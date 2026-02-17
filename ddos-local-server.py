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

VERSION = "4.0.0"

# 🛡️ 安全配置
DANGEROUS_COMMANDS = {'rm -rf /', 'format', 'mkfs', 'dd if=/dev/zero'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB 最大文件大小
MAX_OUTPUT_SIZE = 512 * 1024      # 512KB 最大输出
PLUGIN_TIMEOUT = 60               # 插件执行超时(秒)


# ============================================
# 🔌 动态工具注册表
# ============================================

class ToolRegistry:
    """动态工具发现与注册 - 支持内置工具 + 插件工具"""

    def __init__(self, clawd_path: Path):
        self.clawd_path = clawd_path
        self.builtin_tools: dict = {}      # name -> callable
        self.plugin_tools: dict = {}       # name -> ToolSpec dict

    def register_builtin(self, name: str, handler):
        """注册内置工具"""
        self.builtin_tools[name] = handler

    def scan_plugins(self):
        """扫描 skills/ 目录，自动注册有 manifest.json 的插件工具"""
        skills_dir = self.clawd_path / 'skills'
        if not skills_dir.exists():
            return

        found = 0
        for item in skills_dir.iterdir():
            if not item.is_dir():
                continue
            manifest_path = item / 'manifest.json'
            if not manifest_path.exists():
                continue
            try:
                spec = json.loads(manifest_path.read_text(encoding='utf-8'))
                
                # 支持两种 manifest 格式:
                # 1. 新格式: { "tools": [{ "toolName": "...", ... }, ...] }
                # 2. 旧格式: { "toolName": "...", ... }
                
                tools_list = spec.get('tools', [])
                if not tools_list:
                    # 旧格式: 单个工具定义
                    tools_list = [spec]
                
                for tool_spec in tools_list:
                    tool_name = tool_spec.get('toolName', '')
                    executable = tool_spec.get('executable', spec.get('executable', 'execute.py'))
                    
                    if not tool_name:
                        continue

                    exe_path = item / executable
                    if not exe_path.exists():
                        print(f"[ToolRegistry] Warning: {exe_path} not found, skipping {tool_name}")
                        continue

                    # 内置工具不可被覆盖
                    if tool_name in self.builtin_tools:
                        print(f"[ToolRegistry] Warning: plugin '{tool_name}' conflicts with builtin, skipping")
                        continue

                    self.plugin_tools[tool_name] = {
                        'name': tool_name,
                        'exe_path': str(exe_path),
                        'runtime': tool_spec.get('runtime', spec.get('runtime', 'python')),
                        'inputs': tool_spec.get('inputs', {}),
                        'outputs': tool_spec.get('outputs', {}),
                        'description': tool_spec.get('description', ''),
                        'dangerLevel': tool_spec.get('dangerLevel', 'safe'),
                        'version': tool_spec.get('version', spec.get('version', '1.0.0')),
                        'skill_dir': str(item),
                        'keywords': tool_spec.get('keywords', []),
                    }
                    found += 1
                    print(f"[ToolRegistry] Registered plugin: {tool_name} ({exe_path.name})")
                    
            except Exception as e:
                print(f"[ToolRegistry] Error loading {manifest_path}: {e}")

        if found > 0:
            print(f"[ToolRegistry] {found} plugin tool(s) registered")

    def is_registered(self, name: str) -> bool:
        return name in self.builtin_tools or name in self.plugin_tools

    def get_plugin(self, name: str) -> dict | None:
        return self.plugin_tools.get(name)

    def list_all(self) -> list:
        """返回所有已注册工具（内置+插件）"""
        tools = []
        for name in self.builtin_tools:
            tools.append({'name': name, 'type': 'builtin'})
        for name, spec in self.plugin_tools.items():
            tools.append({
                'name': name,
                'type': 'plugin',
                'description': spec.get('description', ''),
                'inputs': spec.get('inputs', {}),
                'dangerLevel': spec.get('dangerLevel', 'safe'),
                'version': spec.get('version', '1.0.0'),
            })
        return tools


class ClawdDataHandler(BaseHTTPRequestHandler):
    clawd_path = None
    registry = None  # type: ToolRegistry
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
            '/tools': self.handle_tools_list,
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
        elif path == '/api/traces/search':
            self.handle_trace_search(query)
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
        elif path == '/tools/reload':
            self.handle_tools_reload(data)
        elif path == '/api/traces/save':
            self.handle_trace_save(data)
        elif path == '/task/execute':
            self.handle_task_execute(data)
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    # ============================================
    # 🛠️ 工具执行 (核心新功能)
    # ============================================
    
    def handle_tool_execution(self, data):
        """处理工具调用请求 - 支持内置工具和插件工具"""
        tool_name = data.get('name', '')
        args = data.get('args', {})

        if not self.registry.is_registered(tool_name):
            all_tools = [t['name'] for t in self.registry.list_all()]
            self.send_json({
                'tool': tool_name,
                'status': 'error',
                'result': f'Tool not registered: {tool_name}. Available: {", ".join(all_tools)}'
            }, 403)
            return

        result = ""
        status = "success"

        try:
            # 优先检查插件工具
            plugin_spec = self.registry.get_plugin(tool_name)
            if plugin_spec:
                result = self._execute_plugin_tool(plugin_spec, tool_name, args)
            else:
                # 内置工具调度
                builtin_handlers = {
                    'readFile': self._tool_read_file,
                    'writeFile': self._tool_write_file,
                    'appendFile': self._tool_append_file,
                    'listDir': self._tool_list_dir,
                    'runCmd': self._tool_run_cmd,
                    'weather': self._tool_weather,
                    'webSearch': self._tool_web_search,
                    'saveMemory': self._tool_save_memory,
                    'searchMemory': self._tool_search_memory,
                }
                handler = builtin_handlers.get(tool_name)
                if handler:
                    result = handler(args)
                else:
                    raise ValueError(f"No handler for builtin tool: {tool_name}")

        except Exception as e:
            status = "error"
            result = f"Tool execution failed: {str(e)}"

        self.send_json({
            'tool': tool_name,
            'status': status,
            'result': result,
            'timestamp': datetime.now().isoformat()
        })

    def _execute_plugin_tool(self, spec: dict, tool_name: str, args: dict) -> str:
        """执行插件工具 - subprocess 隔离执行"""
        exe_path = spec['exe_path']
        runtime = spec.get('runtime', 'python')

        # 确定运行时命令
        if runtime == 'python':
            cmd = [sys.executable, exe_path]
        elif runtime == 'node':
            cmd = ['node', exe_path]
        else:
            raise ValueError(f"Unsupported runtime: {runtime}")

        # 构建输入：包含工具名和参数（支持多工具 manifest）
        input_data = json.dumps({
            'tool': tool_name,
            'args': args
        }, ensure_ascii=False)

        try:
            process = subprocess.run(
                cmd,
                input=input_data,
                capture_output=True,
                text=True,
                timeout=PLUGIN_TIMEOUT,
                cwd=spec.get('skill_dir', str(self.clawd_path)),
            )

            if process.returncode != 0:
                stderr = process.stderr[:MAX_OUTPUT_SIZE] if process.stderr else ''
                raise RuntimeError(f"Plugin exited with code {process.returncode}: {stderr}")

            return process.stdout[:MAX_OUTPUT_SIZE] if process.stdout else ''

        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Plugin timed out after {PLUGIN_TIMEOUT}s")
    
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
    
    def _tool_save_memory(self, args: dict) -> str:
        """保存记忆到文件"""
        key = args.get('key', '')
        content = args.get('content', '')
        memory_type = args.get('type', 'general')
        
        if not key or not content:
            raise ValueError("key 和 content 参数必填")
        
        # 记忆存储在 memory 目录下
        memory_dir = self.clawd_path / 'memory'
        memory_dir.mkdir(parents=True, exist_ok=True)
        
        # 按日期组织记忆文件
        today = datetime.now().strftime('%Y-%m-%d')
        memory_file = memory_dir / f'{today}.md'
        
        # 格式化记忆条目
        timestamp = datetime.now().strftime('%H:%M:%S')
        entry = f"\n## [{timestamp}] {key}\n- **类型**: {memory_type}\n- **内容**: {content}\n"
        
        # 追加到记忆文件
        with open(memory_file, 'a', encoding='utf-8') as f:
            f.write(entry)
        
        return f"记忆已保存: {key} (类型: {memory_type})"
    
    def _tool_search_memory(self, args: dict) -> str:
        """检索历史记忆"""
        query = args.get('query', '')
        
        if not query:
            raise ValueError("query 参数必填")
        
        memory_dir = self.clawd_path / 'memory'
        if not memory_dir.exists():
            return "记忆库为空，暂无历史记忆。"
        
        results = []
        query_lower = query.lower()
        
        # 遍历所有记忆文件
        for memory_file in sorted(memory_dir.glob('*.md'), reverse=True)[:7]:  # 最近7天
            try:
                content = memory_file.read_text(encoding='utf-8')
                
                # 按条目分割
                entries = content.split('\n## ')
                for entry in entries:
                    if query_lower in entry.lower():
                        # 提取日期和内容
                        date = memory_file.stem
                        results.append(f"[{date}] {entry.strip()[:200]}")
                        
                        if len(results) >= 5:  # 最多返回5条
                            break
            except Exception:
                continue
            
            if len(results) >= 5:
                break
        
        if results:
            return f"找到 {len(results)} 条相关记忆:\n\n" + "\n\n---\n\n".join(results)
        else:
            return f"未找到与 '{query}' 相关的记忆。"
    
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
            'tools': [t['name'] for t in self.registry.list_all()],
            'toolCount': len(self.registry.list_all()),
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
                    manifest_path = item / 'manifest.json'
                    description = ''
                    skill_data = {
                        'name': item.name,
                        'description': description,
                        'location': 'local',
                        'path': str(item),
                        'status': 'active',
                        'enabled': True,
                    }

                    # 读取 SKILL.md 描述
                    if skill_md.exists():
                        try:
                            content = skill_md.read_text(encoding='utf-8')
                            for line in content.split('\n'):
                                line = line.strip()
                                if line and not line.startswith('#'):
                                    skill_data['description'] = line[:100]
                                    break
                        except:
                            pass

                    # 读取 manifest.json (P1: 可执行技能元数据)
                    if manifest_path.exists():
                        try:
                            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                            skill_data['toolName'] = manifest.get('toolName', '')
                            skill_data['executable'] = bool(manifest.get('executable', ''))
                            skill_data['inputs'] = manifest.get('inputs', {})
                            skill_data['dangerLevel'] = manifest.get('dangerLevel', 'safe')
                            skill_data['keywords'] = manifest.get('keywords', [])
                            skill_data['version'] = manifest.get('version', '1.0.0')
                            if manifest.get('description'):
                                skill_data['description'] = manifest['description']
                        except:
                            pass

                    skills.append(skill_data)
        
        self.send_json(skills)

    def handle_tools_list(self):
        """GET /tools - 列出所有已注册的工具"""
        self.send_json(self.registry.list_all())

    def handle_tools_reload(self, data=None):
        """POST /tools/reload - 热重载插件工具"""
        self.registry.plugin_tools.clear()
        self.registry.scan_plugins()
        tools = self.registry.list_all()
        self.send_json({
            'status': 'ok',
            'message': f'Reloaded. {len(tools)} tools registered.',
            'tools': tools,
        })

    def handle_trace_save(self, data):
        """POST /api/traces/save - 保存执行追踪 (P2: 执行流记忆)"""
        if not data:
            self.send_error_json('Missing trace data', 400)
            return

        traces_dir = self.clawd_path / 'memory' / 'exec_traces'
        traces_dir.mkdir(parents=True, exist_ok=True)

        # 按月分片存储
        month = datetime.now().strftime('%Y-%m')
        trace_file = traces_dir / f'{month}.jsonl'

        # 敏感数据脱敏
        trace_json = json.dumps(data, ensure_ascii=False)
        import re
        trace_json = re.sub(
            r'(password|token|secret|api_key|apikey|auth)["\s:]*["\']([^"\']{3,})["\']',
            r'\1": "***"',
            trace_json,
            flags=re.IGNORECASE
        )

        try:
            with open(trace_file, 'a', encoding='utf-8') as f:
                f.write(trace_json + '\n')

            self.send_json({
                'status': 'ok',
                'message': f'Trace saved to {month}.jsonl',
            })
        except Exception as e:
            self.send_error_json(f'Failed to save trace: {e}', 500)

    def handle_trace_search(self, query_params):
        """GET /api/traces/search?query=xxx&limit=5 - 检索执行追踪 (P2)"""
        query = query_params.get('query', [''])[0]
        limit = min(int(query_params.get('limit', ['5'])[0]), 20)

        if not query:
            self.send_json([])
            return

        traces_dir = self.clawd_path / 'memory' / 'exec_traces'
        if not traces_dir.exists():
            self.send_json([])
            return

        query_lower = query.lower()
        query_words = [w for w in query_lower.split() if len(w) > 1]
        results = []

        # 从最近的月份文件开始搜索
        for trace_file in sorted(traces_dir.glob('*.jsonl'), reverse=True)[:6]:
            try:
                for line in reversed(trace_file.read_text(encoding='utf-8').strip().split('\n')):
                    if not line.strip():
                        continue
                    try:
                        trace = json.loads(line)
                        task = trace.get('task', '').lower()
                        tags = [t.lower() for t in trace.get('tags', [])]
                        # 关键词匹配: task 描述或 tags
                        matched = any(w in task for w in query_words) or \
                                  any(w in ' '.join(tags) for w in query_words)
                        if matched:
                            results.append(trace)
                            if len(results) >= limit:
                                break
                    except json.JSONDecodeError:
                        continue
            except Exception:
                continue
            if len(results) >= limit:
                break

        self.send_json(results)
    
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


def cleanup_old_traces(clawd_path, max_months=6):
    """清理过期的执行追踪文件 (P2: 保留最近N个月)"""
    traces_dir = clawd_path / 'memory' / 'exec_traces'
    if not traces_dir.exists():
        return

    files = sorted(traces_dir.glob('*.jsonl'))
    if len(files) <= max_months:
        return

    old_files = files[:-max_months]
    for f in old_files:
        try:
            f.unlink()
            print(f"[Cleanup] Removed old trace: {f.name}")
        except:
            pass


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
    
    # 🔌 初始化工具注册表
    registry = ToolRegistry(clawd_path)
    # 注册 9 个内置工具
    builtin_names = [
        'readFile', 'writeFile', 'appendFile', 'listDir', 'runCmd',
        'weather', 'webSearch', 'saveMemory', 'searchMemory',
    ]
    for name in builtin_names:
        registry.register_builtin(name, name)  # handler resolved at dispatch time
    # 扫描插件工具
    registry.scan_plugins()

    # 清理过期执行追踪 (P2: 保留最近6个月)
    cleanup_old_traces(clawd_path)

    ClawdDataHandler.clawd_path = clawd_path
    ClawdDataHandler.registry = registry
    
    server = HTTPServer((args.host, args.port), ClawdDataHandler)
    
    tool_names = [t['name'] for t in registry.list_all()]
    plugin_count = len(registry.plugin_tools)
    print(f"""
+==================================================================+
|              DD-OS Native Server v{VERSION}                         |
+==================================================================+
|  Mode:    NATIVE (standalone, no OpenClaw needed)                |
|  Server:  http://{args.host}:{args.port}                                    |
|  Data:    {str(clawd_path)[:50]:<50} |
+------------------------------------------------------------------+
|  Tools:   {len(tool_names)} registered ({len(builtin_names)} builtin + {plugin_count} plugins)             |
|  API:     /api/tools/execute (POST)  |  /tools (GET)            |
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
