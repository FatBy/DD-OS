"""DunCrew Server - Constants and Feature Flags."""
from __future__ import annotations

import os
import platform
import re
import sys
from pathlib import Path


def _env_flag(name: str) -> bool:
    value = os.getenv(name, '')
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


LIGHT_MODE = _env_flag('DUNCREW_LIGHT')


def feature_disabled(name: str) -> bool:
    """Return whether an optional backend feature should stay unloaded."""
    return LIGHT_MODE or _env_flag(f'DUNCREW_DISABLE_{name}')


def _optional_import(flag_name: str, import_fn):
    if feature_disabled(flag_name):
        return False
    try:
        import_fn()
        return True
    except ImportError:
        return False


try:
    import yaml  # noqa: F401
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


if feature_disabled('MCP'):
    HAS_MCP = False
    MCPClientManager = None
else:
    try:
        from skills.mcp_manager import MCPClientManager
        HAS_MCP = True
    except ImportError:
        HAS_MCP = False
        MCPClientManager = None


def _import_pdf():
    import pdfplumber  # noqa: F401


def _import_docx():
    from docx import Document as DocxDocument  # noqa: F401


def _import_pptx():
    from pptx import Presentation as PptxPresentation  # noqa: F401


def _import_xlsx():
    import openpyxl  # noqa: F401


def _import_bs4():
    from bs4 import BeautifulSoup  # noqa: F401


def _import_epub():
    import ebooklib  # noqa: F401
    from ebooklib import epub as epub_lib  # noqa: F401


def _import_rtf():
    from striprtf.striprtf import rtf_to_text  # noqa: F401


def _import_trafilatura():
    import trafilatura  # noqa: F401


def _import_xlrd():
    import xlrd  # noqa: F401


def _import_charset():
    from charset_normalizer import from_bytes as charset_from_bytes  # noqa: F401


def _import_markitdown():
    from markitdown import MarkItDown as _MarkItDown  # noqa: F401


HAS_PDF = _optional_import('PARSERS', _import_pdf)
HAS_DOCX = _optional_import('PARSERS', _import_docx)
HAS_PPTX = _optional_import('PARSERS', _import_pptx)
HAS_XLSX = _optional_import('PARSERS', _import_xlsx)
HAS_BS4 = _optional_import('PARSERS', _import_bs4)
HAS_EPUB = _optional_import('PARSERS', _import_epub)
HAS_RTF = _optional_import('PARSERS', _import_rtf)
HAS_XLRD = _optional_import('PARSERS', _import_xlrd)
HAS_CHARSET = _optional_import('PARSERS', _import_charset)
HAS_MARKITDOWN = _optional_import('PARSERS', _import_markitdown)
HAS_TRAFILATURA = _optional_import('WEB_EXTRACT', _import_trafilatura)

HAS_COM = False
if platform.system() == 'Windows' and not feature_disabled('PARSERS'):
    try:
        import comtypes.client  # noqa: F401
        HAS_COM = True
    except ImportError:
        pass


def _configure_tesseract(pytesseract_module) -> None:
    import shutil as _shutil

    def _apply_tesseract_path(tesseract_exe: str) -> None:
        pytesseract_module.pytesseract.tesseract_cmd = tesseract_exe
        tessdata_dir = os.path.join(os.path.dirname(tesseract_exe), 'tessdata')
        if os.path.isdir(tessdata_dir):
            os.environ['TESSDATA_PREFIX'] = tessdata_dir

    exe_name = 'tesseract.exe' if platform.system() == 'Windows' else 'tesseract'
    candidates: list[str] = []

    if getattr(sys, 'frozen', False):
        candidates.append(str(Path(sys.executable).parent.parent / 'tesseract' / exe_name))
    else:
        project_root = Path(__file__).resolve().parent.parent
        candidates.append(str(project_root / 'vendor' / 'tesseract' / exe_name))

    resolved = False
    for candidate in candidates:
        if os.path.exists(candidate):
            _apply_tesseract_path(candidate)
            resolved = True
            break

    if not resolved:
        system_tesseract = _shutil.which('tesseract')
        if system_tesseract:
            _apply_tesseract_path(system_tesseract)
            resolved = True

    if not resolved and platform.system() == 'Windows':
        for candidate in (
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            r'D:\Program Files\Tesseract-OCR\tesseract.exe',
            r'D:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            os.path.expandvars(r'%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe'),
        ):
            if candidate and os.path.exists(candidate):
                _apply_tesseract_path(candidate)
                break


HAS_OCR = False
if not feature_disabled('OCR') and not feature_disabled('PARSERS'):
    try:
        import pytesseract
        from PIL import Image  # noqa: F401
        _configure_tesseract(pytesseract)
        HAS_OCR = True
    except ImportError:
        HAS_OCR = False


HAS_SCREEN_CAPTURE = False
if not feature_disabled('SCREEN_CAPTURE'):
    try:
        import mss as mss_lib  # noqa: F401
        import pygetwindow as gw  # noqa: F401
        HAS_SCREEN_CAPTURE = True
    except ImportError:
        HAS_SCREEN_CAPTURE = False


HAS_HYBRID_SEARCH = False
if not feature_disabled('HYBRID_SEARCH') and not feature_disabled('EMBEDDING'):
    try:
        from hybrid_search import (  # noqa: F401
            HybridSearchEngine,
            EmbeddingEngine,
            ensure_vector_table,
            index_memory_vectors,
        )
        HAS_HYBRID_SEARCH = True
    except ImportError:
        print("[Warning] hybrid_search module not available, falling back to FTS5-only search")


VERSION = "0.1.0-beta"

if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).parent.resolve()
    RESOURCES_DIR = APP_DIR.parent.resolve()
else:
    APP_DIR = Path(__file__).parent.parent.resolve()
    RESOURCES_DIR = APP_DIR


DANGEROUS_COMMAND_PATTERNS = [
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)'),
    re.compile(r'\bdel\s+/f\s+/s', re.IGNORECASE),
    re.compile(r'(?:^|[\s;|&])format\s+[a-zA-Z]:', re.IGNORECASE),
    re.compile(r'\bmkfs\b'),
    re.compile(r'\bdd\s+if=/dev'),
    re.compile(r'\breg\s+delete\s+hklm', re.IGNORECASE),
]

DANGEROUS_SHELL_PATTERNS = [
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)\s+/'),
    re.compile(r'\brm\s+-[^\s]*(?:rf|fr)\s+~'),
    re.compile(r'\bdel\s+/f\s+/s\s+/q\s+c:', re.IGNORECASE),
    re.compile(r'(?:^|[\s;|&])format\s+c:', re.IGNORECASE),
    re.compile(r'\bmkfs\b'),
    re.compile(r'\bdd\s+if=/dev'),
    re.compile(r'\breg\s+delete\s+hklm', re.IGNORECASE),
    re.compile(r'>\s*/dev/sda'),
    re.compile(r'\bchmod\s+-[rR]\s+777\s+/'),
]

DANGEROUS_COMMANDS = {'rm -rf', 'del /f /s', 'format', 'mkfs', 'dd if=/dev', 'reg delete hklm'}

SAFE_CLI_PREFIXES = ['claude', 'codex', 'npx claude', 'npx codex']

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_OUTPUT_SIZE = 512 * 1024
PLUGIN_TIMEOUT = 60

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
