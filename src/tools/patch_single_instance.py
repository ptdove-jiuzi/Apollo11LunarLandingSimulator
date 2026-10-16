# -*- coding: utf-8 -*-
# 单实例复用的"僵尸实例"修复：
#   旧逻辑只做 TCP connect 探活 —— 实测进程还在、但 PyInstaller 的 _MEI 临时
#   目录被清掉的僵尸实例照样能连上，然后对每个请求返回 404（用户报"打不开"）。
#   1) 复用前必须真的 GET 一次 /index.html 并确认 200；
#   2) 退出时清理自己写的锁文件（atexit + KeyboardInterrupt），别留给下一位。
import io
p = 'apollo11/app.py'
s = io.open(p, encoding='utf-8').read()
old = """    try:
        s = socket.create_connection(("127.0.0.1", port), 1.2)
        s.close()
    except Exception:
        return None
    return "http://127.0.0.1:%d/index.html" % port"""
new = """    try:
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
    \"\"\"退出时清掉自己写的锁文件，避免留下"端口能连但服务已死"的僵尸记录。\"\"\"
    try:
        pth = _lock_path()
        if os.path.exists(pth):
            with open(pth, "r", encoding="utf-8") as f:
                d = json.load(f)
            if int(d.get("pid", -1)) == os.getpid():
                os.remove(pth)
    except Exception:
        pass"""
assert s.count(old) == 1
s = s.replace(old, new)
# atexit 注册 + KeyboardInterrupt 时清理
old2 = """def _open_browser(url, reason=""):"""
new2 = """try:
    import atexit as _atexit
    _atexit.register(_clear_lock)
except Exception:
    pass


def _open_browser(url, reason=""):"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
old3 = """    except KeyboardInterrupt:
        pass"""
if s.count(old3) == 1:
    s = s.replace(old3, """    except KeyboardInterrupt:
        _clear_lock()""")
io.open(p, 'w', encoding='utf-8').write(s)
print('patched', p)
