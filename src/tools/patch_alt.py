# -*- coding: utf-8 -*-
# 候选回退：扫描把"同一次滑行窗口"下的多个合格 TOF 存进 DEMO.tliAlts；
# burnTLI 在**真实状态**上逐个重解 aim + 试有限弧，失败的换下一个。
# 动机（实测）：FINE_TRY=120 时被选中的 70 min 窗口，真实状态重解后
# v∞=0.797（不合格）→ 没有备选 → 整条 M5 中止。
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()

# 1) 细相位段：收集合格候选（不只留最省的一个）
old1 = """        fd.aim = faim; fd.realDv = faim.dv; fd.peri = faim.periAlt;
        fd.plane = faim.planeDeg; fd.vInf = faim.vInf;
        if (!fineBest || fd.realDv < fineBest.realDv) fineBest = fd;"""
new1 = """        fd.aim = faim; fd.realDv = faim.dv; fd.peri = faim.periAlt;
        fd.plane = faim.planeDeg; fd.vInf = faim.vInf;
        if (!fineQualified) fineQualified = [];
        fineQualified.push(fd);
        if (!fineBest || fd.realDv < fineBest.realDv) fineBest = fd;"""
assert s.count(old1) == 1
s = s.replace(old1, new1)

old2 = """      var FINE_TRY = 120, fineBest = null;"""
new2 = """      var FINE_TRY = 120, fineBest = null, fineQualified = null;"""
assert s.count(old2) == 1
s = s.replace(old2, new2)

# 2) 选择后：把"同一滑行时刻"的其它合格 TOF 存成备选
old3 = """      // 细相位找到更省（或第一遍压根没有）的合格窗口就换用它
      if (fineBest && (!pick || fineBest.realDv < pick.realDv)) pick = fineBest;"""
new3 = """      // 细相位找到更省（或第一遍压根没有）的合格窗口就换用它
      if (fineBest && (!pick || fineBest.realDv < pick.realDv)) pick = fineBest;
      // ★ 备选：同一次滑行窗口（wait 相同）下的其它合格 TOF。
      //   必须按"最省优先"排好，交给 burnTLI 在**真实状态**上逐个复验 ——
      //   实测规划态最省的窗口在真实状态可能 v∞/面差都不合格（每 1 秒相位
      //   都在变，滑行几十秒的差异就够），没有备选就整条任务中止。
      if (fineQualified && pick) {
        DEMO.tliAlts = fineQualified
          .filter(function (q) { return Math.abs(q.wait - pick.wait) < 1.0; })
          .sort(function (a, b) { return a.realDv - b.realDv; })
          .slice(0, 6);
      }"""
assert s.count(old3) == 1
s = s.replace(old3, new3)

# 3) burnTLI：逐个候选复验（真实状态重解 aim + 有限弧打靶）
old4 = """    var tof = DEMO.tli.tof - (w.t - DEMO.tli.at);
    var aim = w.lunarAimPoint(c, tof, 111);
    if (!aim || aim.failed) {
      generationFail('TLI：瞄准求解失败（' + (aim && aim.failed ? aim.failed : 'null') + '）');
      return;
    }
    DEMO.aim = aim;"""
new4 = """    // ★ 候选列表：第一次用扫描选中的窗口，之后是同一次滑行的备选 TOF。
    //   每个候选都在**真实状态**上重解 aim（规划态与实飞态差 2.8 km/3.3 m/s，
    //   在这个敏感几何下足以让参考弧跑偏 —— 见 09 §3 层2），再试有限弧打靶。
    var candTofs = [DEMO.tli.tof];
    if (DEMO.tliAlts && DEMO.tliAlts.length) {
      for (var qa = 0; qa < DEMO.tliAlts.length; qa++) {
        if (Math.abs(DEMO.tliAlts[qa].tof - DEMO.tli.tof) > 1) candTofs.push(DEMO.tliAlts[qa].tof);
      }
    }
    var aim = null, res = null, tof = 0, lastWhy = 'null';
    for (var ci = 0; ci < candTofs.length; ci++) {
      tof = candTofs[ci] - (w.t - DEMO.tli.at);
      if (!(tof > 3600)) continue;
      var aimC = w.lunarAimPoint(c, tof, 111);
      if (!aimC || aimC.failed) {
        lastWhy = '瞄准失败(' + (aimC && aimC.failed ? aimC.failed : 'null') + ')';
        if (app().logLine) app().logLine('sys', 'TLI 候选 tof=' + (candTofs[ci] / 3600).toFixed(1)
          + 'h 真实状态复验：' + lastWhy);
        continue;
      }
      var vOk = (aimC.vInf >= 0.83 - 1e-9 && aimC.vInf <= 0.90 + 1e-9
                 && aimC.planeDeg <= 0.1 + 1e-9);
      if (!vOk) {
        lastWhy = '真实状态几何不合格(v∞ ' + aimC.vInf.toFixed(3)
          + ', 面差 ' + aimC.planeDeg.toFixed(3) + '°)';
        if (app().logLine) app().logLine('sys', 'TLI 候选 tof=' + (candTofs[ci] / 3600).toFixed(1)
          + 'h ' + lastWhy + ' → 试下一个');
        continue;
      }
      var resC = w.startLunarTransfer(c, aimC);
      if (resC && resC.failed && resC.failed !== 'propellant') {
        var resC2 = w.startLunarTransfer(c, aimC, {
          aTries: 5, aMaxEvals: 400, aMaxIters: 150, bMaxEvals: 1200, bMaxIters: 400
        });
        if (resC2) resC = resC2;
      }
      if (resC && !resC.failed && !resC.noPropellant) {
        aim = aimC; res = resC;
        if (ci > 0 && app().logLine) {
          app().logLine('sys', 'TLI 采用备选窗口：tof ' + (candTofs[ci] / 3600).toFixed(1)
            + ' h（前 ' + ci + ' 个候选在真实状态复验不过）');
        }
        break;
      }
      lastWhy = (resC && resC.failed) ? resC.failed : 'null';
      res = resC;                           // 保留最后一次失败（含推进剂账）
      if (app().logLine) app().logLine('sys', 'TLI 候选 tof=' + (candTofs[ci] / 3600).toFixed(1)
        + 'h 打靶失败：' + lastWhy + ' → 试下一个');
    }
    if (!aim) {
      generationFail('TLI：全部候选（' + candTofs.length + ' 个）在真实状态上都无法打靶成功'
        + '（最后原因：' + lastWhy + '）');
      return;
    }
    DEMO.aim = aim;"""
assert s.count(old4) == 1
s = s.replace(old4, new4)

# 4) 把原来紧跟其后的 res 计算删掉（现在 res 已在循环里求得）
old5 = """    // ⚠ 必须先按**默认预算**打一次：实测把预算整体放大反而让 A 段在更多种子里
    //   选到更差的分支（M2 从通过退回近月点差 1896 km）。默认预算失败时
    //   （M5 的真实上升段几何更难：实测 A 段 156 evals 打满、残差 47.8 km）
    //   再用放大预算重试一次 —— M2 走默认一次通过，行为与基线完全一致。
    var res = w.startLunarTransfer(c, aim);
    if (res && res.failed && res.failed !== 'propellant') {
      var res2 = w.startLunarTransfer(c, aim, {
        aTries: 5, aMaxEvals: 400, aMaxIters: 150, bMaxEvals: 1200, bMaxIters: 400
      });
      if (res2) res = res2;
    }
"""
assert s.count(old5) == 1
s = s.replace(old5, "")
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
