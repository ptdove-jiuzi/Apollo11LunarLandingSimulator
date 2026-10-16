# -*- coding: utf-8 -*-
# 按 AGENT_HANDOFF/12-M5-TLI阻塞的正确改法.md 实施：
#   · 删除 v∞ 硬窗口 [0.83,0.90] 与 targetVInf=0.87
#   · 验收改成"由实际 v∞ 算出的 LOI-1 ∈ 889±50 m/s"（几何验收：近月点 111±20、面 ≤0.1°）
#   · TOF 搜索以 75.9 h 为中心，覆盖 72~84 h
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# ---------------- 03-physics.js ----------------
patch('apollo11/webdata/js/03-physics.js', [
 # 1) 新增 LOI-1 能量验收的公共函数与常量
 ("  World.prototype.lunarAimPoint = function (c, tof, periAltKm, opts) {",
  """  // ---- LOI-1 的能量验收（AGENT_HANDOFF/12）----
  // 到达 v∞ 不再是淘汰条件；真正验收的是**由它算出的 LOI-1**：
  //   双曲线近月点速度  v_hyp = √(v∞² + 2μ_m/r_p)，r_p = R_m + 近月点高度
  //   目标椭圆(111×315 km)在近月点的速度 v_ell = √(μ_m(2/r_p − 1/a_t))
  //   LOI-1 = v_hyp − v_ell，验收 889 ± 50 m/s（真实任务 889 m/s）
  // 依据：v∞=1.087 km/s ↔ LOI-1 = 876 m/s（差 1.4%）；
  //   旧的 [0.83,0.90] 窗口对应 LOI-1≈787 m/s，与真实任务不符，
  //   会把真实的 75.9 h 转移（v∞=1.087）整个排除掉。
  function loi1DeltaV(vInf, periAltKm) {
    var rP = B.MOON.radius + periAltKm;
    var vHyp = Math.sqrt(vInf * vInf + 2 * B.MOON.mu / rP);
    var aT = B.MOON.radius + (111 + 315) / 2;
    var vEll = Math.sqrt(B.MOON.mu * (2 / rP - 1 / aT));
    return vHyp - vEll;                       // km/s
  }
  var LOI1_TGT = 0.889, LOI1_TOL = 0.050;     // 889 ± 50 m/s

  World.prototype.lunarAimPoint = function (c, tof, periAltKm, opts) {"""),
 # 2) 导出
 ("    vgoGuidance: vgoGuidance, vgoResidual: vgoResidual,",
  "    vgoGuidance: vgoGuidance, vgoResidual: vgoResidual,\n    loi1DeltaV: loi1DeltaV, loi1Window: { tgt: LOI1_TGT, tol: LOI1_TOL },"),
 # 3) 目标 v∞ 0.87 → 1.09（真实任务的到达能量）
 ("    var tgtVInf = (opts.targetVInf === undefined) ? 0.87 : opts.targetVInf;",
  "    var tgtVInf = (opts.targetVInf === undefined) ? 1.09 : opts.targetVInf;   // HANDOFF/12：真实到达 v∞≈1.09"),
 ("    if (!isFinite(tgtVInf) || tgtVInf < 0.83 || tgtVInf > 0.90) return { failed: 'target-vinf' };",
  "    if (!isFinite(tgtVInf) || tgtVInf < 0.5 || tgtVInf > 1.6) return { failed: 'target-vinf' };   // 只做数值合理性检查"),
 # 4) 收敛判据里的窗口换成 LOI-1
 ("    var vLo = 0.83, vHi = 0.90;                   // 到达 v∞ 硬窗口（AGENT_HANDOFF/08 §1）",
  "    // 验收窗口改由 LOI-1 给出（HANDOFF/12）：\n    var loiLo = LOI1_TGT - LOI1_TOL, loiHi = LOI1_TGT + LOI1_TOL;"),
 ("    var met = function (E) {\n      return !!E && E.aerr.passed && !E.aerr.exhausted && Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.05 &&\n             E.aerr.vInf >= vLo && E.aerr.vInf <= vHi;\n    };",
  "    var met = function (E) {\n      if (!E || !E.aerr.passed || E.aerr.exhausted) return false;\n      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.05)) return false;\n      var l1 = loi1DeltaV(E.aerr.vInf, E.aerr.peri);\n      return (l1 >= loiLo && l1 <= loiHi);\n    };"),
 ("    // 明确失败：修正量 > 20 m/s、近月点误差 > 20 km、到达面 > 0.1°、或 v∞ 落在 0.83~0.90 之外\n    //   ⚠ 绝不\"偷偷提高 v∞ 到 1.1\"糊过去：窗口达不到 0.87 一律如实 failed。\n    var vinfBad = (vInf < vLo || vInf > vHi);",
  "    // 明确失败：修正量 > 20 m/s、近月点误差 > 20 km、到达面 > 0.1°、\n    //   或由 v∞ 算出的 LOI-1 落在 889±50 m/s 之外（HANDOFF/12）。\n    var loi1Now = loi1DeltaV(vInf, aerr.peri);\n    var vinfBad = (loi1Now < loiLo || loi1Now > loiHi);"),
 ("      return { failed: 'no-converge', peri: aerr.peri, periAlt: aerr.peri, periErr: periErr,\n               planeDeg: planeDeg, vInf: vInf, corr: corr, patchedErr: patchedErr,",
  "      return { failed: 'no-converge', peri: aerr.peri, periAlt: aerr.peri, periErr: periErr,\n               planeDeg: planeDeg, vInf: vInf, loi1: loi1Now, corr: corr, patchedErr: patchedErr,"),
 # 5) startLunarTransfer：目标 v∞ 回退值与合理性检查
 ("    var tgtVInf = (opts.targetVInf === undefined) ? (aim.vInf || 0.87) : opts.targetVInf;\n    var vLo = 0.83, vHi = 0.90;\n    if (!(tgtVInf >= vLo && tgtVInf <= vHi)) return { failed: 'target-vinf', targetVInf: tgtVInf };",
  "    var tgtVInf = (opts.targetVInf === undefined) ? (aim.vInf || 1.09) : opts.targetVInf;\n    if (!(tgtVInf > 0.5 && tgtVInf < 1.6)) return { failed: 'target-vinf', targetVInf: tgtVInf };   // 只做数值合理性检查（HANDOFF/12）"),
])

