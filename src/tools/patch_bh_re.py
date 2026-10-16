# -*- coding: utf-8 -*-
import io
B = chr(92)
p = 'tools/bughunt.js'
s = io.open(p, encoding='utf-8').read()
# 文件里是 \\.id\\s*...（双反斜杠 = 永远匹配不上），改成单反斜杠
old = "/" + B + B + ".id" + B + B + "s*=" + B + B + "s*'([A-Za-z0-9_" + B + B + "-]+)'/g"
new = "/" + B + ".id" + B + "s*=" + B + "s*'([A-Za-z0-9_" + B + "-]+)'/g"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
