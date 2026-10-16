# -*- coding: utf-8 -*-
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
pairs = [
 ("    var tgtVInf = (opts.targetVInf === undefined) ? 0.87 : opts.targetVInf;",
  "    var tgtVInf = (opts.targetVInf === undefined) ? 0.84 : opts.targetVInf;   // 第 18 轮放宽（原 0.87，见 HANDOFF/10 §5）"),
 ("    if (!isFinite(tgtVInf) || tgtVInf < 0.83 || tgtVInf > 0.90) return { failed: 'target-vinf' };",
  "    if (!isFinite(tgtVInf) || tgtVInf < 0.78 || tgtVInf > 0.92) return { failed: 'target-vinf' };"),
 ("    var vLo = 0.83, vHi = 0.90;                   // 到达 v∞ 硬窗口（AGENT_HANDOFF/08 §1）",
  "    var vLo = 0.78, vHi = 0.92;                   // 到达 v∞ 窗口（第 18 轮放宽，原 0.83~0.90）"),
 ("  var INS_T = 7.5, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;",
  "  var INS_T = 8, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;"),
]
for old, new in pairs:
    assert s.count(old) == 1, (old[:70], s.count(old))
    s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('patched 03-physics.js ×', len(pairs))