# ---------------- 11-demo.js ----------------
patch('apollo11/webdata/js/11-demo.js', [
 # 1) TOF 列表以 75.9 h 为中心
 ("    var tofs = [88 * 3600, 92 * 3600, 96 * 3600, 98 * 3600, 100 * 3600];",
  "    // HANDOFF/12：真实的 75.9 h 转移才是物理正确的窗口，搜索范围以它为中心（72~84 h）。\n    //   旧的 88~104 h 会把真实窗口整个排除，只留下 v∞ 被压低的次优窗口。\n    var tofs = [72 * 3600, 74 * 3600, 75.9 * 3600, 78 * 3600, 80 * 3600, 82 * 3600, 84 * 3600];"),
 # 2) 目标与验收窗口
 ("    // v∞ 目标/窗口：0.87 / [0.83,0.90]。第 18 轮试过放宽到 0.84/[0.78,0.92]，\n    // 实测反而把\"选中窗口\"挪到更差的邻域（3293 vs 3288）并改变 M2 的 aim 目标，已回退。\n    var tgtVInf = 0.87, vLo = 0.83, vHi = 0.90;",
  """    // HANDOFF/12：v∞ 只是计算结果，验收看**由它算出的 LOI-1**（889±50 m/s）。
    //   真实到达 v∞≈1.09（v∞=1.087 ↔ LOI-1 876 m/s，与真实 889 差 1.4%）。
    var tgtVInf = 1.09;
    var LOI_T = P.loi1Window.tgt, LOI_TOL = P.loi1Window.tol;
    function loiOk(o) {
      if (!o || !isFinite(o.vInf)) return false;
      var l1 = P.loi1DeltaV(o.vInf, (o.periAlt !== undefined ? o.periAlt : o.peri));
      return isFinite(l1) && l1 >= LOI_T - LOI_TOL && l1 <= LOI_T + LOI_TOL;
    }"""),
 ("            && aim.vInf >= vLo && aim.vInf <= vHi;",
  "            && loiOk(aim);"),
 ("        if (!(fcorr <= 0.020 + 1e-9 && faim.planeDeg <= 0.1 + 1e-9\n              && faim.vInf >= vLo && faim.vInf <= vHi)) {",
  "        if (!(fcorr <= 0.020 + 1e-9 && faim.planeDeg <= 0.1 + 1e-9\n              && loiOk(faim))) {"),
 ("      var FINE_TOFS = [92 * 3600, 96 * 3600, 100 * 3600, 104 * 3600];",
  "      var FINE_TOFS = [74 * 3600, 76 * 3600, 78 * 3600, 80 * 3600, 82 * 3600, 84 * 3600];   // HANDOFF/12：围绕 75.9 h"),
 ("      var vOk = (aimC.vInf >= 0.83 - 1e-9 && aimC.vInf <= 0.90 + 1e-9\n                 && aimC.planeDeg <= 0.1 + 1e-9);",
  "      var vOk = (loiOk(aimC) && aimC.planeDeg <= 0.1 + 1e-9);"),
 ("            if (DEMO.arrivalVInf !== null\n                && (DEMO.arrivalVInf < 0.83 || DEMO.arrivalVInf > 0.90)) {\n              generationFail('到达 v∞ ' + DEMO.arrivalVInf.toFixed(3) + ' 超出 0.83~0.90');",
  "            if (DEMO.arrivalVInf !== null\n                && !loiOk({ vInf: DEMO.arrivalVInf, periAlt: peri })) {\n              generationFail('到达能量验收不过：v∞ ' + DEMO.arrivalVInf.toFixed(3)\n                + ' → LOI-1 ' + (P.loi1DeltaV(DEMO.arrivalVInf, peri) * 1000).toFixed(0)\n                + ' m/s（验收 ' + (LOI_T * 1000).toFixed(0) + '±' + (LOI_TOL * 1000).toFixed(0) + '）');"),
 ("        generationFail('TLI：88~100 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / v∞ 0.83~0.90）');",
  "        generationFail('TLI：72~84 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / LOI-1 889±50 m/s）');"),
])
