# -*- coding: utf-8 -*-
import io
p = 'tools/make_replayaudit_probe.js'
s = io.open(p, encoding='utf-8').read()
old = "split('" + chr(92) + "n')"                      # 文件里是 \n（反斜杠+n，2 字符）
new = "split('" + chr(92) + chr(92) + "n')"            # 改成 \\n → 模板产出 '\n'
assert s.count(old) >= 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok, replaced', s.count(new))
