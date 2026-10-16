# -*- coding: utf-8 -*-
import io
p = 'tools/make_replay_probe.js'
s = io.open(p, encoding='utf-8').read()
old = """    samples.push({ t: Math.round(w.t * 100) / 100, c: snapshot() });"""
new = """    var smp = { t: Math.round(w.t * 100) / 100, c: snapshot() };
    try {
      var hc = APLApp.craft;
      smp.ta = w.targetAlt;
      smp.res = Math.round(APL.Physics.vgoResidual(w, hc) * 10) / 10;
      smp.alt = Math.round((Math.hypot(hc.r[0], hc.r[1], hc.r[2]) - APL.BODY.EARTH.radius) * 1000) / 1000;
    } catch (e) { smp.err = String(e && e.message); }
    samples.push(smp);"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
