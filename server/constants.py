"""DunCrew Server - Constants and Feature Flags"""
from __future__ import annotations

import os
import sys
import platform
from pathlib import Path

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

# 文件解析 (可选依赖，缺失时降级)
try:
    import pdfplumber
    HAS_PDF = True
except ImportError:
    HAS_PDF = False

try:
    from docx import Document as DocxDocument
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    from pptx import Presentation as PptxPresentation
    HAS_PPTX = True
except ImportError:
    HAS_PPTX = False

try:
    import pytesseract
    from PIL import Image
    # pytesseract 只是 Python 包装，真正执行 OCR 依赖系统里的 tesseract 二进制。
    # 发现顺序（优先级由高到低）：
    #   1. 随包分发的 Tesseract：
    #      - frozen 生产模式：electron-builder extraResources 放到 resources/tesseract/
    #        (PyInstaller 产物在 resources/duncrew-server/，所以相对路径为 ../tesseract/)
    #      - 开发模式：项目根 vendor/tesseract/ （用于本地调试打包产物前的真实行为）
    #   2. 系统 PATH（shutil.which）
    #   3. Windows 常见安装目录扫描
    # 命中任何一条都会同时设置 TESSDATA_PREFIX，确保 Tesseract 能找到语言包。
    import shutil as _shutil

    def _apply_tesseract_path(tesseract_exe: str) -> None:
        """配置 pytesseract 使用指定的 tesseract.exe，并绑定对应的 tessdata 目录"""
        pytesseract.pytesseract.tesseract_cmd = tesseract_exe
        tessdata_dir = os.path.join(os.path.dirname(tesseract_exe), 'tessdata')
        if os.path.isdir(tessdata_dir):
            # TESSDATA_PREFIX 是 Tesseract 查找 *.traineddata 的官方约定环境变量
            os.environ['TESSDATA_PREFIX'] = tessdata_dir

    _tesseract_exe_name = 'tesseract.exe' if platform.system() == 'Windows' else 'tesseract'
    _bundled_candidates: list[str] = []

    if getattr(sys, 'frozen', False):
        # PyInstaller onedir：sys.executable = .../resources/duncrew-server/duncrew-server.exe
        # 随包分发的 Tesseract 在同级的 ../tesseract/ 目录下
        _bundled_candidates.append(
            str(Path(sys.executable).parent.parent / 'tesseract' / _tesseract_exe_name)
        )
    else:
        # 开发模式：项目根目录下的 vendor/tesseract/
        _project_root = Path(__file__).resolve().parent.parent
        _bundled_candidates.append(
            str(_project_root / 'vendor' / 'tesseract' / _tesseract_exe_name)
        )

    _resolved = False
    for _cand in _bundled_candidates:
        if os.path.exists(_cand):
            _apply_tesseract_path(_cand)
            _resolved = True
            break

    # 系统 PATH 兜底（开发机已装了的场景）
    if not _resolved:
        _sys_tesseract = _shutil.which('tesseract')
        if _sys_tesseract:
            _apply_tesseract_path(_sys_tesseract)
            _resolved = True

    # Windows 常见安装路径兜底
    if not _resolved and platform.system() == 'Windows':
        for _candidate in (
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            r'D:\Program Files\Tesseract-OCR\tesseract.exe',
            r'D:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            os.path.expandvars(r'%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe'),
        ):
            if _candidate and os.path.exists(_candidate):
                _apply_tesseract_path(_candidate)
                _resolved = True
                break

    HAS_OCR = True
except ImportError:
    HAS_OCR = False

# Excel 解析 (可选依赖)
try:
    import openpyxl
    HAS_XLSX = True
except ImportError:
    HAS_XLSX = False

# HTML 解析 (可选依赖)
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# ePub 解析 (可选依赖)
try:
    import ebooklib
    from ebooklib import epub as epub_lib
    HAS_EPUB = True
except ImportError:
    HAS_EPUB = False

# RTF 解析 (可选依赖)
try:
    from striprtf.striprtf import rtf_to_text
    HAS_RTF = True
except ImportError:
    HAS_RTF = False

# 网页正文提取 (可选依赖，缺失时降级到正则剥离)
try:
    import trafilatura
    HAS_TRAFILATURA = True
