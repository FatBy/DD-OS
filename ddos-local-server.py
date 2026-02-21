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
import re
import json
import argparse
import threading
import time
import uuid
import subprocess
import shlex
import shutil
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs
from datetime import datetime, timedelta

# PyYAML (skill-executor/parser.py 已依赖)
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

# MCP 客户端支持
try:
    from skills.mcp_manager import MCPClientManager
    HAS_MCP = True
except ImportError:
    HAS_MCP = False
    MCPClientManager = None

VERSION = "4.0.0"

# 🛡️ 安全配置
DANGEROUS_COMMANDS = {'rm -rf /', 'format', 'mkfs', 'dd if=/dev/zero'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB 最大文件大小
MAX_OUTPUT_SIZE = 512 * 1024      # 512KB 最大输出
PLUGIN_TIMEOUT = 60               # 插件执行超时(秒)


# ============================================
# 🔌 SKILL.md Frontmatter 解析
# ============================================

def parse_skill_frontmatter(skill_md_path: Path) -> dict:
    """从 SKILL.md 提取 YAML frontmatter 元数据"""
    try:
        content = skill_md_path.read_text(encoding='utf-8')
    except Exception:
        return {}

    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        # 无 frontmatter，提取第一段非标题文本作为 description
        desc = ''
        for line in content.split('\n'):
            line = line.strip()
            if line and not line.startswith('#'):
                desc = line[:200]
                break
        return {'description': desc}

    if HAS_YAML:
        try:
            return yaml.safe_load(match.group(1)) or {}
        except Exception:
            return {}
    else:
        # 无 PyYAML 时用简单正则提取 key: value
        result = {}
        for line in match.group(1).split('\n'):
            m = re.match(r'^(\w+)\s*:\s*(.+)$', line.strip())
            if m:
                key, val = m.group(1), m.group(2).strip()
                # 简单处理数组 [a, b, c]
                if val.startswith('[') and val.endswith(']'):
                    val = [v.strip().strip('"\'') for v in val[1:-1].split(',') if v.strip()]
                result[key] = val
        return result


def skill_name_to_tool_name(name: str) -> str:
    """将 skill 名称标准化为工具名 (kebab-case -> snake_case)"""
    return name.replace('-', '_').replace(' ', '_').lower()


# ============================================
# 🌌 NEXUS.md 解析
# ============================================

def parse_nexus_frontmatter(nexus_md_path: Path) -> dict:
    """从 NEXUS.md 提取 YAML frontmatter 元数据"""
    try:
        content = nexus_md_path.read_text(encoding='utf-8')
    except Exception:
        return {}

    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}

    if HAS_YAML:
        try:
            return yaml.safe_load(match.group(1)) or {}
        except Exception:
            return {}
    else:
        result = {}
        for line in match.group(1).split('\n'):
            m = re.match(r'^(\w+)\s*:\s*(.+)$', line.strip())
            if m:
                key, val = m.group(1), m.group(2).strip()
                if val.startswith('[') and val.endswith(']'):
                    val = [v.strip().strip('"\'') for v in val[1:-1].split(',') if v.strip()]
                result[key] = val
        return result


def extract_nexus_body(nexus_md_path: Path) -> str:
    """从 NEXUS.md 提取 Markdown 正文 (跳过 frontmatter)"""
    try:
        content = nexus_md_path.read_text(encoding='utf-8')
    except Exception:
        return ''

    # 去掉 frontmatter
    match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
    if match:
        return content[match.end():].strip()
    return content.strip()


def update_nexus_frontmatter(nexus_md_path: Path, updates: dict):
    """更新 NEXUS.md 的 frontmatter 字段 (保留 body 不变)"""
    body = extract_nexus_body(nexus_md_path)
    frontmatter = parse_nexus_frontmatter(nexus_md_path)
    frontmatter.update(updates)

    # 重建 YAML frontmatter
    lines = ['---']
    for key, val in frontmatter.items():
        if isinstance(val, list):
            lines.append(f'{key}:')
            for item in val:
                lines.append(f'  - {item}')
        elif isinstance(val, dict):
            lines.append(f'{key}:')
            for k, v in val.items():
                lines.append(f'  {k}: {v}')
        else:
            lines.append(f'{key}: {val}')
    lines.append('---')
    lines.append('')
    lines.append(body)

    nexus_md_path.write_text('\n'.join(lines), encoding='utf-8')


def count_experience_entries(exp_dir: Path) -> int:
    """统计经验目录中的条目数，用于 XP 计算"""
    xp = 0
    successes = exp_dir / 'successes.md'
    failures = exp_dir / 'failures.md'
    if successes.exists():
        try:
            lines = successes.read_text(encoding='utf-8').split('\n')
            xp += sum(1 for l in lines if l.startswith('### ')) * 10
        except Exception:
            pass
    if failures.exists():
        try:
            lines = failures.read_text(encoding='utf-8').split('\n')
            xp += sum(1 for l in lines if l.startswith('### ')) * 5
        except Exception:
            pass
    return xp


# ============================================
# 🔌 动态工具注册表
# ============================================

