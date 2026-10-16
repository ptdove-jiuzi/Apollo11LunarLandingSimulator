# -*- coding: utf-8 -*-
"""阿波罗11号登月模拟器 —— 启动入口。

用法：
    python run.py              正常启动图形界面
    APOLLO11_HEADLESS=1 python run.py   仅自检资源（用于打包后冒烟测试）
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def headless_check():
    from apollo11.paths import web_dir, asset_path, is_frozen
    from apollo11 import __version__
    ok = True
    idx = os.path.join(web_dir(), "index.html")
    print("版本      :", __version__)
    print("打包模式  :", is_frozen())
    print("界面目录  :", web_dir())
    print("index.html:", "存在" if os.path.exists(idx) else "缺失")
    ok = ok and os.path.exists(idx)
    js = os.path.join(web_dir(), "js")
    files = sorted(os.listdir(js)) if os.path.isdir(js) else []
    print("脚本数量  :", len(files), files)
    ok = ok and len(files) >= 8
    progs = os.path.join(web_dir(), "programs")
    pf = sorted(os.listdir(progs)) if os.path.isdir(progs) else []
    print("示例程序  :", pf)
    icon = asset_path("icon.ico")
    print("图标      :", icon, "存在" if os.path.exists(icon) else "缺失")
    ok = ok and os.path.exists(icon)
    try:
        import webview
        print("pywebview :", webview.__version__ if hasattr(webview, "__version__") else "ok")
    except Exception as exc:
        print("pywebview : 不可用 -", exc)
    print("结论      :", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    if os.environ.get("APOLLO11_HEADLESS"):
        return headless_check()
    from apollo11.app import main as run
    return run()


if __name__ == "__main__":
    sys.exit(main())
