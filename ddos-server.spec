# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['ddos-local-server.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['http.server', 'subprocess', 'json', 'pathlib', 'threading', 'concurrent.futures'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'torch', 'tensorflow', 'scipy', 'pandas', 'PIL', 'pytesseract', 'tkinter', 'unittest'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ddos-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
