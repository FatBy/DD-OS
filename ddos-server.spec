# -*- mode: python ; coding: utf-8 -*-
"""
DD-OS PyInstaller 配置文件
用于打包 Python 后端为独立可执行文件
"""

import sys
from pathlib import Path

# 项目根目录
ROOT = Path(SPECPATH)

a = Analysis(
    ['ddos-local-server.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # 前端构建产物 (如果存在)
        ('dist', 'dist') if (ROOT / 'dist').exists() else (None, None),
        # 技能库示例 (可选)
        # ('skills', 'skills'),
    ],
    hiddenimports=[
        'yaml',
        'http.server',
        'urllib.parse',
        'urllib.request',
        'json',
        'pathlib',
        'threading',
        'subprocess',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 排除不需要的大型库
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
        'cv2',
        'torch',
        'tensorflow',
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

# 过滤掉 None 数据
a.datas = [d for d in a.datas if d[0] is not None]

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ddos-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 保留控制台输出
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='public/favicon.ico' if (ROOT / 'public/favicon.ico').exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ddos-server',
)
