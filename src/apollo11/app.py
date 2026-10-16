# -*- coding: utf-8 -*-
"""程序入口。

两条渲染通道：
  1) pywebview（Edge WebView2 内核）—— 首选，独立原生窗口；
  2) 本地 HTTP 服务 + 浏览器「应用窗口」—— 兜底。当 WebView2 运行时缺失或
     崩溃（本机出现过 msedgewebview2 崩溃）时自动切换，并把选择记入
     %USERPROFILE%/Apollo11Simulator/config.json，下次直接走可用通道。

环境变量：
  APOLLO11_GUI=browser|webview   强制指定通道
  APOLLO11_DEBUG=1               打开 WebView2 开发者工具
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from . import __app_name__, __version__
from .paths import web_dir, asset_path, user_data_dir
from .bridge import Bridge


# ---------------------------------------------------------------- 小工具
def _log(msg):
    try:
        p = os.path.join(user_data_dir(), "startup.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write("%s  %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass
    try:
        print("[Apollo11]", msg)
    except Exception:
        pass


def _index_html():
    return os.path.join(web_dir(), "index.html")


def _config_path():
    return os.path.join(user_data_dir(), "config.json")


DEFAULT_GUI = "browser"      # 默认通道：浏览器应用窗口（兼容性最好，不依赖 WebView2）


def _read_pref():
    try:
        with open(_config_path(), "r", encoding="utf-8") as f:
            return json.load(f).get("gui", DEFAULT_GUI)
    except Exception:
        return DEFAULT_GUI


def _write_pref(mode):
    try:
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump({"gui": mode}, f)
    except Exception:
        pass


def _set_app_user_model_id():
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            "Apollo11.Mission.Simulator.1")
    except Exception:
        pass


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _webview2_installed():
    """检查 Edge WebView2 运行时是否已安装（注册表）。"""
    if not sys.platform.startswith("win"):
        return True
    try:
        import winreg
    except Exception:
        return True
    keys = [
        (winreg.HKEY_LOCAL_MACHINE,
         r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients"
         r"\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_LOCAL_MACHINE,
         r"SOFTWARE\Microsoft\EdgeUpdate\Clients"
         r"\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_CURRENT_USER,
         r"SOFTWARE\Microsoft\EdgeUpdate\Clients"
         r"\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
    ]
    for root, path in keys:
        try:
            with winreg.OpenKey(root, path) as k:
                v, _ = winreg.QueryValueEx(k, "pv")
                if v and str(v) != "0.0.0.0":
                    _log("检测到 WebView2 运行时版本 %s" % v)
                    return True
        except Exception:
            continue
    _log("未检测到 WebView2 运行时")
    return False


# ---------------------------------------------------------------- 浏览器模式
BROWSER_CANDIDATES = [
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
]


def _find_browser():
    for c in BROWSER_CANDIDATES:
        p = os.path.expandvars(c)
        if os.path.exists(p):
            return p
    return None


def _run_http_server(port):
    """本地静态服务（浏览器兜底通道）。

    ⚠ 这里踩过一个只在**打包版**才出现的坑：`--windowed` 的 PyInstaller 程序
    里 `sys.stderr` 是 None，而 `BaseHTTPRequestHandler.log_message` 会
    `sys.stderr.write(...)` —— 于是**每个请求**都在日志那一步抛
    AttributeError，socketserver 直接把连接关掉，浏览器看到的是一句
    `ERR_EMPTY_RESPONSE`（127.0.0.1 未发送任何数据），而程序自己的启动日志
    一切正常（服务确实起来了，只是每个响应都炸了）。
    旧写法 `handler.log_message = lambda ...` 是**无效**的：给
    functools.partial 对象挂属性不会影响实例的方法解析，等于没静音。
    正确做法是派生子类覆盖 log_message/log_error，并把服务端异常落盘，
    否则打包版出问题只能看到"空响应"，无从下手。
    """
    import functools
    import http.server
    import traceback

    class _Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args, **kwargs):      # 静音（stderr 可能是 None）
            pass

        def log_error(self, *args, **kwargs):
            pass

    class _Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

        def handle_error(self, request, client_address):
            _log("HTTP 处理异常: " +
                 traceback.format_exc().replace("\n", " | ")[-900:])

    handler = functools.partial(_Handler, directory=web_dir())
    try:
        httpd = _Server(("127.0.0.1", port), handler)
    except Exception:
        _log("HTTP 服务启动失败: " +
             traceback.format_exc().replace("\n", " | ")[-900:])
        raise
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    _log("本地服务已监听 http://127.0.0.1:%d/  根目录=%s" % (port, web_dir()))
    return httpd


def _lock_path():
    return os.path.join(user_data_dir(), "instance.json")


def _running_instance():
    """已有一个实例在服务吗？有就返回它的 URL。

    为什么要这个：浏览器「应用窗口」模式下，关掉窗口**不会**结束进程
    （进程还要继续提供本地服务），于是每双击一次 EXE 就多堆一个常驻进程、
    多占一个端口 —— 本机实测堆到 5 个，用户完全看不出哪个是"当前那个"。
    现在第二次启动会直接复用已有实例，不再新起服务。
    """
    try:
        with open(_lock_path(), "r", encoding="utf-8") as f:
            port = int(json.load(f).get("port"))
    except Exception:
        return None
    try:
        s = socket.create_connection(("127.0.0.1", port), 1.2)
        s.close()
    except Exception:
        return None
    # ★ 只 TCP 通不算活：实测有"进程还在但 _MEI 临时目录已被清掉"的僵尸实例，
    #   端口能连、却对每个请求返回 404（用户看到"Error response 404 File not
    #   found"，双击 EXE 打不开）。必须真的请求一次页面并确认 200 才算活。
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:%d/index.html" % port,
                                    timeout=2.5) as resp:
            if resp.status != 200:
                return None
    except Exception:
        return None
    return "http://127.0.0.1:%d/index.html" % port


def _clear_lock():
    """退出时清掉自己写的锁文件，避免留下"端口能连但服务已死"的僵尸记录。"""
    try:
        pth = _lock_path()
        if os.path.exists(pth):
            with open(pth, "r", encoding="utf-8") as f:
                d = json.load(f)
            if int(d.get("pid", -1)) == os.getpid():
                os.remove(pth)
    except Exception:
        pass


def _write_lock(port):
    try:
        with open(_lock_path(), "w", encoding="utf-8") as f:
            json.dump({"port": port, "pid": os.getpid()}, f)
    except Exception:
        pass


try:
    import atexit as _atexit
    _atexit.register(_clear_lock)
except Exception:
    pass


def _open_browser(url, reason=""):
    exe = _find_browser()
    if exe:
        # 以「应用窗口」方式打开：没有地址栏与标签页，接近原生程序
        for flags in (["--app=" + url, "--window-size=1680,1000"],
                      ["--new-window", url]):
            try:
                subprocess.Popen([exe] + flags)
                _log("已用浏览器应用窗口打开：%s  (%s)" % (exe, reason))
                return True
            except Exception as exc:
                _log("浏览器启动失败：%s" % exc)
    webbrowser.open(url)
    _log("已用默认浏览器打开：%s  (%s)" % (url, reason))
    return False


def browser_mode(port=None, reason=""):
    if port is None:
        url0 = _running_instance()
        if url0:
            _log("已有实例在运行，直接复用：%s" % url0)
            _open_browser(url0, "复用已有实例")
            return 0
    port = port or _free_port()
    _run_http_server(port)
    _write_lock(port)
    url = "http://127.0.0.1:%d/index.html" % port
    _open_browser(url, reason)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        _clear_lock()
    return 0


# ---------------------------------------------------------------- WebView 模式
def _try_webview(bridge):
    try:
        import webview
    except Exception as exc:
        _log("pywebview 导入失败：%s" % exc)
        return False

    icon = asset_path("icon.ico")
    if not os.path.exists(icon):
        icon = None

    title = "%s  v%s" % (__app_name__, __version__)
    state = {"ready": False, "diag": "", "err": ""}

    window = webview.create_window(
        title, url=_index_html(), js_api=bridge,
        width=1680, height=1000, min_size=(1180, 760),
        background_color="#05070d", confirm_close=False, text_select=False)
    bridge._window = window

    def _worker(win, br, st):
        """轮询页面诊断；长时间拿不到说明 WebView 起不来，主动结束窗口。"""
        deadline = time.time() + 25
        while time.time() < deadline:
            time.sleep(2.0)
            try:
                diag = win.evaluate_js("window.__APOLLO_DIAG__ || ''")
            except Exception as exc:
                diag = ""
                st["err"] = str(exc)
            if diag:
                st["ready"] = True
                st["diag"] = diag
                try:
                    with open(os.path.join(br.base, "diagnostics.txt"), "w",
                              encoding="utf-8") as f:
                        f.write(diag + "\n")
                except Exception:
                    pass
                _log("页面诊断: " + str(diag)[:300].replace("\n", " | "))
                return
        _log("WebView 内页面未在 25 秒内完成初始化，改用浏览器模式（%s）"
             % (st.get("err") or "无诊断返回"))
        try:
            win.destroy()
        except Exception:
            pass

    try:
        webview.start(_worker, (window, bridge, state), icon=icon,
                      debug=bool(os.environ.get("APOLLO11_DEBUG")),
                      private_mode=False, storage_path=bridge.base)
    except Exception as exc:
        _log("webview.start 异常：%s" % exc)
        try:
            window.destroy()
        except Exception:
            pass
        return False

    if state["ready"]:
        _log("webview 正常退出")
        return True
    return False


# ---------------------------------------------------------------- 入口
def main():
    _set_app_user_model_id()
    if not os.path.exists(_index_html()):
        _log("找不到界面资源：%s" % _index_html())
        return 2

    bridge = Bridge()
    env = os.environ.get("APOLLO11_GUI", "").strip().lower()
    pref = _read_pref()
    mode = env or pref
    _log("启动 v%s  模式=%s  打包=%s"
         % (__version__, mode, bool(getattr(sys, "frozen", False))))

    if mode in ("browser", "auto"):
        # 默认就用浏览器应用窗口：Edge / Chrome 的 --app= 模式没有地址栏与标签页，
        # 观感与原生窗口一致，且完全不依赖 WebView2 运行时（本机 WebView2 会崩溃）。
        return browser_mode(reason="默认通道（可在 config.json 或 APOLLO11_GUI 中改为 webview）")

    if not _webview2_installed():
        _write_pref("browser")
        return browser_mode(reason="未安装 WebView2 运行时")

    ok = _try_webview(bridge)
    if ok:
        return 0
    _write_pref("browser")
    return browser_mode(reason="WebView2 启动失败，已记录以便下次直接走浏览器模式")


# 也可显式指定：Apollo11LunarLanding.exe --webview / --browser
if len(sys.argv) > 1:
    if sys.argv[1] == "--webview":
        os.environ["APOLLO11_GUI"] = "webview"
    elif sys.argv[1] == "--browser":
        os.environ["APOLLO11_GUI"] = "browser"


if __name__ == "__main__":
    sys.exit(main())
