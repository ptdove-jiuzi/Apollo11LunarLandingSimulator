# -*- coding: utf-8 -*-
import io
p = 'tools/save_replay.js'
s = io.open(p, encoding='utf-8').read()
old = """  const ev = traj.events.find(e => /入轨|insertion/i.test(e.zh));
  if (ev) {
    const s = S.find(x => x.t >= ev.t + 60) || lastSample();
    const c = craftAt(s, 0);
    const el = MM.elements(BODY.EARTH.mu, at(c.r), at(c.v));"""
new = """  // 取"入轨关机之后"的第一个样本：油门为 0 且近地点已抬到 150 km 以上
  let pIdx = -1;
  for (let i = 0; i < S.length; i++) {
    const c0 = craftAt(S[i], 0);
    if (c0.th > 0.001) continue;
    const e0 = MM.elements(BODY.EARTH.mu, at(c0.r), at(c0.v));
    if (isFinite(e0.periapsis) && e0.periapsis - BODY.EARTH.radius > 150) { pIdx = i; break; }
  }
  if (pIdx >= 0) {
    const s = S[pIdx];
    const c = craftAt(s, 0);
    const el = MM.elements(BODY.EARTH.mu, at(c.r), at(c.v));"""
assert s.count(old) == 1
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