except ImportError:
    HAS_TRAFILATURA = False

# Windows COM 自动化 (.doc/.wps/.ppt 解析，仅 Windows)
HAS_COM = False
if platform.system() == 'Windows':
    try:
        import comtypes.client
        HAS_COM = True
    except ImportError:
        pass

# 旧版 .xls 解析 (xlrd，openpyxl 不支持 .xls)
HAS_XLRD = False
try:
    import xlrd
    HAS_XLRD = True
except ImportError:
    pass

# 智能编码检测 (charset-normalizer)
HAS_CHARSET = False
try:
    from charset_normalizer import from_bytes as charset_from_bytes
    HAS_CHARSET = True
except ImportError:
    pass

# MarkItDown - 结构化文件转 Markdown (microsoft/markitdown)
HAS_MARKITDOWN = False
try:
    from markitdown import MarkItDown as _MarkItDown
    HAS_MARKITDOWN = True
except ImportError:
    pass

# 屏幕截图 (可选依赖)
try:
    import mss as mss_lib
    import pygetwindow as gw
    HAS_SCREEN_CAPTURE = True
except ImportError:
    HAS_SCREEN_CAPTURE = False

# V4: 混合搜索引擎 (可选依赖)
try:
    from hybrid_search import (
        HybridSearchEngine, EmbeddingEngine,
        ensure_vector_table, index_memory_vectors,
    )
    HAS_HYBRID_SEARCH = True
except ImportError:
    HAS_HYBRID_SEARCH = False
    print("[Warning] hybrid_search module not available, falling back to FTS5-only search")

VERSION = "0.1.0-beta"

# 应用根目录 (兼容 PyInstaller frozen 模式)
if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).parent.resolve()
    RESOURCES_DIR = APP_DIR.parent.resolve()
else:
    APP_DIR = Path(__file__).parent.parent.resolve()  # 项目根目录 (server/ 的上级)
    RESOURCES_DIR = APP_DIR

import re

# 安全配置 - 使用正则表达式精确匹配，避免误报
DANGEROUS_COMMAND_PATTERNS = [
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)'),          # rm -rf / rm -fr
    re.compile(r'\bdel\s+/f\s+/s', re.IGNORECASE),   # del /f /s
    re.compile(r'(?:^|[\s;|&])format\s+[a-zA-Z]:', re.IGNORECASE),  # format C:
    re.compile(r'\bmkfs\b'),                          # mkfs
    re.compile(r'\bdd\s+if=/dev'),                    # dd if=/dev
    re.compile(r'\breg\s+delete\s+hklm', re.IGNORECASE),  # reg delete HKLM
]

DANGEROUS_SHELL_PATTERNS = [
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)\s+/'),      # rm -rf /
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)\s+~'),      # rm -rf ~
    re.compile(r'\bdel\s+/f\s+/s\s+/q\s+c:', re.IGNORECASE),  # del /f /s /q c:
    re.compile(r'(?:^|[\s;|&])format\s+c:', re.IGNORECASE),     # format c:
    re.compile(r'\bmkfs\b'),                          # mkfs
    re.compile(r'\bdd\s+if=/dev'),                    # dd if=/dev
    re.compile(r'\breg\s+delete\s+hklm', re.IGNORECASE),       # reg delete hklm
    re.compile(r'>\s*/dev/sda'),                       # > /dev/sda
    re.compile(r'\bchmod\s+-[rR]\s+777\s+/'),        # chmod -r 777 /
]

# 向后兼容：保留旧集合名称，但标记为 deprecated
# noinspection PyUnresolvedReferences
DANGEROUS_COMMANDS = {'rm -rf', 'del /f /s', 'format', 'mkfs', 'dd if=/dev', 'reg delete hklm'}

# 已知安全的 CLI 工具前缀列表
# 这些命令本身是安全的 LLM/Agent CLI，其参数内容不应触发危险检测
SAFE_CLI_PREFIXES = ['claude', 'codex', 'npx claude', 'npx codex']

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_OUTPUT_SIZE = 512 * 1024      # 512KB
PLUGIN_TIMEOUT = 60               # 插件执行超时(秒)

MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
}
