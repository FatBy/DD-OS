"""DunCrew Server - Subagent API + LLM Proxy Mixin"""
from __future__ import annotations

import json
import sys
import time
import uuid
import threading
from pathlib import Path
from datetime import datetime

from server.cleanup import run_task_in_background, read_log_chunk

class ProxyMixin:
    """Subagent API + LLM Proxy Mixin"""

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
    
    # ============================================
    # 🤖 子代理 API 处理器 (Quest 模式支持)
    # ============================================
    
    def handle_subagent_spawn(self, data):
        """启动子代理"""
        if not self.subagent_manager:
            self.send_error_json('SubagentManager not initialized', 500)
            return
        
        agent_type = data.get('type', 'explore')
        task = data.get('task', '')
        tools = data.get('tools', [])
        context = data.get('context', '')
        
        if not task:
            self.send_error_json('Missing task', 400)
            return
        
        try:
            agent_id = self.subagent_manager.spawn(agent_type, task, tools, context)
            self.send_json({
                'status': 'success',
                'agentId': agent_id,
                'message': f'Spawned {agent_type} agent'
            })
        except Exception as e:
            self.send_error_json(f'Failed to spawn agent: {e}', 500)
    
    def handle_subagent_status(self, agent_id):
        """获取子代理状态"""
        if not self.subagent_manager:
            self.send_error_json('SubagentManager not initialized', 500)
            return
        
        status = self.subagent_manager.get_status(agent_id)
        if status:
            self.send_json({'status': 'success', 'agent': status})
        else:
            self.send_error_json(f'Agent not found: {agent_id}', 404)
    
    def handle_subagent_collect(self, data):
        """收集多个子代理的结果"""
        if not self.subagent_manager:
            self.send_error_json('SubagentManager not initialized', 500)
            return
        
        agent_ids = data.get('agentIds', [])
        timeout = data.get('timeout', 60.0)
        
        if not agent_ids:
            # 返回所有代理状态
            all_status = self.subagent_manager.get_all_status()
            self.send_json({'status': 'success', 'agents': all_status})
            return
        
        try:
            results = self.subagent_manager.collect_results(agent_ids, timeout)
            self.send_json({'status': 'success', 'results': results})
        except Exception as e:
            self.send_error_json(f'Failed to collect results: {e}', 500)
    
    def handle_llm_proxy(self, data: dict):
        """代理转发 LLM API 请求（解决 CORS 问题）
        
        前端请求: POST /api/llm/proxy
        Body: { "url": "https://api.moonshot.cn/v1/chat/completions", "apiKey": "sk-...", "body": {...}, "stream": true }
        
        对于 stream=true，使用分块传输将 SSE 事件流式转发给前端。
        """
        target_url = data.get('url')
        api_key = data.get('apiKey')
        request_body = data.get('body')
        is_stream = data.get('stream', False)
        custom_headers = data.get('headers')  # 前端可传入完整 headers（Anthropic 等非 Bearer 认证）
        
        if not target_url or not request_body:
            self.send_error_json('Missing url or body', 400)
            return
        
        # 若前端未提供 apiKey 也未提供 headers，报错
        if not api_key and not custom_headers:
            self.send_error_json('Missing apiKey or headers', 400)
            return
        
        try:
            import requests as req_lib
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except ImportError as e:
            self.send_error_json(f'LLM proxy requires "requests" package: pip install requests', 500)
            return
        
        print(f'[LLM Proxy] -> {target_url} (stream={is_stream})', file=sys.stderr)
        
        # 重试配置
        MAX_RETRIES = 2           # 最多重试 2 次 (共 3 次尝试)
        RETRY_BASE_DELAY = 2.0    # 初始退避 2 秒
        CONNECT_TIMEOUT = 15      # 连接超时 15s
        READ_TIMEOUT = 600        # 读取超时 600s (给慢模型更多时间)
        
        # 构建请求头: 优先使用前端传入的 custom_headers，否则回退到 Bearer token
        if custom_headers and isinstance(custom_headers, dict):
            req_headers = {'Content-Type': 'application/json'}
            req_headers.update(custom_headers)
        else:
            req_headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
            }
        
        last_error = None
        for attempt in range(MAX_RETRIES + 1):
            # 创建独立 Session，尊重环境变量代理设置
            session = req_lib.Session()
            # trust_env=True (默认值) 让 requests 自动读取 HTTP_PROXY/HTTPS_PROXY
            
            try:
                resp = session.post(
                    target_url,
                    json=request_body,
                    headers=req_headers,
                    stream=is_stream,
                    timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                    verify=False,
                )
                
                if is_stream:
                    # 流式转发前校验状态码，避免将错误响应当作正常 SSE 流发送
                    if not resp.ok:
                        error_text = ''
                        try:
                            error_text = resp.text[:500]
                        except Exception:
                            error_text = f'HTTP {resp.status_code}'
                        print(f'[LLM Proxy] Stream HTTP error: {resp.status_code} - {error_text}', file=sys.stderr)
                        resp.close()
                        self.send_error_json(f'LLM API error ({resp.status_code}): {error_text}', resp.status_code)
                        return

                    # [诊断日志] 打印上游响应信息
                    print(f'[LLM Proxy] Upstream response: status={resp.status_code}, content-type={resp.headers.get("content-type")}, transfer-encoding={resp.headers.get("transfer-encoding")}', file=sys.stderr)

                    # 流式转发: 使用 chunked transfer encoding
                    self.send_response(resp.status_code)
                    self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                    self.send_header('Cache-Control', 'no-cache')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                    self.send_header('Transfer-Encoding', 'chunked')
                    self.end_headers()
                    
                    try:
                        # 使用 iter_lines() 逐行读取，确保 SSE 事件完整转发
                        # 兼容 Anthropic 和 OpenAI 两种 SSE 格式
                        line_count = 0
                        for line in resp.iter_lines():
                            line_count += 1
                            # [诊断日志] 打印前 5 行原始数据
                            if line_count <= 5:
                                print(f'[LLM Proxy] SSE line {line_count}: {line[:200]}', file=sys.stderr)
                            if line:
                                # 非空行：SSE 数据行 (data: {...}) 或事件类型行 (event: ...)
                                chunk_data = line + b'\n'
                                self.wfile.write(f'{len(chunk_data):x}\r\n'.encode())
                                self.wfile.write(chunk_data)
                                self.wfile.write(b'\r\n')
                                self.wfile.flush()
                            else:
                                # 空行：SSE 事件边界分隔符
                                chunk_data = b'\n'
                                self.wfile.write(f'{len(chunk_data):x}\r\n'.encode())
                                self.wfile.write(chunk_data)
                                self.wfile.write(b'\r\n')
                                self.wfile.flush()
                        # [诊断日志] 打印流结束统计
                        print(f'[LLM Proxy] Stream ended, total lines forwarded: {line_count}', file=sys.stderr)
                        # 终止 chunk
                        self.wfile.write(b'0\r\n\r\n')
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # 客户端断开
                    finally:
                        resp.close()
                else:
                    # 非流式: 直接转发响应
                    if resp.ok:
                        try:
                            self.send_json(resp.json())
                        except Exception:
                            self.send_response(resp.status_code)
                            self.send_header('Content-Type', 'application/json')
                            self.send_header('Access-Control-Allow-Origin', '*')
                            self.end_headers()
                            self.wfile.write(resp.content)
                    else:
                        error_text = resp.text[:500]
                        print(f'[LLM Proxy] HTTP error: {resp.status_code} - {error_text}', file=sys.stderr)
                        self.send_error_json(f'LLM API error ({resp.status_code}): {error_text}', resp.status_code)
                
                # 成功，跳出重试循环
                return
            
            except (req_lib.exceptions.ConnectTimeout, req_lib.exceptions.ReadTimeout, req_lib.exceptions.ConnectionError) as e:
                last_error = e
                session.close()
                if attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    err_type = type(e).__name__
                    print(f'[LLM Proxy] {err_type} on attempt {attempt + 1}/{MAX_RETRIES + 1}, retrying in {delay:.1f}s ...', file=sys.stderr)
                    time.sleep(delay)
                    continue
                # 最后一次重试也失败了，向前端返回错误
                if isinstance(e, req_lib.exceptions.ConnectTimeout):
                    self.send_error_json(f'LLM API connect timeout (after {MAX_RETRIES + 1} attempts)', 504)
                elif isinstance(e, req_lib.exceptions.ReadTimeout):
                    self.send_error_json(f'LLM API read timeout (after {MAX_RETRIES + 1} attempts)', 504)
                else:
                    self.send_error_json(f'Failed to connect to LLM API (after {MAX_RETRIES + 1} attempts): {str(e)[:200]}', 502)
            except Exception as e:
                session.close()
                print(f'[LLM Proxy] Error: {type(e).__name__}: {e}', file=sys.stderr)
                self.send_error_json(f'LLM proxy error: {type(e).__name__}: {str(e)[:200]}', 500)
                return
            finally:
                session.close()

    def handle_llm_claude_code(self, data: dict):
        """通过本机 Claude Code CLI 代理 LLM 请求，将 stream-json 翻译为 OpenAI SSE"""
        import subprocess
        import os
        import shutil

        messages = data.get('messages', [])
        workdir = data.get('workdir') or os.getcwd()
        perm_mode = data.get('permissionMode', 'bypassPermissions')
        model = data.get('model')
        system_prompt = data.get('systemPrompt')
        allowed_tools = data.get('allowedTools')

        # 1. 定位 Claude CLI
        claude_cmd = None
        hardcoded = r'C:\Users\Public\dogfooding\npm-global\claude.cmd'
        if os.path.exists(hardcoded):
            claude_cmd = hardcoded
        else:
            found = shutil.which('claude') or shutil.which('claude.cmd')
            if found:
                claude_cmd = found

        if not claude_cmd:
            self.send_error_json('Claude Code CLI not found. Please install @anthropic-ai/claude-code or @ali/claude-code globally.', 500)
            return

        # 2. 构建命令参数
        args = [claude_cmd, '-p',
                '--output-format', 'stream-json',
                '--verbose',
                '--permission-mode', perm_mode]
        if model:
            args += ['--model', model]
        if allowed_tools:
            args += ['--allowedTools', allowed_tools]
        if system_prompt:
            args += ['--append-system-prompt', system_prompt]

        # 3. 将 messages 拼接为 user prompt
        user_text = '\n\n'.join(
            m.get('content', '') for m in messages if m.get('content') and isinstance(m.get('content'), str)
        )
        if not user_text:
            user_text = 'Hello'

        # 4. 启动子进程（设置环境变量避免子进程 stdout 缓冲）
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        env['FORCE_COLOR'] = '0'  # 避免 Node.js TTY 检测导致的缓冲切换
        env.setdefault('NODE_OPTIONS', '')
        try:
            proc = subprocess.Popen(
                args,
                cwd=workdir,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                bufsize=1,
                env=env,
            )
        except Exception as e:
            self.send_error_json(f'Failed to start Claude Code: {str(e)}', 500)
            return

        # 写入用户消息并关闭 stdin
        try:
            proc.stdin.write(user_text)
            proc.stdin.flush()
            proc.stdin.close()
        except Exception:
            pass

        # 5. 设置 SSE 响应头
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()

        def emit_sse(payload: dict):
            """发送一个 SSE data 事件（OpenAI 格式）"""
            line = f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            chunk_data = line.encode('utf-8')
            self.wfile.write(f'{len(chunk_data):x}\r\n'.encode())
            self.wfile.write(chunk_data)
            self.wfile.write(b'\r\n')
            self.wfile.flush()

        # 6. 逐行读取 stdout，翻译为 OpenAI SSE
        # 使用 readline() 避免 for-in 迭代器的预读缓冲，确保实时逐行传递
        try:
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue

                ev_type = ev.get('type', '')

                if ev_type == 'assistant':
                    msg = ev.get('message', {})
                    content_blocks = msg.get('content', [])
                    for block in content_blocks:
                        block_type = block.get('type', '')
                        if block_type == 'text':
                            text = block.get('text', '')
                            if text:
                                emit_sse({"choices": [{"delta": {"content": text}}]})
                        elif block_type == 'thinking':
                            thinking = block.get('thinking', '')
                            if thinking:
                                emit_sse({"choices": [{"delta": {"reasoning_content": thinking}}]})
                        elif block_type == 'tool_use':
                            tool_name = block.get('name', 'unknown')
                            tool_id = block.get('id', '')
                            tool_input = block.get('input', {})
                            desc = tool_input.get('description', '') or tool_input.get('command', '') or str(tool_input)[:100]
                            # 保留原有文本提示
                            emit_sse({"choices": [{"delta": {"content": f"\n> \U0001f527 [{tool_name}] {desc}\n"}}]})
                            # 新增：结构化工具启动事件（截断 tool_input 避免 SSE 数据过大）
                            truncated_input = {}
                            for k, v in (tool_input or {}).items():
                                sv = str(v)
                                truncated_input[k] = sv[:300] if len(sv) > 300 else v
                            emit_sse({"x_event": "tool_start", "tool_name": tool_name, "tool_id": tool_id, "tool_input": truncated_input})

                elif ev_type == 'user':
                    # Claude Code 的工具执行结果
                    msg = ev.get('message', {})
                    content_blocks = msg.get('content', [])
                    for block in content_blocks:
                        if block.get('type') == 'tool_result':
                            tool_use_id = block.get('tool_use_id', '')
                            is_error = block.get('is_error', False)
                            # 提取结果摘要（截断到200字符）
                            result_content = block.get('content', '')
                            if isinstance(result_content, list):
                                result_content = ' '.join(b.get('text', '') for b in result_content if b.get('type') == 'text')
                            result_summary = str(result_content)[:200] if result_content else ''
                            emit_sse({"x_event": "tool_end", "tool_id": tool_use_id, "is_error": is_error, "result_summary": result_summary})

                elif ev_type == 'system':
                    subtype = ev.get('subtype', '')
                    if subtype == 'task_started':
                        desc = ev.get('description', '')
                        if desc:
                            emit_sse({"choices": [{"delta": {"content": f"\n> \u26a1 {desc}\n"}}]})

                elif ev_type == 'result':
                    usage = ev.get('usage', {})
                    finish_payload = {
                        "choices": [{"delta": {}, "finish_reason": "stop"}]
                    }
                    if usage:
                        finish_payload["usage"] = {
                            "prompt_tokens": usage.get('input_tokens', 0) + usage.get('cache_read_input_tokens', 0),
                            "completion_tokens": usage.get('output_tokens', 0),
                        }
                    emit_sse(finish_payload)

        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                emit_sse({"choices": [{"delta": {"content": f"\n\n\u274c Error: {str(e)}"}}]})
                emit_sse({"choices": [{"delta": {}, "finish_reason": "stop"}]})
            except Exception:
                pass
        finally:
            try:
                self.wfile.write(b'0\r\n\r\n')
                self.wfile.flush()
            except Exception:
                pass
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                pass

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


