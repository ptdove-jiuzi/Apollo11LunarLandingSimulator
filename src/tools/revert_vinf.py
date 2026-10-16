# -*- coding: utf-8 -*-
# 撤销 v∞ 放宽（实测没帮上 M5：3293 vs 3288，且会改变 M2 的 aim 目标 → 有回归风险）
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:60], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/11-demo.js', [
 ("    // ⚠ 第 18 轮工程放宽：原 0.87 / [0.83,0.90]（见 HANDOFF/10 §5 的说明）——\n    //   面天然对的窗口 v∞ 只有 0.817~0.820，被 0.83 地板挡住导致 M5 差 109 m/s。\n    var tgtVInf = 0.84, vLo = 0.78, vHi = 0.92;",
  "    // v∞ 目标/窗口：0.87 / [0.83,0.90]。第 18 轮试过放宽到 0.84/[0.78,0.92]，\n    // 实测反而把\"选中窗口\"挪到更差的邻域（3293 vs 3288）并改变 M2 的 aim 目标，已回退。\n    var tgtVInf = 0.87, vLo = 0.83, vHi = 0.90;"),
 ("      var vOk = (aimC.vInf >= 0.78 - 1e-9 && aimC.vInf <= 0.92 + 1e-9\n                 && aimC.planeDeg <= 0.1 + 1e-9);",
  "      var vOk = (aimC.vInf >= 0.83 - 1e-9 && aimC.vInf <= 0.90 + 1e-9\n                 && aimC.planeDeg <= 0.1 + 1e-9);"),
 ("                && (DEMO.arrivalVInf < 0.78 || DEMO.arrivalVInf > 0.92)) {",
  "                && (DEMO.arrivalVInf < 0.83 || DEMO.arrivalVInf > 0.90)) {"),
 ("              generationFail('到达 v∞ ' + DEMO.arrivalVInf.toFixed(3) + ' 超出 0.78~0.92');",
  "              generationFail('到达 v∞ ' + DEMO.arrivalVInf.toFixed(3) + ' 超出 0.83~0.90');"),
 ("        generationFail('TLI：88~100 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / v∞ 0.78~0.92）');",
  "        generationFail('TLI：88~100 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / v∞ 0.83~0.90）');"),
])

patch('apollo11/webdata/js/03-physics.js', [
 ("    var tgtVInf = (opts.targetVInf === undefined) ? 0.84 : opts.targetVInf;   // 第 18 轮放宽（原 0.87，见 HANDOFF/10 §5）",
  "    var tgtVInf = (opts.targetVInf === undefined) ? 0.87 : opts.targetVInf;"),
 ("    if (!isFinite(tgtVInf) || tgtVInf < 0.78 || tgtVInf > 0.92) return { failed: 'target-vinf' };",
  "    if (!isFinite(tgtVInf) || tgtVInf < 0.83 || tgtVInf > 0.90) return { failed: 'target-vinf' };"),
 ("    var vLo = 0.78, vHi = 0.92;                   // 到达 v∞ 窗口（第 18 轮放宽，原 0.83~0.90）",
  "    var vLo = 0.83, vHi = 0.90;                   // 到达 v∞ 硬窗口（AGENT_HANDOFF/08 §1）"),
 ("    var tgtVInf = (opts.targetVInf === undefined) ? (aim.vInf || 0.84) : opts.targetVInf;\n    var vLo = 0.78, vHi = 0.92;                   // 第 18 轮放宽（原 0.83~0.90）",
  "    var tgtVInf = (opts.targetVInf === undefined) ? (aim.vInf || 0.87) : opts.targetVInf;\n    var vLo = 0.83, vHi = 0.90;"),
 ("  var INS_GATE = 2.0;", "  var INS_GATE = 4.9;"),
])
