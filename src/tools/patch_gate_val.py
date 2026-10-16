# -*- coding: utf-8 -*-
import io, sys
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = "  var INS_GATE = 4.9;"
new = "  var INS_GATE = " + sys.argv[1] + ";"
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('INS_GATE =', sys.argv[1])
