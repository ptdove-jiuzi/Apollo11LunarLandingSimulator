# -*- coding: utf-8 -*-
# 按 HANDOFF/13 §4：
#   1) 修掉 startLunarTransfer 里悬空的 vLo/vHi（上一轮补丁的回归！）
#   2) TLI 到达面闸门 0.1° → 1.2°（真实任务容忍 ~1°，在 LOI 段用 ~13 m/s 收拾）
#   3) 内层收敛早停阈值 0.05° → 0.6°
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/03-physics.js', [
 # (1) 悬空引用 → LOI-1 窗口
 ("    var metB = function (E) {\n      return !!E && E.aerr.passed && !E.aerr.exhausted && Math.abs(E.aerr.peri - tgtPeri) < 5 &&\n             E.aerr.planeDeg < 0.05 && E.aerr.vInf >= vLo && E.aerr.vInf <= vHi;\n    };",
  "    // HANDOFF/13：验收看 LOI-1（889±50 m/s）+ 几何；到达面闸门放宽到 0.6°（外层 1.2°）\n    var metB = function (E) {\n      if (!E || !E.aerr.passed || E.aerr.exhausted) return false;\n      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.6)) return false;\n      var l1 = loi1DeltaV(E.aerr.vInf, E.aerr.peri);\n      return (l1 >= LOI1_TGT - LOI1_TOL && l1 <= LOI1_TGT + LOI1_TOL);\n    };"),
 ("    var vinfBad = (vInf < vLo || vInf > vHi);",
  "    var loi1End = loi1DeltaV(vInf, aerr.peri);\n    var vinfBad = (loi1End < LOI1_TGT - LOI1_TOL || loi1End > LOI1_TGT + LOI1_TOL);"),
 # (2)+(3) 面闸门
 ("      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.05)) return false;",
  "      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.6)) return false;   // HANDOFF/13：0.05→0.6"),
 ("    var planeBad = (planeDeg > 0.1);\n    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corr > corrCap + 1e-9 || vinfBad || planeBad) {",
  "    var planeBad = (planeDeg > 1.2);   // HANDOFF/13：真实任务容忍 ~1° 到达面误差，平面在 LOI 段收拾\n    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corr > corrCap + 1e-9 || vinfBad || planeBad) {"),
 ("    var planeBad = (planeDeg > 0.1);\n    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corrEq > corrCap + 1e-9 || vinfBad || planeBad) {",
  "    var planeBad = (planeDeg > 1.2);   // HANDOFF/13\n    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corrEq > corrCap + 1e-9 || vinfBad || planeBad) {"),
])

patch('apollo11/webdata/js/11-demo.js', [
 ("      var ok = corr <= 0.020 + 1e-9 && aim.planeDeg <= 0.1 + 1e-9\n            && loiOk(aim);",
  "      var ok = corr <= 0.020 + 1e-9 && aim.planeDeg <= 1.2 + 1e-9   // HANDOFF/13：面闸门 0.1→1.2°\n            && loiOk(aim);"),
 ("        if (!(fcorr <= 0.020 + 1e-9 && faim.planeDeg <= 0.1 + 1e-9\n              && loiOk(faim))) {",
  "        if (!(fcorr <= 0.020 + 1e-9 && faim.planeDeg <= 1.2 + 1e-9\n              && loiOk(faim))) {"),
 ("            if (DEMO.arrivalPlane !== null && DEMO.arrivalPlane > 0.1) {\n              generationFail('到达轨道面差 ' + DEMO.arrivalPlane.toFixed(2) + '° > 0.1°');",
  "            if (DEMO.arrivalPlane !== null && DEMO.arrivalPlane > 1.2) {   // HANDOFF/13：0.1→1.2°\n              generationFail('到达轨道面差 ' + DEMO.arrivalPlane.toFixed(2) + '° > 1.2°');"),
 ("      var vOk = (loiOk(aimC) && aimC.planeDeg <= 0.1 + 1e-9);",
  "      var vOk = (loiOk(aimC) && aimC.planeDeg <= 1.2 + 1e-9);"),
])