class ToolRegistry:
    """动态工具发现与注册 - 支持内置工具 + 插件工具 + 指令型工具 + MCP工具"""

    def __init__(self, clawd_path: Path):
        self.clawd_path = clawd_path
        self.builtin_tools: dict = {}      # name -> callable
        self.plugin_tools: dict = {}       # name -> ToolSpec dict (有 execute.py)
        self.instruction_tools: dict = {}  # name -> InstructionSpec (纯 SKILL.md)
        self.mcp_tools: dict = {}          # name -> MCPToolSpec dict (MCP 服务器)
        self.mcp_manager: 'MCPClientManager | None' = None

    def register_builtin(self, name: str, handler):
        """注册内置工具"""
        self.builtin_tools[name] = handler

    def scan_plugins(self):
        """递归扫描 skills/ 目录，注册可执行插件 + 指令型技能"""
        skills_dir = self.clawd_path / 'skills'
        if not skills_dir.exists():
            return

        plugin_count = 0
        instruction_count = 0

        # 递归查找所有包含 SKILL.md 或 manifest.json 的目录
        seen_dirs: set = set()

        # 1. 先扫描 manifest.json (可执行插件优先)
        for manifest_path in skills_dir.rglob('manifest.json'):
            skill_dir = manifest_path.parent
            dir_key = str(skill_dir.resolve())
            if dir_key in seen_dirs:
                continue
            seen_dirs.add(dir_key)

            try:
                spec = json.loads(manifest_path.read_text(encoding='utf-8'))

                tools_list = spec.get('tools', [])
                if not tools_list:
                    tools_list = [spec]

                for tool_spec in tools_list:
                    tool_name = tool_spec.get('toolName', '')
                    executable = tool_spec.get('executable', spec.get('executable', 'execute.py'))

                    if not tool_name:
                        continue

                    exe_path = skill_dir / executable
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
                        'dangerLevel': tool_spec.get('dangerLevel', spec.get('dangerLevel', 'safe')),
                        'version': tool_spec.get('version', spec.get('version', '1.0.0')),
                        'skill_dir': str(skill_dir),
                        'keywords': tool_spec.get('keywords', spec.get('keywords', [])),
                    }
                    plugin_count += 1
                    print(f"[ToolRegistry] Registered plugin: {tool_name} ({exe_path.name})")

            except Exception as e:
                print(f"[ToolRegistry] Error loading {manifest_path}: {e}")

        # 2. 扫描 SKILL.md (指令型技能 - 没有 manifest.json 或没有 executable 的)
        for skill_md in skills_dir.rglob('SKILL.md'):
            skill_dir = skill_md.parent
            dir_key = str(skill_dir.resolve())

            # 已被 manifest.json 扫描注册的目录跳过
            if dir_key in seen_dirs:
                continue
            seen_dirs.add(dir_key)

            try:
                frontmatter = parse_skill_frontmatter(skill_md)
                original_name = frontmatter.get('name', skill_dir.name)
                tool_name = skill_name_to_tool_name(original_name)

                # 冲突检查
                if tool_name in self.builtin_tools or tool_name in self.plugin_tools:
                    print(f"[ToolRegistry] Warning: instruction skill '{tool_name}' conflicts, skipping")
                    continue

                self.instruction_tools[tool_name] = {
                    'name': tool_name,
                    'original_name': original_name,
                    'skill_path': str(skill_md),
                    'skill_dir': str(skill_dir),
                    'description': frontmatter.get('description', ''),
                    'inputs': frontmatter.get('inputs', {}),
                    'keywords': frontmatter.get('tags', frontmatter.get('keywords', [])),
                    'dangerLevel': 'safe',
                    'version': frontmatter.get('version', '1.0.0'),
                }
                instruction_count += 1
                print(f"[ToolRegistry] Registered instruction skill: {tool_name} ({skill_md.relative_to(skills_dir)})")

            except Exception as e:
                print(f"[ToolRegistry] Error loading {skill_md}: {e}")

        total = plugin_count + instruction_count
        if total > 0:
            print(f"[ToolRegistry] {total} tool(s) registered ({plugin_count} plugins, {instruction_count} instruction skills)")

    def scan_mcp_servers(self):
        """扫描并连接 MCP 服务器"""
        if not HAS_MCP:
            print("[ToolRegistry] MCP support not available (missing mcp_manager)")
            return

        self.mcp_manager = MCPClientManager(clawd_path=self.clawd_path)
        count = self.mcp_manager.initialize_all()

        if count > 0:
            # 注册 MCP 工具
            mcp_tool_count = 0
            for tool_info in self.mcp_manager.get_all_tools():
                tool_name = tool_info['name']
                # 冲突检查
                if tool_name in self.builtin_tools or tool_name in self.plugin_tools or tool_name in self.instruction_tools:
                    print(f"[ToolRegistry] Warning: MCP tool '{tool_name}' conflicts with existing tool, skipping")
                    continue

                self.mcp_tools[tool_name] = {
                    'name': tool_name,
                    'server': tool_info.get('server', ''),
                    'description': tool_info.get('description', ''),
                    'inputs': tool_info.get('inputs', {}),
                    'dangerLevel': 'safe',
                    'version': '1.0.0',
                }
                mcp_tool_count += 1

            print(f"[ToolRegistry] {mcp_tool_count} MCP tool(s) registered from {count} server(s)")

    def is_registered(self, name: str) -> bool:
        return name in self.builtin_tools or name in self.plugin_tools or name in self.instruction_tools or name in self.mcp_tools

    def get_plugin(self, name: str) -> dict | None:
        return self.plugin_tools.get(name)

    def get_instruction(self, name: str) -> dict | None:
        return self.instruction_tools.get(name)

    def get_mcp_tool(self, name: str) -> dict | None:
        return self.mcp_tools.get(name)

    def list_all(self) -> list:
        """返回所有已注册工具（内置+插件+指令型+MCP）"""
        # 内置工具元数据 (为有特殊参数的工具提供描述)
        BUILTIN_META = {
            'nexusBindSkill': {
                'description': '为当前 Nexus 绑定新技能依赖',
                'inputs': {
                    'nexusId': {'type': 'string', 'description': 'Nexus ID', 'required': True},
                    'skillId': {'type': 'string', 'description': '要绑定的技能 ID', 'required': True},
                },
            },
            'nexusUnbindSkill': {
                'description': '从当前 Nexus 移除技能依赖',
                'inputs': {
                    'nexusId': {'type': 'string', 'description': 'Nexus ID', 'required': True},
                    'skillId': {'type': 'string', 'description': '要移除的技能 ID', 'required': True},
                },
            },
        }
        tools = []
        for name in self.builtin_tools:
            meta = BUILTIN_META.get(name, {})
            tools.append({'name': name, 'type': 'builtin', **meta})
        for name, spec in self.plugin_tools.items():
            tools.append({
                'name': name,
                'type': 'plugin',
                'description': spec.get('description', ''),
                'inputs': spec.get('inputs', {}),
                'dangerLevel': spec.get('dangerLevel', 'safe'),
                'version': spec.get('version', '1.0.0'),
            })
        for name, spec in self.instruction_tools.items():
            tools.append({
                'name': name,
                'type': 'instruction',
                'description': spec.get('description', ''),
                'inputs': spec.get('inputs', {}),
                'dangerLevel': 'safe',
                'version': spec.get('version', '1.0.0'),
            })
        for name, spec in self.mcp_tools.items():
            tools.append({
                'name': name,
                'type': 'mcp',
                'server': spec.get('server', ''),
                'description': spec.get('description', ''),
                'inputs': spec.get('inputs', {}),
                'dangerLevel': 'safe',
                'version': '1.0.0',
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
            '/nexuses': self.handle_nexuses,
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
        elif path.startswith('/nexuses/') and '/experience' not in path:
            nexus_name = path[9:]  # strip '/nexuses/'
            self.handle_nexus_detail(nexus_name)
        elif path.startswith('/task/status/'):
            task_id = path[13:]
            offset = int(query.get('offset', ['0'])[0])
            self.handle_task_status(task_id, offset)
        elif path == '/api/traces/search':
            self.handle_trace_search(query)
        elif path == '/api/traces/recent':
            self.handle_trace_recent(query)
        elif path == '/mcp/servers':
            self.handle_mcp_servers_list()
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
        elif path == '/mcp/reload':
            self.handle_mcp_reload(data)
        elif path.startswith('/mcp/servers/') and path.endswith('/reconnect'):
            server_name = path[13:-10]  # Extract server name
            self.handle_mcp_reconnect(server_name)
        elif path == '/skills/install':
            self.handle_skill_install(data)
        elif path == '/skills/uninstall':
            self.handle_skill_uninstall(data)
        elif path.startswith('/nexuses/') and path.endswith('/skills'):
            nexus_name = path[9:-7]  # strip '/nexuses/' and '/skills'
            self.handle_nexus_update_skills(nexus_name, data)
        elif path.startswith('/nexuses/') and path.endswith('/experience'):
            nexus_name = path[9:-11]  # strip '/nexuses/' and '/experience'
            self.handle_add_experience(nexus_name, data)
        elif path == '/task/execute':
            self.handle_task_execute(data)
        else:
            self.send_error_json(f'Unknown endpoint: {path}', 404)
    
    # ============================================
    # 🛠️ 工具执行 (核心新功能)
    # ============================================
    
    def handle_tool_execution(self, data):
        """处理工具调用请求 - 支持内置工具、插件工具、指令型工具和MCP工具"""
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
            # 1. 指令型工具 -> 路由到 skill-executor
            instruction_spec = self.registry.get_instruction(tool_name)
            if instruction_spec:
                result = self._execute_instruction_tool(instruction_spec, tool_name, args)
            # 2. 插件工具 -> subprocess 执行
            elif self.registry.get_plugin(tool_name):
                plugin_spec = self.registry.get_plugin(tool_name)
                result = self._execute_plugin_tool(plugin_spec, tool_name, args)
            # 3. MCP 工具 -> 通过 MCPManager 调用
            elif self.registry.get_mcp_tool(tool_name):
                result = self._execute_mcp_tool(tool_name, args)
            # 4. 内置工具 -> 直接调度
            else:
                builtin_handlers = {
                    'readFile': self._tool_read_file,
                    'writeFile': self._tool_write_file,
                    'appendFile': self._tool_append_file,
                    'listDir': self._tool_list_dir,
                    'runCmd': self._tool_run_cmd,
                    'weather': self._tool_weather,
                    'webSearch': self._tool_web_search,
                    'webFetch': self._tool_web_fetch,
                    'saveMemory': self._tool_save_memory,
                    'searchMemory': self._tool_search_memory,
                    'nexusBindSkill': self._tool_nexus_bind_skill,
                    'nexusUnbindSkill': self._tool_nexus_unbind_skill,
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

    def _execute_instruction_tool(self, spec: dict, tool_name: str, args: dict) -> str:
        """执行指令型工具 - 通过 skill-executor 解析 SKILL.md 并返回指令"""
        skill_executor = self.clawd_path / 'skills' / 'skill-executor' / 'execute.py'

        if not skill_executor.exists():
            raise RuntimeError(f"skill-executor not found at {skill_executor}")

        # 使用 original_name (kebab-case) 让 SkillDiscovery 能找到目录
        original_name = spec.get('original_name', tool_name)

        input_data = json.dumps({
            'tool': 'run_skill',
            'args': {
                'skill_name': original_name,
                'args': args,
                'project_root': str(self.clawd_path),
            }
        }, ensure_ascii=False)

        try:
            process = subprocess.run(
                [sys.executable, str(skill_executor)],
                input=input_data,
                capture_output=True,
                text=True,
                timeout=PLUGIN_TIMEOUT,
                cwd=str(skill_executor.parent),
            )

            if process.returncode != 0:
                stderr = process.stderr[:MAX_OUTPUT_SIZE] if process.stderr else ''
                raise RuntimeError(f"Instruction skill error: {stderr}")

            result = json.loads(process.stdout)
            if not result.get('success'):
                raise RuntimeError(result.get('error', 'Unknown error'))

            return result.get('instructions', result.get('output', ''))

        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Instruction skill timed out after {PLUGIN_TIMEOUT}s")
        except json.JSONDecodeError:
            # skill-executor 返回非 JSON 时，直接返回原文
            return process.stdout[:MAX_OUTPUT_SIZE] if process.stdout else ''

    def _execute_mcp_tool(self, tool_name: str, args: dict) -> str:
        """执行 MCP 工具 - 通过 MCPManager 调用远程 MCP 服务器"""
        if not self.registry.mcp_manager:
            raise RuntimeError("MCP manager not initialized")

        try:
            result = self.registry.mcp_manager.call_tool(tool_name, args, timeout=PLUGIN_TIMEOUT)
            if result is None:
                return ""
            return str(result)
        except Exception as e:
            raise RuntimeError(f"MCP tool execution failed: {e}")
    
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
            
            rc = process.returncode
            if rc == 0:
                result_parts.append(f"Exit Code: 0 (成功)")
            else:
                # 提供常见 exit code 的可读解释
                code_hints = {
                    1: "通用错误",
                    2: "参数错误或命令误用",
                    3: "URL 格式错误 (curl)",
                    6: "无法解析主机名 (DNS 失败)",
                    7: "无法连接到服务器",
                    28: "操作超时",
                    35: "SSL/TLS 连接错误",
                    56: "网络数据接收失败",
                    60: "SSL 证书验证失败",
                    127: "命令未找到",
                    128: "无效的退出参数",
                }
                hint = code_hints.get(rc, "未知错误")
                result_parts.append(f"Exit Code: {rc} ({hint})")
                # 当没有任何输出时，补充提示帮助 LLM 理解错误
                if not stdout and not stderr:
                    result_parts.append(f"注意: 命令 '{command[:80]}' 执行失败且无输出。建议换用其他工具或方式完成任务。")
            
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
    
    def _tool_web_fetch(self, args: dict) -> str:
        """获取网页内容 (简化版，提取主要文本)"""
        import urllib.request
        import urllib.parse
        import re
        from html.parser import HTMLParser
        
        url = args.get('url', '')
        if not url:
            raise ValueError("URL is required")
        
        # 确保 URL 有协议
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            })
            
            with urllib.request.urlopen(req, timeout=15) as response:
                # 检查内容类型
                content_type = response.headers.get('Content-Type', '')
                if 'text/html' not in content_type and 'text/plain' not in content_type:
                    return f"无法读取此类型的内容: {content_type}"
                
                html = response.read().decode('utf-8', errors='ignore')
            
            # 简单的 HTML 文本提取
            # 移除 script 和 style 标签
            html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
            html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.IGNORECASE)
            html = re.sub(r'<head[^>]*>[\s\S]*?</head>', '', html, flags=re.IGNORECASE)
            
            # 提取 title
            title_match = re.search(r'<title[^>]*>([^<]*)</title>', html, re.IGNORECASE)
            title = title_match.group(1).strip() if title_match else ''
            
            # 移除所有 HTML 标签
            text = re.sub(r'<[^>]+>', ' ', html)
            # 清理多余空白
            text = re.sub(r'\s+', ' ', text).strip()
            # 限制长度
            text = text[:4000]
            
            result = f"URL: {url}\n"
            if title:
                result += f"标题: {title}\n"
            result += f"\n内容摘要:\n{text}"
            
            return result
            
        except urllib.error.HTTPError as e:
            return f"HTTP 错误 {e.code}: {e.reason}"
        except urllib.error.URLError as e:
            return f"无法访问 URL: {e.reason}"
        except Exception as e:
            return f"获取网页失败: {str(e)}"
    
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
    
    def _tool_nexus_bind_skill(self, args: dict) -> str:
        """为 Nexus 绑定新技能"""
        nexus_id = args.get('nexusId', '')
        skill_id = args.get('skillId', '')
        if not nexus_id or not skill_id:
            raise ValueError('Missing nexusId or skillId')

        nexus_md = self.clawd_path / 'nexuses' / nexus_id / 'NEXUS.md'
        if not nexus_md.exists():
            raise ValueError(f"Nexus '{nexus_id}' not found")

        # 验证技能存在 (skills/ 目录中有对应目录)
        skill_dir = self.clawd_path / 'skills' / skill_id
        if not skill_dir.exists():
            raise ValueError(f"Skill '{skill_id}' not found in skills/")

        frontmatter = parse_nexus_frontmatter(nexus_md)
        deps = list(frontmatter.get('skill_dependencies', []))

        if skill_id in deps:
            return f"Skill '{skill_id}' already bound to Nexus '{nexus_id}'"

        deps.append(skill_id)
        update_nexus_frontmatter(nexus_md, {'skill_dependencies': deps})
        return f"Skill '{skill_id}' bound to Nexus '{nexus_id}'. Dependencies: {deps}"

    def _tool_nexus_unbind_skill(self, args: dict) -> str:
        """从 Nexus 解绑技能"""
        nexus_id = args.get('nexusId', '')
        skill_id = args.get('skillId', '')
        if not nexus_id or not skill_id:
            raise ValueError('Missing nexusId or skillId')

        nexus_md = self.clawd_path / 'nexuses' / nexus_id / 'NEXUS.md'
        if not nexus_md.exists():
            raise ValueError(f"Nexus '{nexus_id}' not found")

        frontmatter = parse_nexus_frontmatter(nexus_md)
        deps = list(frontmatter.get('skill_dependencies', []))

        if skill_id not in deps:
            return f"Skill '{skill_id}' not bound to Nexus '{nexus_id}'"

        if len(deps) <= 1:
            return f"Cannot remove last skill from Nexus '{nexus_id}'. At least 1 skill required."

        deps.remove(skill_id)
        update_nexus_frontmatter(nexus_md, {'skill_dependencies': deps})
        return f"Skill '{skill_id}' unbound from Nexus '{nexus_id}'. Remaining: {deps}"

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
        """GET /skills - 递归扫描所有技能 (SKILL.md + manifest.json)"""
        skills = []
        skills_dir = self.clawd_path / 'skills'

        if not skills_dir.exists() or not skills_dir.is_dir():
            self.send_json([])
            return

        seen = set()

        # Phase 1: 扫描有 SKILL.md 的目录
        for skill_md in skills_dir.rglob('SKILL.md'):
            skill_dir = skill_md.parent
            dir_key = str(skill_dir.resolve())
            if dir_key in seen:
                continue
            seen.add(dir_key)

            frontmatter = parse_skill_frontmatter(skill_md)
            manifest_path = skill_dir / 'manifest.json'

            skill_data = {
                'name': frontmatter.get('name', skill_dir.name),
                'description': frontmatter.get('description', ''),
                'location': 'local',
                'path': str(skill_dir),
                'status': 'active',
                'enabled': True,
                'keywords': frontmatter.get('tags', frontmatter.get('keywords', [])),
            }

            # 无 frontmatter description 时提取正文首段
            if not skill_data['description']:
                try:
                    content = skill_md.read_text(encoding='utf-8')
                    for line in content.split('\n'):
                        line = line.strip()
                        if line and not line.startswith('#') and not line.startswith('---'):
                            skill_data['description'] = line[:200]
                            break
                except Exception:
                    pass

            self._enrich_skill_from_manifest(skill_data, manifest_path, frontmatter)
            skills.append(skill_data)

        # Phase 2: 扫描有 manifest.json 但没有 SKILL.md 的目录
        for manifest_path in skills_dir.rglob('manifest.json'):
            skill_dir = manifest_path.parent
            dir_key = str(skill_dir.resolve())
            if dir_key in seen:
                continue
            seen.add(dir_key)

            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            except Exception:
                continue

            skill_data = {
                'name': manifest.get('name', skill_dir.name),
                'description': manifest.get('description', ''),
                'location': 'local',
                'path': str(skill_dir),
                'status': 'active',
                'enabled': True,
                'keywords': manifest.get('keywords', []),
            }

            self._enrich_skill_from_manifest(skill_data, manifest_path, {})
            skills.append(skill_data)

        self.send_json(skills)

    def _enrich_skill_from_manifest(self, skill_data: dict, manifest_path: Path, frontmatter: dict):
        """从 manifest.json 补充技能元数据 (多工具格式 + 关键词合并)"""
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

                # 支持新格式 tools: [...] 和旧格式 toolName: "..."
                tools_list = manifest.get('tools', [])
                if not tools_list:
                    tools_list = [manifest]

                tool_names = [t.get('toolName') for t in tools_list if t.get('toolName')]
                if tool_names:
                    skill_data['toolNames'] = tool_names
                    skill_data['toolName'] = tool_names[0]
                    skill_data['executable'] = True

                # 合并关键词 (manifest 优先)
                manifest_keywords = list(manifest.get('keywords', []))
                for t in tools_list:
                    manifest_keywords.extend(t.get('keywords', []))
                if manifest_keywords:
                    skill_data['keywords'] = list(set(manifest_keywords))

                skill_data['dangerLevel'] = manifest.get('dangerLevel', 'safe')
                skill_data['version'] = manifest.get('version', '1.0.0')
                if manifest.get('description'):
                    skill_data['description'] = manifest['description']

                # 合并所有 inputs
                all_inputs = {}
                for t in tools_list:
                    all_inputs.update(t.get('inputs', {}))
                if all_inputs:
                    skill_data['inputs'] = all_inputs

            except Exception:
                pass
        else:
            # 纯 SKILL.md - 指令型技能
            skill_data['toolType'] = 'instruction'
            tool_name = skill_name_to_tool_name(skill_data['name'])
            skill_data['toolName'] = tool_name
            skill_data['toolNames'] = [tool_name]
            if frontmatter.get('inputs'):
                skill_data['inputs'] = frontmatter['inputs']

    # ============================================
    # 🌌 Nexus 管理
    # ============================================

    def handle_nexuses(self):
        """GET /nexuses - 扫描 nexuses/ 目录，返回所有 Nexus 列表"""
        nexuses = []
        nexuses_dir = self.clawd_path / 'nexuses'

        if not nexuses_dir.exists():
            nexuses_dir.mkdir(parents=True, exist_ok=True)
            self.send_json([])
            return

        seen = set()

        for nexus_md in nexuses_dir.rglob('NEXUS.md'):
            nexus_dir = nexus_md.parent
            dir_key = str(nexus_dir.resolve())
            if dir_key in seen:
                continue
            seen.add(dir_key)

            frontmatter = parse_nexus_frontmatter(nexus_md)
            if not frontmatter or not frontmatter.get('name'):
                continue

            sop_content = extract_nexus_body(nexus_md)
            exp_dir = nexus_dir / 'experience'
            xp = count_experience_entries(exp_dir) if exp_dir.exists() else 0

            visual_dna = frontmatter.get('visual_dna', {})

            nexus_data = {
                'id': frontmatter.get('name', nexus_dir.name),
                'name': frontmatter.get('name', nexus_dir.name),
                'description': frontmatter.get('description', ''),
                'archetype': frontmatter.get('archetype', 'REACTOR'),
                'version': frontmatter.get('version', '1.0.0'),
                'skillDependencies': frontmatter.get('skill_dependencies', []),
                'tags': frontmatter.get('tags', []),
                'triggers': frontmatter.get('triggers', []),
                'visualDNA': visual_dna,
                'sopContent': sop_content,
                'xp': xp,
                'location': 'local',
                'path': str(nexus_dir),
                'status': 'active',
                # 目标函数驱动字段 (Objective-Driven Execution)
                'objective': frontmatter.get('objective', ''),
                'metrics': frontmatter.get('metrics', []),
                'strategy': frontmatter.get('strategy', ''),
            }
            nexuses.append(nexus_data)

        self.send_json(nexuses)

    def handle_nexus_detail(self, nexus_name: str):
        """GET /nexuses/{name} - 获取单个 Nexus 完整信息"""
        nexuses_dir = self.clawd_path / 'nexuses'
        nexus_dir = nexuses_dir / nexus_name
        nexus_md = nexus_dir / 'NEXUS.md'

        if not nexus_md.exists():
            self.send_error_json(f"Nexus '{nexus_name}' not found", 404)
            return

        frontmatter = parse_nexus_frontmatter(nexus_md)
        sop_content = extract_nexus_body(nexus_md)
        exp_dir = nexus_dir / 'experience'
        xp = count_experience_entries(exp_dir) if exp_dir.exists() else 0

        # 加载最近经验条目
        recent_experiences = []
        for exp_file in ['successes.md', 'failures.md']:
            exp_path = exp_dir / exp_file
            if not exp_path.exists():
                continue
            try:
                content = exp_path.read_text(encoding='utf-8')
                outcome = 'success' if 'success' in exp_file else 'failure'
                entries = content.split('\n### ')
                for entry in entries[1:]:  # skip header
                    entry = entry.strip()
                    if not entry:
                        continue
                    lines = entry.split('\n')
                    title = lines[0].strip() if lines else ''
                    recent_experiences.append({
                        'title': title,
                        'outcome': outcome,
                        'content': '\n'.join(lines[1:]).strip(),
                    })
            except Exception:
                pass

        # 按时间倒序（标题通常包含日期）
        recent_experiences = recent_experiences[-10:][::-1]

        visual_dna = frontmatter.get('visual_dna', {})

        response = {
            'id': frontmatter.get('name', nexus_name),
            'name': frontmatter.get('name', nexus_name),
            'description': frontmatter.get('description', ''),
            'archetype': frontmatter.get('archetype', 'REACTOR'),
            'version': frontmatter.get('version', '1.0.0'),
            'skillDependencies': frontmatter.get('skill_dependencies', []),
            'tags': frontmatter.get('tags', []),
            'triggers': frontmatter.get('triggers', []),
            'visualDNA': visual_dna,
            'sopContent': sop_content,
            'xp': xp,
            'recentExperiences': recent_experiences,
            'location': 'local',
            'path': str(nexus_dir),
            'status': 'active',
            # 目标函数驱动字段 (Objective-Driven Execution)
            'objective': frontmatter.get('objective', ''),
            'metrics': frontmatter.get('metrics', []),
            'strategy': frontmatter.get('strategy', ''),
        }
        self.send_json(response)

    def handle_nexus_update_skills(self, nexus_name: str, data: dict):
        """POST /nexuses/{name}/skills - 更新 Nexus 技能依赖"""
        action = data.get('action', '')  # 'add' or 'remove'
        skill_id = data.get('skillId', '')

        if action not in ('add', 'remove') or not skill_id:
            self.send_error_json('Invalid: need action (add/remove) and skillId', 400)
            return

        nexus_dir = self.clawd_path / 'nexuses' / nexus_name
        nexus_md = nexus_dir / 'NEXUS.md'
        if not nexus_md.exists():
            self.send_error_json(f"Nexus '{nexus_name}' not found", 404)
            return

        frontmatter = parse_nexus_frontmatter(nexus_md)
        deps = list(frontmatter.get('skill_dependencies', []))

        if action == 'add':
            if skill_id not in deps:
                deps.append(skill_id)
        elif action == 'remove':
            if len(deps) <= 1:
                self.send_error_json('Cannot remove last skill dependency', 400)
                return
            if skill_id in deps:
                deps.remove(skill_id)

        update_nexus_frontmatter(nexus_md, {'skill_dependencies': deps})

        self.send_json({
            'status': 'ok',
            'nexusId': nexus_name,
            'skillDependencies': deps,
        })

    def handle_add_experience(self, nexus_name: str, data: dict):
        """POST /nexuses/{name}/experience - 为 Nexus 添加经验记录"""
        nexuses_dir = self.clawd_path / 'nexuses'
        nexus_dir = nexuses_dir / nexus_name

        if not nexus_dir.exists():
            self.send_error_json(f"Nexus '{nexus_name}' not found", 404)
            return

        task = data.get('task', '')
        tools_used = data.get('tools_used', [])
        outcome = data.get('outcome', 'success')
        key_insight = data.get('key_insight', '')

        if not task:
            self.send_error_json('Missing required field: task', 400)
            return

        # 确保 experience 目录存在
        exp_dir = nexus_dir / 'experience'
        exp_dir.mkdir(parents=True, exist_ok=True)

        # 构建 Markdown 条目
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y-%m-%d')
        tool_seq = ' → '.join(tools_used) if tools_used else 'N/A'

        entry = f"\n### [{timestamp}] {task[:80]}\n"
        entry += f"- **Tools**: {tool_seq}\n"
        if key_insight:
            entry += f"- **Insight**: {key_insight}\n"
        entry += "---\n"

        # 追加到对应文件
        target_file = exp_dir / ('successes.md' if outcome == 'success' else 'failures.md')
        try:
            with target_file.open('a', encoding='utf-8') as f:
                f.write(entry)
            self.send_json({'status': 'ok', 'outcome': outcome})
        except Exception as e:
            self.send_error_json(f'Failed to write experience: {str(e)}', 500)

    def handle_tools_list(self):
        """GET /tools - 列出所有已注册的工具"""
        self.send_json(self.registry.list_all())

    def handle_tools_reload(self, data=None):
        """POST /tools/reload - 热重载插件工具"""
        self.registry.plugin_tools.clear()
        self.registry.instruction_tools.clear()
        self.registry.scan_plugins()
        tools = self.registry.list_all()
        self.send_json({
            'status': 'ok',
            'message': f'Reloaded. {len(tools)} tools registered.',
            'tools': tools,
        })

    # ============================================
    # 🔌 MCP 服务器管理
    # ============================================

    def handle_mcp_servers_list(self):
        """GET /mcp/servers - 列出 MCP 服务器状态"""
        if not self.registry.mcp_manager:
            self.send_json({
                'status': 'ok',
                'enabled': False,
                'servers': {},
                'message': 'MCP support not initialized'
            })
            return

        status = self.registry.mcp_manager.get_server_status()
        mcp_tools = [t for t in self.registry.list_all() if t.get('type') == 'mcp']

        self.send_json({
            'status': 'ok',
            'enabled': True,
            'servers': status,
            'toolCount': len(mcp_tools),
            'tools': mcp_tools,
        })

    def handle_mcp_reload(self, data=None):
        """POST /mcp/reload - 重新加载 MCP 服务器"""
        if not HAS_MCP:
            self.send_json({
                'status': 'error',
                'message': 'MCP support not available'
            }, 400)
            return

        # 清理现有 MCP 工具
        self.registry.mcp_tools.clear()
        if self.registry.mcp_manager:
            self.registry.mcp_manager.shutdown_all()

        # 重新扫描
        self.registry.scan_mcp_servers()

        mcp_tools = [t for t in self.registry.list_all() if t.get('type') == 'mcp']
        self.send_json({
            'status': 'ok',
            'message': f'MCP reloaded. {len(mcp_tools)} tool(s) registered.',
            'tools': mcp_tools,
        })

    def handle_mcp_reconnect(self, server_name: str):
        """POST /mcp/servers/{name}/reconnect - 重连 MCP 服务器"""
        if not self.registry.mcp_manager:
            self.send_json({
                'status': 'error',
                'message': 'MCP support not initialized'
            }, 400)
            return

        success = self.registry.mcp_manager.reconnect_server(server_name)

        if success:
            # 更新工具注册
            self.registry.mcp_tools.clear()
            for tool_info in self.registry.mcp_manager.get_all_tools():
                tool_name = tool_info['name']
                if tool_name not in self.registry.builtin_tools and tool_name not in self.registry.plugin_tools:
                    self.registry.mcp_tools[tool_name] = {
                        'name': tool_name,
                        'server': tool_info.get('server', ''),
                        'description': tool_info.get('description', ''),
                        'inputs': tool_info.get('inputs', {}),
                        'dangerLevel': 'safe',
                        'version': '1.0.0',
                    }

            self.send_json({
                'status': 'ok',
                'message': f'Server {server_name} reconnected',
                'server': server_name,
            })
        else:
            self.send_json({
                'status': 'error',
                'message': f'Failed to reconnect server: {server_name}'
            }, 500)

    # ============================================
    # 📦 远程技能安装/卸载
    # ============================================

    def handle_skill_install(self, data):
        """POST /skills/install - 从 Git URL 安装技能"""
        source = data.get('source', '')
        name = data.get('name', '')

        if not source:
            self.send_error_json('Missing source parameter', 400)
            return

        if not source.startswith(('http://', 'https://', 'git@')):
            self.send_error_json('Unsupported source format. Use a Git URL (https://... or git@...)', 400)
            return

        try:
            # 从 URL 提取仓库名
            match = re.search(r'/([^/]+?)(?:\.git)?$', source)
            repo_name = name or (match.group(1) if match else 'downloaded-skill')
            # 安全化名称
            repo_name = re.sub(r'[^\w\-.]', '_', repo_name)

            target = self.clawd_path / 'skills' / repo_name
            if target.exists():
                self.send_error_json(f'Skill already exists: {repo_name}. Use /skills/uninstall first.', 409)
                return

            # 确保 skills/ 目录存在
            (self.clawd_path / 'skills').mkdir(parents=True, exist_ok=True)

            # Git clone (shallow, 限制深度)
            process = subprocess.run(
                ['git', 'clone', '--depth', '1', source, str(target)],
                capture_output=True,
                text=True,
                timeout=120,
            )

            if process.returncode != 0:
                # 清理失败的 clone
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                stderr = process.stderr[:500] if process.stderr else 'Unknown error'
                raise RuntimeError(f"git clone failed: {stderr}")

            # 验证: 必须有 SKILL.md 或 manifest.json
            has_skill_md = (target / 'SKILL.md').exists() or any(target.rglob('SKILL.md'))
            has_manifest = (target / 'manifest.json').exists()

            if not has_skill_md and not has_manifest:
                shutil.rmtree(target, ignore_errors=True)
                self.send_error_json('Invalid skill: no SKILL.md or manifest.json found', 400)
                return

            # 重新扫描注册
            self.registry.plugin_tools.clear()
            self.registry.instruction_tools.clear()
            self.registry.scan_plugins()

            self.send_json({
                'status': 'ok',
                'name': repo_name,
                'path': str(target),
                'message': f'Skill installed: {repo_name}',
                'toolCount': len(self.registry.list_all()),
            })

        except subprocess.TimeoutExpired:
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            self.send_error_json('Git clone timed out (120s limit)', 500)
        except RuntimeError as e:
            self.send_error_json(str(e), 500)
        except Exception as e:
            self.send_error_json(f'Installation failed: {str(e)}', 500)

    def handle_skill_uninstall(self, data):
        """POST /skills/uninstall - 卸载技能"""
        name = data.get('name', '')

        if not name:
            self.send_error_json('Missing name parameter', 400)
            return

        # 安全检查: 不允许路径遍历
        if '..' in name or '/' in name or '\\' in name:
            self.send_error_json('Invalid skill name', 400)
            return

        target = self.clawd_path / 'skills' / name

        if not target.exists():
            self.send_error_json(f'Skill not found: {name}', 404)
            return

        if not target.is_dir():
            self.send_error_json(f'Not a directory: {name}', 400)
            return

        try:
            shutil.rmtree(target)

            # 重新扫描
            self.registry.plugin_tools.clear()
            self.registry.instruction_tools.clear()
            self.registry.scan_plugins()

            self.send_json({
                'status': 'ok',
                'name': name,
                'message': f'Skill uninstalled: {name}',
                'toolCount': len(self.registry.list_all()),
            })

        except Exception as e:
            self.send_error_json(f'Uninstall failed: {str(e)}', 500)

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
    
    def handle_trace_recent(self, query_params):
        """GET /api/traces/recent?days=3&limit=100 - 获取最近N天的执行日志 (供 Observer 分析)"""
        days = min(int(query_params.get('days', ['3'])[0]), 30)
        limit = min(int(query_params.get('limit', ['100'])[0]), 500)
        
        traces_dir = self.clawd_path / 'memory' / 'exec_traces'
        if not traces_dir.exists():
            self.send_json({'traces': [], 'stats': {}})
            return
        
        cutoff_time = datetime.now() - timedelta(days=days)
        cutoff_ts = cutoff_time.timestamp() * 1000  # 毫秒时间戳
        
        traces = []
        tool_freq = {}  # 工具使用频率
        nexus_freq = {}  # Nexus 使用频率
        total_turns = 0
        total_errors = 0
        
        # 从最近的月份文件开始读取
        for trace_file in sorted(traces_dir.glob('*.jsonl'), reverse=True)[:3]:
            try:
                for line in reversed(trace_file.read_text(encoding='utf-8').strip().split('\n')):
                    if not line.strip():
                        continue
                    try:
                        trace = json.loads(line)
                        ts = trace.get('timestamp', 0)
                        if ts < cutoff_ts:
                            continue  # 超出时间范围
                        
                        traces.append(trace)
                        
                        # 统计工具频率
                        for tool in trace.get('tools', []):
                            tool_name = tool.get('name', 'unknown')
                            tool_freq[tool_name] = tool_freq.get(tool_name, 0) + 1
                        
                        # 统计 Nexus 频率
                        nexus_id = trace.get('activeNexusId')
                        if nexus_id:
                            nexus_freq[nexus_id] = nexus_freq.get(nexus_id, 0) + 1
                        
                        # 统计轮次和错误
                        total_turns += trace.get('turnCount', 0)
                        total_errors += trace.get('errorCount', 0)
                        
                        if len(traces) >= limit:
                            break
                    except json.JSONDecodeError:
                        continue
            except Exception:
                continue
            if len(traces) >= limit:
                break
        
        # 按时间倒序排列
        traces.sort(key=lambda t: t.get('timestamp', 0), reverse=True)
        
        self.send_json({
            'traces': traces,
            'stats': {
                'totalExecutions': len(traces),
                'toolFrequency': tool_freq,
                'nexusFrequency': nexus_freq,
                'avgTurnsPerExecution': total_turns / len(traces) if traces else 0,
                'totalErrors': total_errors,
                'timeRangeDays': days,
            }
        })
    
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
    
    skills_dir = clawd_path / 'skills'
    skills_dir.mkdir(exist_ok=True)
    
    cleanup_old_logs(clawd_path)
    
    # 🔌 初始化工具注册表
    registry = ToolRegistry(clawd_path)
    # 注册 12 个内置工具
    builtin_names = [
        'readFile', 'writeFile', 'appendFile', 'listDir', 'runCmd',
        'weather', 'webSearch', 'webFetch', 'saveMemory', 'searchMemory',
        'nexusBindSkill', 'nexusUnbindSkill',
    ]
    for name in builtin_names:
        registry.register_builtin(name, name)  # handler resolved at dispatch time
    # 扫描插件工具
    registry.scan_plugins()
    # 扫描 MCP 服务器
    registry.scan_mcp_servers()

    # 清理过期执行追踪 (P2: 保留最近6个月)
    cleanup_old_traces(clawd_path)

    ClawdDataHandler.clawd_path = clawd_path
    ClawdDataHandler.registry = registry
    
    server = HTTPServer((args.host, args.port), ClawdDataHandler)
    
    tool_names = [t['name'] for t in registry.list_all()]
    plugin_count = len(registry.plugin_tools)
    mcp_count = len(registry.mcp_tools)
    print(f"""
+==================================================================+
|              DD-OS Native Server v{VERSION}                         |
+==================================================================+
|  Mode:    NATIVE (standalone, no OpenClaw needed)                |
|  Server:  http://{args.host}:{args.port}                                    |
|  Data:    {str(clawd_path)[:50]:<50} |
+------------------------------------------------------------------+
|  Tools:   {len(tool_names)} registered ({len(builtin_names)} builtin + {plugin_count} plugins + {mcp_count} mcp)    |
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
