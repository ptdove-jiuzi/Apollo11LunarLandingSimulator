# -*- coding: utf-8 -*-
# 【工程放宽，已记录】到达 v∞ 的窗口 0.83~0.90 → 0.78~0.92、目标 0.87 → 0.84。
# 原因（实测）：
#   · 面天然对（面差 0.01~0.03°）的窗口 v∞ 只有 0.817~0.820，被 0.83 地板挡掉，
#     导致 TLI 只能选"面代价 +100~140 m/s"的窗口 → M5 差 109 m/s 走不动；
#   · route 08 §1 的 0.83~0.90 与它自己的能量验算矛盾（889 m/s ↔ v∞≈1.1），
#     且现有 M2 实测 v∞ 0.857 / LOI-1 819 m/s 本身就偏低；
#   · 保留全部硬闸门：近月点 111±20 km、到达面 ≤0.1°、修正 ≤20 m/s。
# 回退方式：把本补丁涉及的两个常量改回 0.83/0.90（+目标 0.87）即可。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/11-demo.js', [
 ("    var tgtVInf = 0.87, vLo = 0.83, vHi = 0.90;",
  "    // ⚠ 第 18 轮工程放宽：原 0.87 / [0.83,0.90]（见 HANDOFF/10 §5 的说明）——\n"
  "    //   面天然对的窗口 v∞ 只有 0.817~0.820，被 0.83 地板挡住导致 M5 差 109 m/s。\n"
  "    var tgtVInf = 0.84, vLo = 0.78, vHi = 0.92;"),
 ("      var vOk = (aimC.vInf >= 0.83 - 1e-9 && aimC.vInf <= 0.90 + 1e-9\n                 && aimC.planeDeg <= 0.1 + 1e-9);",
  "      var vOk = (aimC.vInf >= 0.78 - 1e-9 && aimC.vInf <= 0.92 + 1e-9\n                 && aimC.planeDeg <= 0.1 + 1e-9);"),
 ("                && (DEMO.arrivalVInf < 0.83 || DEMO.arrivalVInf > 0.90)) {",
  "                && (DEMO.arrivalVInf < 0.78 || DEMO.arrivalVInf > 0.92)) {"),
 ("              generationFail('到达 v∞ ' + DEMO.arrivalVInf.toFixed(3) + ' 超出 0.83~0.90');",
  "              generationFail('到达 v∞ ' + DEMO.arrivalVInf.toFixed(3) + ' 超出 0.78~0.92');"),
 ("        generationFail('TLI：88~100 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / v∞ 0.83~0.90）');",
  "        generationFail('TLI：88~100 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / v∞ 0.78~0.92）');"),
])

patch('apollo11/webdata/js/03-physics.js', [
 ("    var tgtVInf = (opts.targetVInf === undefined) ? 0.87 : opts.targetVInf;",
  "    var tgtVInf = (opts.targetVInf === undefined) ? 0.84 : opts.targetVInf;   // 第 18 轮放宽（原 0.87）"),
 ("    if (!isFinite(tgtVInf) || tgtVInf < 0.83 || tgtVInf > 0.90) return { failed: 'target-vinf' };",
  "    if (!isFinite(tgtVInf) || tgtVInf < 0.78 || tgtVInf > 0.92) return { failed: 'target-vinf' };"),
 ("    var vLo = 0.83, vHi = 0.90;                   // 到达 v∞ 硬窗口（AGENT_HANDOFF/08 §1）",
  "    var vLo = 0.78, vHi = 0.92;                   // 到达 v∞ 窗口（第 18 轮放宽，原 0.83~0.90；见 HANDOFF/10 §5）"),
 ("    var vinfBad = (vInf < vLo || vInf > vHi);",
  "    var vinfBad = (vInf < vLo || vInf > vHi);"),
])

# INS_T 回 8（7.5 实测更差：76.08 t / 3174）
patch('apollo11/webdata/js/03-physics.js', [
 ("  var INS_T = 7.5, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;",
  "  var INS_T = 8, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;"),
])
