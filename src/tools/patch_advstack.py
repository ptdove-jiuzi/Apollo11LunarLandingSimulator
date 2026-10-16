# -*- coding: utf-8 -*-
import io
p = 'tools/make_replayaudit_probe.js'
s = io.open(p, encoding='utf-8').read()
old = """    P.World.prototype.advance = function (dt) { advCalls++; advSim += dt; return origAdvance.call(this, dt); };"""
new = """    var stackLogged = 0;
    P.World.prototype.advance = function (dt) {
      advCalls++; advSim += dt;
      if (stackLogged < 2 && started) {
        stackLogged++;
        rep('ADV-STACK' + stackLogged, ((new Error()).stack || '').split('\\n').slice(1, 6).join(' <- '));
      }
      return origAdvance.call(this, dt);
    };"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
