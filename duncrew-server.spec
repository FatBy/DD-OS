# -*- mode: python ; coding: utf-8 -*-
"""
DunCrew Server — PyInstaller Spec (onedir 模式)
产物: dist/duncrew-server/duncrew-server.exe

用法:
  pyinstaller duncrew-server.spec --clean --noconfirm
"""

import sys
import os

block_cipher = None

# 项目根目录
PROJECT_ROOT = os.path.abspath('.')

# 平台相关的 hiddenimports
_platform_imports = []
if sys.platform == 'win32':
    _platform_imports = ['winreg', 'mss.windows', 'pygetwindow']
elif sys.platform == 'darwin':
    _platform_imports = ['mss.darwin']
else:
    _platform_imports = ['mss.linux']

# 图标（macOS/Linux 无 .ico）
_icon_path = os.path.join(PROJECT_ROOT, 'src-tauri', 'icons', 'icon.ico')
if not os.path.exists(_icon_path):
    _icon_path = None

a = Analysis(
    ['duncrew-server.py'],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=[],
    hiddenimports=[
        # ── server/ 包模块 (拆分后需要显式声明) ──
        'server',
        'server.constants',
        'server.startup',
        'server.utils',
        'server.browser',
        'server.embedding',
        'server.state',
        'server.db',
        'server.registry',
        'server.subagent',
        'server.cleanup',
        'server.handler',
        'server.main',
        'server.handlers',
        'server.handlers.session',
        'server.handlers.memory',
        'server.handlers.data',
        'server.handlers.analysis',
        'server.handlers.tools',
        'server.handlers.parsers',
        'server.handlers.web',
        'server.handlers.browser_tools',
        'server.handlers.dun_tools',
        'server.handlers.skills',
        'server.handlers.duns',
        'server.handlers.mcp',
        'server.handlers.clawhub',
        'server.handlers.traces',
        'server.handlers.proxy',

        # ── 本地模块 ──
        'hybrid_search',
        'skills',
        'skills.mcp_manager',
        'skills.mcp_client',

        # ── 可选第三方依赖 (duncrew-server.py 中 try/except 导入) ──
        'yaml',
        'pdfplumber',
        'docx', 'docx.opc', 'docx.opc.constants',
        'pptx',
        'pytesseract',
        'PIL', 'PIL.Image',
        'openpyxl',
        'bs4',
        'ebooklib', 'ebooklib.epub',
        'striprtf', 'striprtf.striprtf',
        'trafilatura',
        'mss',

        # ── Embedding 核心依赖 ──
        'onnxruntime',
        'onnxruntime.capi',
        'onnxruntime.capi._pybind_state',
        'tokenizers',
        'numpy',

        # ── HTTP 客户端依赖链 ──
        'httpx',
        'httpx._transports',
        'httpx._transports.default',
        'httpcore',
        'anyio',
        'anyio._backends',
        'anyio._backends._asyncio',
        'h11',
        'sniffio',
        'certifi',
        'idna',

        # ── 标准库 (PyInstaller 有时遗漏) ──
        'sqlite3',
        'csv',
        'http.server',
        'concurrent.futures',
    ] + _platform_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 排除未使用的大型包，显著减小体积
        'torch', 'torchaudio', 'torchvision',
        'tensorflow', 'keras',
        'transformers', 'sentence_transformers',
        'huggingface_hub',
        'scipy', 'pandas', 'matplotlib',
        'tkinter', '_tkinter',
        'unittest', 'test',
        'playwright',
        'IPython', 'notebook', 'jupyter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='duncrew-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,              # 禁用 UPX: 避免杀软误报 + ONNX Runtime DLL 兼容问题
    console=True,           # 控制台模式: Electron 通过 windowsHide 隐藏窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon_path,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='duncrew-server',
)
