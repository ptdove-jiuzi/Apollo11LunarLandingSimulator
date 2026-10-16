# -*- coding: utf-8 -*-
"""资源定位工具：兼容源码运行与 PyInstaller 单文件打包。"""

import os
import sys


def is_frozen():
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def resource_root():
    """返回打包进程序的只读资源根目录（内含 apollo11/webdata）。"""
    if is_frozen():
        return sys._MEIPASS
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def web_dir():
    return os.path.join(resource_root(), "apollo11", "webdata")


def asset_path(name):
    """图标等静态资源。打包后位于 _MEIPASS/assets，源码态位于 <root>/assets。"""
    root = resource_root()
    p = os.path.join(root, "assets", name)
    if os.path.exists(p):
        return p
    return os.path.join(root, "apollo11", "assets", name)


def app_dir():
    """可写目录：优先 exe 所在目录（用户能看到存档），否则项目根。"""
    if is_frozen():
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def user_data_dir():
    """存档目录 %USERPROFILE%/Apollo11Simulator。失败时回落到 app_dir。"""
    try:
        home = os.path.expanduser("~")
        d = os.path.join(home, "Apollo11Simulator")
        os.makedirs(d, exist_ok=True)
        return d
    except Exception:
        return app_dir()
