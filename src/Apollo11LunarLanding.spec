# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('apollo11/webdata', 'apollo11/webdata'), ('assets/icon.ico', 'assets'), ('assets/icon.png', 'assets')]
binaries = []
hiddenimports = ['clr', 'clr_loader', 'webview.platforms.edgechromium', 'webview.platforms.winforms']
tmp_ret = collect_all('webview')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['run.py'],
    pathex=['D:/AIUSE/workbuddy/阿波罗11号模拟器'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'numpy', 'PIL', 'matplotlib', 'PyQt5', 'PySide2'],
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
    name='Apollo11LunarLanding',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['assets/icon.ico'],
)
