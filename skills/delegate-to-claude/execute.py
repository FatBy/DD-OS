#!/usr/bin/env python3
"""
Delegate to Claude Code – DunCrew Skill Plugin
================================================
Bridges DunCrew to the locally-installed Claude Code CLI,
executing coding tasks in a non-interactive subprocess.

Protocol (skill-executor convention):
  stdin  → {"tool": "delegate_to_claude", "args": {"task": "...", ...}}
  stdout → execution result (text)
  stderr → diagnostic / log messages
  exit 0 → success, non-zero → error
"""

import sys
import json
import os
import shutil
import subprocess
import logging

# ---------------------------------------------------------------------------
# Logging – all log output goes to stderr so stdout stays clean for results
# ---------------------------------------------------------------------------
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[delegate-to-claude] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Primary hard-coded path (Dogfooding environment on Windows)
CLAUDE_CMD_HARDCODED = r"C:\Users\Public\dogfooding\npm-global\claude.cmd"

# Default allowed tools when caller does not specify
DEFAULT_ALLOWED_TOOLS = "Read,Edit,Bash"

# Default timeout in seconds
DEFAULT_TIMEOUT = 120


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_claude_cli() -> str | None:
    """
    Locate the Claude Code CLI executable.
    Priority:
      1. Hard-coded Dogfooding path (Windows)
      2. ``claude`` on system PATH (cross-platform)
    Returns the resolved path string, or None if not found.
    """
    # 1. Check hard-coded path
    if os.path.isfile(CLAUDE_CMD_HARDCODED):
        log.info("Found Claude CLI at hard-coded path: %s", CLAUDE_CMD_HARDCODED)
        return CLAUDE_CMD_HARDCODED

    # 2. Fall back to PATH lookup
    found = shutil.which("claude") or shutil.which("claude.cmd")
    if found:
        log.info("Found Claude CLI on PATH: %s", found)
        return found

    return None


def build_command(
    cli_path: str,
    task: str,
    allowed_tools: str,
) -> list[str]:
    """
    Build the subprocess argument list for ``claude -p``.

    Flags used:
      -p "<task>"           → non-interactive prompt mode
      --output-format json  → structured JSON output
      --bare                → skip hooks, MCP servers, CLAUDE.md, etc.
      --allowedTools "..."  → restrict available tools
    """
    cmd = [
        cli_path,
        "-p", task,
        "--output-format", "json",
        "--bare",
        "--allowedTools", allowed_tools,
    ]
    return cmd


def extract_result(raw_stdout: str) -> str:
    """
    Attempt to parse Claude CLI JSON output and extract the ``result`` field.
    Falls back to returning raw text if parsing fails.
    """
    if not raw_stdout or not raw_stdout.strip():
        return "(Claude Code returned empty output)"

    try:
        data = json.loads(raw_stdout)

        # The CLI wraps its answer in a ``result`` key
        if isinstance(data, dict) and "result" in data:
            return data["result"]

        # If the shape is unexpected, return pretty-printed JSON
        return json.dumps(data, ensure_ascii=False, indent=2)

    except json.JSONDecodeError:
        log.warning("Claude CLI output is not valid JSON – returning raw text")
        return raw_stdout.strip()


def make_error_response(error_type: str, message: str, details: str = "") -> str:
    """Format a structured error message for the caller."""
    parts = [f"❌ [{error_type}] {message}"]
    if details:
        parts.append(f"\n详情:\n{details}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------

def run(args: dict) -> str:
    """
    Core logic: validate inputs → locate CLI → execute → return result.
    """
    # ---- 1. Parse arguments ------------------------------------------------
    task: str = (args.get("task") or "").strip()
    if not task:
        return make_error_response("INVALID_INPUT", "task 参数不能为空")

    workdir: str | None = args.get("workdir")
    allowed_tools: str = args.get("allowed_tools") or DEFAULT_ALLOWED_TOOLS
    timeout: int = int(args.get("timeout", DEFAULT_TIMEOUT))

    # Resolve & validate workdir
    if workdir:
        workdir = os.path.abspath(workdir)
        if not os.path.isdir(workdir):
            return make_error_response(
                "INVALID_INPUT",
                f"工作目录不存在: {workdir}",
            )
    else:
        workdir = os.getcwd()

    log.info("Task: %.120s…", task)
    log.info("Workdir: %s | Timeout: %ds | Tools: %s", workdir, timeout, allowed_tools)

    # ---- 2. Find Claude CLI -----------------------------------------------
    cli_path = find_claude_cli()
    if cli_path is None:
        return make_error_response(
            "CLI_NOT_FOUND",
            "未找到 Claude Code CLI。",
            "请先安装 Claude Code:\n"
            "  npm install -g @anthropic-ai/claude-code\n"
            "或确认 claude / claude.cmd 在系统 PATH 中。\n"
            f"也可检查默认路径: {CLAUDE_CMD_HARDCODED}",
        )

    # ---- 3. Build & execute command ----------------------------------------
    cmd = build_command(cli_path, task, allowed_tools)
    log.info("Executing: %s", " ".join(cmd[:4]) + " ...")

    try:
        proc = subprocess.run(
            cmd,
            cwd=workdir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            # Ensure child env inherits PATH etc.
            env={**os.environ},
        )
    except subprocess.TimeoutExpired:
        return make_error_response(
            "TIMEOUT",
            f"Claude Code 执行超时（{timeout}s）。",
            "可通过 timeout 参数增大超时时间，或简化任务描述。",
        )
    except FileNotFoundError:
        return make_error_response(
            "CLI_NOT_FOUND",
            f"无法启动 Claude CLI: {cli_path}",
            "文件可能已被移动或删除，请检查安装。",
        )
    except OSError as exc:
        return make_error_response(
            "OS_ERROR",
            f"启动子进程失败: {exc}",
        )

    # ---- 4. Process result -------------------------------------------------
    log.info("Exit code: %d | stdout length: %d | stderr length: %d",
             proc.returncode, len(proc.stdout or ""), len(proc.stderr or ""))

    if proc.stderr:
        log.info("Claude stderr:\n%s", proc.stderr[:500])

    if proc.returncode != 0:
        # Non-zero exit – treat as error but still try to extract useful output
        stderr_snippet = (proc.stderr or "").strip()[:1000]
        stdout_snippet = (proc.stdout or "").strip()[:1000]

        diagnostic = ""
        if stderr_snippet:
            diagnostic += f"stderr:\n{stderr_snippet}\n"
        if stdout_snippet:
            diagnostic += f"stdout:\n{stdout_snippet}\n"

        return make_error_response(
            "EXEC_ERROR",
            f"Claude Code 退出码 {proc.returncode}",
            diagnostic or "(无输出)",
        )

    # Success
    return extract_result(proc.stdout)


def main():
    """Entry-point: read JSON from stdin, dispatch, print result."""
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input)
    except json.JSONDecodeError as exc:
        print(make_error_response("INVALID_INPUT", f"stdin JSON 解析失败: {exc}"))
        sys.exit(1)

    # Support both flat args and nested {"tool": ..., "args": ...} envelope
    if "args" in payload and isinstance(payload["args"], dict):
        args = payload["args"]
    else:
        args = payload

    log.info("Received tool call: delegate_to_claude")

    result = run(args)
    print(result)
    sys.exit(0)


if __name__ == "__main__":
    main()
