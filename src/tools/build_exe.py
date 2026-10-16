# -*- coding: utf-8 -*-
"""用 PyInstaller 打包为单文件 EXE。

用法： python tools/build_exe.py
产物： dist/Apollo11LunarLanding.exe
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_EXE = "Apollo11LunarLanding"


def main():
    os.chdir(ROOT)
    sep = ";" if sys.platform.startswith("win") else ":"
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", APP_EXE,
        "--icon", os.path.join("assets", "icon.ico"),
        "--add-data", "apollo11/webdata" + sep + "apollo11/webdata",
        "--add-data", "assets/icon.ico" + sep + "assets",
        "--add-data", "assets/icon.png" + sep + "assets",
        "--collect-all", "webview",
        "--hidden-import", "clr",
        "--hidden-import", "clr_loader",
        "--hidden-import", "webview.platforms.edgechromium",
        "--hidden-import", "webview.platforms.winforms",
        "--exclude-module", "tkinter",
        "--exclude-module", "numpy",
        "--exclude-module", "PIL",
        "--exclude-module", "matplotlib",
        "--exclude-module", "PyQt5",
        "--exclude-module", "PySide2",
        "--paths", ROOT,
        "run.py",
    ]
    print("执行:", " ".join(args[:6]), "...")
    rc = subprocess.call(args)
    if rc != 0:
        print("打包失败，返回码", rc)
        return rc
    out = os.path.join(ROOT, "dist", APP_EXE + (".exe" if sys.platform.startswith("win") else ""))
    if os.path.exists(out):
        print("打包成功:", out, "(%.1f MB)" % (os.path.getsize(out) / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
