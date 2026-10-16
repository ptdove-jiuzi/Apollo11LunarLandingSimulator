# -*- coding: utf-8 -*-
"""JS <-> Python 桥接层。

网页端通过 window.pywebview.api.<method>(...) 调用这里的方法。
所有返回值必须是可 JSON 序列化的。
"""

import json
import os
import subprocess
import sys
import time

from . import __version__, __app_name__
from .paths import user_data_dir, is_frozen, web_dir

try:
    import webview  # noqa: F401
    _HAS_WEBVIEW = True
except Exception:  # pragma: no cover - 降级到浏览器模式
    _HAS_WEBVIEW = False


class Bridge:
    """暴露给前端的 API。"""

    def __init__(self):
        self.base = user_data_dir()
        self.scen_dir = os.path.join(self.base, "scenarios")
        self.export_dir = os.path.join(self.base, "exports")
        self.save_dir = os.path.join(self.base, "saves")
        for d in (self.scen_dir, self.export_dir, self.save_dir):
            try:
                os.makedirs(d, exist_ok=True)
            except Exception:
                pass
        self._window = None

    # ---------------------------------------------------------------- 基础
    def app_info(self):
        return {
            "name": __app_name__,
            "version": __version__,
            "frozen": is_frozen(),
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "dataDir": self.base,
            "scenarioDir": self.scen_dir,
            "exportDir": self.export_dir,
            "saveDir": self.save_dir,
            "serverTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

    def ping(self):
        return "pong"

    def ui_log(self, kind, text):
        """前端上报：就绪 / 错误 / 诊断，写入 %USERPROFILE%/Apollo11Simulator/ui.log。"""
        try:
            import time as _t
            p = os.path.join(self.base, "ui.log")
            with open(p, "a", encoding="utf-8") as f:
                f.write("%s  [%s] %s\n" % (_t.strftime("%H:%M:%S"), kind, text))
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ---------------------------------------------------------------- 存档
    def list_saves(self):
        out = []
        try:
            for name in sorted(os.listdir(self.save_dir)):
                if name.lower().endswith(".json"):
                    p = os.path.join(self.save_dir, name)
                    out.append({
                        "name": name[:-5],
                        "file": name,
                        "size": os.path.getsize(p),
                        "mtime": time.strftime("%Y-%m-%d %H:%M:%S",
                                               time.localtime(os.path.getmtime(p))),
                    })
        except Exception:
            pass
        return out

    def save_game(self, payload, name="quicksave"):
        safe = _safe_name(name) or "quicksave"
        path = os.path.join(self.save_dir, safe + ".json")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(payload if isinstance(payload, str) else json.dumps(payload))
            return {"ok": True, "path": path, "name": safe}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def load_game(self, name):
        safe = _safe_name(name) or ""
        path = os.path.join(self.save_dir, safe + ".json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                return {"ok": True, "data": json.load(f), "path": path}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def delete_game(self, name):
        safe = _safe_name(name) or ""
        path = os.path.join(self.save_dir, safe + ".json")
        try:
            if os.path.exists(path):
                os.remove(path)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ------------------------------------------------------------ 导出文件
    def export_file(self, filename, content, subdir="exports"):
        """把文本内容写入用户数据目录，返回完整路径。"""
        safe = _safe_name(filename) or ("export_%d.txt" % int(time.time()))
        target = os.path.join(self.base, subdir)
        try:
            os.makedirs(target, exist_ok=True)
            path = os.path.join(target, safe)
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            return {"ok": True, "path": path}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_as_dialog(self, filename, content):
        """弹出「另存为」对话框。无窗口环境时回落到导出目录。"""
        safe = _safe_name(filename) or "export.txt"
        data = content.encode("utf-8") if isinstance(content, str) else content
        if self._window is not None:
            try:
                import webview
                result = self._window.create_file_dialog(
                    webview.SAVE_DIALOG, directory=self.export_dir,
                    save_filename=safe)
                if result:
                    path = result if isinstance(result, str) else result[0]
                    with open(path, "wb") as f:
                        f.write(data)
                    return {"ok": True, "path": path}
                return {"ok": False, "error": "cancelled"}
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
        return self.export_file(safe, content)

    # -------------------------------------------------------- 内置 AGC 程序
    def list_programs(self):
        d = os.path.join(web_dir(), "programs")
        out = []
        try:
            for name in sorted(os.listdir(d)):
                if name.lower().endswith((".agc", ".a11", ".asm")):
                    out.append(name)
        except Exception:
            pass
        return out

    def read_program(self, name):
        safe = os.path.basename(name)
        path = os.path.join(web_dir(), "programs", safe)
        try:
            with open(path, "r", encoding="utf-8") as f:
                return {"ok": True, "text": f.read(), "name": safe}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_folder(self, which="base"):
        target = {"base": self.base, "export": self.export_dir,
                  "save": self.save_dir, "scenario": self.scen_dir}.get(which, self.base)
        try:
            if sys.platform.startswith("win"):
                os.startfile(target)  # noqa: S606
            elif sys.platform == "darwin":
                subprocess.Popen(["open", target])
            else:
                subprocess.Popen(["xdg-open", target])
            return {"ok": True, "path": target}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ---------------------------------------------------------------- 退出
    def quit_app(self):
        try:
            if self._window is not None:
                self._window.destroy()
        except Exception:
            pass
        os._exit(0)


def _safe_name(name):
    if not isinstance(name, str):
        return ""
    keep = []
    for ch in name.strip():
        if ch.isalnum() or ch in "._- ()[]":
            keep.append(ch)
    return "".join(keep)[:120]
