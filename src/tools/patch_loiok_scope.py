# -*- coding: utf-8 -*-
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()

# 1) 从 solveTLI 内部移除，只留 tgtVInf
old1 = """    // HANDOFF/12：v∞ 只是计算结果，验收看**由它算出的 LOI-1**（889±50 m/s）。
    //   真实到达 v∞≈1.09（v∞=1.087 ↔ LOI-1 876 m/s，与真实 889 差 1.4%）。
    var tgtVInf = 1.09;
    var LOI_T = P.loi1Window.tgt, LOI_TOL = P.loi1Window.tol;
    function loiOk(o) {
      if (!o || !isFinite(o.vInf)) return false;
      var l1 = P.loi1DeltaV(o.vInf, (o.periAlt !== undefined ? o.periAlt : o.peri));
      return isFinite(l1) && l1 >= LOI_T - LOI_TOL && l1 <= LOI_T + LOI_TOL;
    }"""
new1 = """    // HANDOFF/12：目标到达能量 v∞≈1.09（真实任务值）；验收见模块级 loiOk()。
    var tgtVInf = 1.09;"""
assert s.count(old1) == 1, s.count(old1)
s = s.replace(old1, new1)

# 2) 放到模块作用域（burnTLI 也要用）
old2 = "  var T = function (zh, en) { return { zh: zh, en: en }; };"
new2 = """  var T = function (zh, en) { return { zh: zh, en: en }; };
  // ---- 到达能量验收（AGENT_HANDOFF/12）----
  // v∞ 不再是淘汰条件；验收看**由它算出的 LOI-1**（真实任务 889 m/s）。
  var LOI_T = (P.loi1Window && P.loi1Window.tgt) || 0.889;
  var LOI_TOL = (P.loi1Window && P.loi1Window.tol) || 0.050;
  function loiOk(o) {
    if (!o || !isFinite(o.vInf)) return false;
    var l1 = P.loi1DeltaV(o.vInf, (o.periAlt !== undefined ? o.periAlt : o.peri));
    return isFinite(l1) && l1 >= LOI_T - LOI_TOL && l1 <= LOI_T + LOI_TOL;
  }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
