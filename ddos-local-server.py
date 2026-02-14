#!/usr/bin/env python3
"""
DD-OS 本地数据服务
从 ~/clawd 目录读取 OpenClaw 配置文件并提供 HTTP API

用法:
    python ddos-local-server.py [--port 3001] [--path ~/clawd]

API:
    GET /status          - 服务状态
    GET /files           - 列出所有文件
    GET /file/<name>     - 获取文件内容
    GET /skills          - 获取技能列表
    GET /memories        - 获取记忆数据
    GET /all             - 获取所有数据
    POST /task/execute   - 执行任务
    GET /task/status/<id>?offset=N - 查询任务状态(增量读取日志)
"""

import os
import sys
import json
import argparse
import threading
import time
import uuid
import subprocess
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs

VERSION = "2.0.0"

class ClawdDataHandler(BaseHTTPRequestHandler):
    clawd_path = None
    # 任务存储 (仅元数据，不存输出内容)
    tasks = {}
    tasks_lock = threading.Lock()
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")
    
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
        self.send_json({'error': message}, status)
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        
        if path == '/status':
            self.handle_status()
        elif path == '/files':
            self.handle_files()
        elif path.startswith('/file/'):
            filename = path[6:]  # Remove '/file/' prefix
            self.handle_file(filename)
        elif path == '/skills':
            self.handle_skills()
        elif path == '/memories':
            self.handle_memories()
        elif path == '/all':
            self.handle_all()
        elif path.startswith('/task/status/'):
            task_id = path[13:]
            offset = int(query.get('offset', ['0'])[0])
            self.handle_task_status(task_id, offset)
        elif path == '/' or path == '':
            self.handle_index()
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        
        if path == '/task/execute':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error_json('Invalid JSON', 400)
                return
            self.handle_task_execute(data)
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    def handle_index(self):
        html = """<!DOCTYPE html>
<html>
<head><title>DD-OS Local Server</title></head>
<body style="font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px;">
<h1>🤖 DD-OS Local Data Server</h1>
<p>Version: {version}</p>
<p>Clawd Path: {path}</p>
<h2>API Endpoints:</h2>
<ul>
<li><a href="/status">/status</a> - Server status</li>
<li><a href="/files">/files</a> - List files</li>
<li><a href="/file/SOUL.md">/file/SOUL.md</a> - Get SOUL.md</li>
<li><a href="/skills">/skills</a> - Skills list</li>
<li><a href="/memories">/memories</a> - Memories</li>
<li><a href="/all">/all</a> - All data</li>
</ul>
</body>
</html>""".format(version=VERSION, path=self.clawd_path)
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))
    
    def handle_status(self):
        files = list_files(self.clawd_path)
        self.send_json({
            'status': 'ok',
            'version': VERSION,
            'clawdPath': str(self.clawd_path),
            'fileCount': len(files),
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
        
        # Security: prevent path traversal
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
        
        # 扫描 skills 目录
        if skills_dir.exists() and skills_dir.is_dir():
            for item in skills_dir.iterdir():
                if item.is_dir():
                    skill_md = item / 'SKILL.md'
                    description = ''
                    if skill_md.exists():
                        try:
                            content = skill_md.read_text(encoding='utf-8')
                            # 提取第一行作为描述
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
        
        # 检查全局 skills 目录
        global_skills = Path.home() / '.openclaw' / 'skills'
        if global_skills.exists() and global_skills.is_dir():
            for item in global_skills.iterdir():
                if item.is_dir() and item.name not in [s['name'] for s in skills]:
                    skills.append({
                        'name': item.name,
                        'description': '',
                        'location': 'global',
                        'path': str(item),
                        'status': 'active',
                        'enabled': True,
                    })
        
        self.send_json(skills)
    
    def handle_memories(self):
        memories = []
        
        # 读取 MEMORY.md
        memory_md = self.clawd_path / 'MEMORY.md'
        if memory_md.exists():
            try:
                content = memory_md.read_text(encoding='utf-8')
                memories.extend(parse_memory_md(content))
            except:
                pass
        
        # 扫描 memory 目录
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
        
        # SOUL.md
        soul_path = self.clawd_path / 'SOUL.md'
        if soul_path.exists():
            try:
                data['soul'] = soul_path.read_text(encoding='utf-8')
            except:
                pass
        
        # IDENTITY.md
        identity_path = self.clawd_path / 'IDENTITY.md'
        if identity_path.exists():
            try:
                data['identity'] = identity_path.read_text(encoding='utf-8')
            except:
                pass
        
        # Skills and Memories - 复用其他处理器的逻辑
        # (简化版，直接内联)
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
        """处理任务执行请求"""
        prompt = data.get('prompt', '').strip()
        if not prompt:
            self.send_error_json('Missing prompt', 400)
            return
        
        task_id = str(uuid.uuid4())[:8]
        
        # 在后台线程执行
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
        """查询任务状态 (支持增量读取)"""
        with self.tasks_lock:
            task = self.tasks.get(task_id)
        
        if not task:
            self.send_error_json(f'Task not found: {task_id}', 404)
            return
        
        # 从日志文件增量读取
        log_path = task.get('logPath')
        content = ''
        new_offset = offset
        has_more = False
        file_size = task.get('fileSize', 0)
        
        if log_path:
            content, new_offset, has_more = read_log_chunk(log_path, offset)
            # 更新 fileSize（可能已变化）
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


def list_files(clawd_path):
    """列出 clawd 目录下的文件"""
    files = []
    try:
        for item in clawd_path.iterdir():
            if item.is_file():
                files.append(item.name)
    except:
        pass
    return sorted(files)


def parse_memory_md(content):
    """解析 MEMORY.md 内容"""
    memories = []
    sections = content.split('## ')
    
    for i, section in enumerate(sections[1:], 1):  # Skip first empty split
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


# ============================================
# 日志读取
# ============================================

def read_log_chunk(log_path, offset=0, max_bytes=51200):
    """从日志文件增量读取内容
    
    Args:
        log_path: 日志文件路径
        offset: 起始字节偏移
        max_bytes: 最大读取字节数 (默认 50KB)
    
    Returns:
        (content, new_offset, has_more)
    """
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


# ============================================
# 任务执行 (文件流式)
# ============================================

def run_task_in_background(task_id, prompt, clawd_path):
    """在后台线程中执行任务，输出写入日志文件"""
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
        with open(log_file, 'wb') as f:
            process = subprocess.Popen(
                ['clawdbot', 'agent', '--agent', 'main', '--message', prompt],
                cwd=str(clawd_path),
                stdout=f,
                stderr=subprocess.STDOUT,
            )
            
            # 监控进程，定期更新文件大小
            start_time = time.time()
            timeout = 300  # 5 分钟超时
            
            while process.poll() is None:
                time.sleep(0.5)
                try:
                    with ClawdDataHandler.tasks_lock:
                        ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
                except:
                    pass
                
                # 超时检查
                if time.time() - start_time > timeout:
                    process.kill()
                    process.wait()
                    with ClawdDataHandler.tasks_lock:
                        ClawdDataHandler.tasks[task_id]['status'] = 'error'
                        ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
                    # 写入超时提示
                    with open(log_file, 'a', encoding='utf-8') as ef:
                        ef.write(f'\n\n[错误] 任务执行超时 ({timeout}s)\n')
                    with ClawdDataHandler.tasks_lock:
                        ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
                    return
            
            process.wait()
        
        # 更新最终状态
        with ClawdDataHandler.tasks_lock:
            ClawdDataHandler.tasks[task_id]['status'] = 'done' if process.returncode == 0 else 'error'
            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
        
        # 如果返回码非0且日志为空，写入退出码信息
        if process.returncode != 0 and log_file.stat().st_size == 0:
            with open(log_file, 'w', encoding='utf-8') as ef:
                ef.write(f'Exit code: {process.returncode}\n')
            with ClawdDataHandler.tasks_lock:
                ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
    
    except FileNotFoundError:
        with open(log_file, 'w', encoding='utf-8') as ef:
            ef.write('clawdbot CLI 未找到。请确认已通过 npm install -g clawdbot 安装。\n')
        with ClawdDataHandler.tasks_lock:
            ClawdDataHandler.tasks[task_id]['status'] = 'error'
            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size
    except Exception as e:
        with open(log_file, 'a', encoding='utf-8') as ef:
            ef.write(f'\n\n[错误] {str(e)}\n')
        with ClawdDataHandler.tasks_lock:
            ClawdDataHandler.tasks[task_id]['status'] = 'error'
            ClawdDataHandler.tasks[task_id]['fileSize'] = log_file.stat().st_size


def cleanup_old_logs(clawd_path, max_age_hours=24):
    """清理超过 max_age_hours 小时的旧日志文件"""
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
    parser = argparse.ArgumentParser(description='DD-OS Local Data Server')
    parser.add_argument('--port', type=int, default=3001, help='Server port (default: 3001)')
    parser.add_argument('--path', type=str, default='~/clawd', help='Clawd directory path (default: ~/clawd)')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Server host (default: 0.0.0.0)')
    args = parser.parse_args()
    
    clawd_path = Path(args.path).expanduser().resolve()
    
    if not clawd_path.exists():
        print(f"Error: Clawd path does not exist: {clawd_path}")
        print(f"Please create the directory or specify a different path with --path")
        sys.exit(1)
    
    # 初始化日志目录
    logs_dir = clawd_path / 'logs'
    logs_dir.mkdir(exist_ok=True)
    
    # 清理旧日志
    cleanup_old_logs(clawd_path)
    
    ClawdDataHandler.clawd_path = clawd_path
    
    server = HTTPServer((args.host, args.port), ClawdDataHandler)
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           🤖 DD-OS Local Data Server v{VERSION}                ║
╠══════════════════════════════════════════════════════════════╣
║  Server:  http://{args.host}:{args.port}                              ║
║  Clawd:   {str(clawd_path)[:45]:<45} ║
║  Logs:    {str(logs_dir)[:45]:<45} ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    print(f"Serving files from: {clawd_path}")
    print(f"Press Ctrl+C to stop\n")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
