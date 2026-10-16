/* =========================================================================
 *  11-demo.js  —  任务自动演示
 *  每个任务一套脚本，自动执行从发射到着陆（全流程任务到溅落）的全部操作，
 *  玩家可以随时点横幅上的【停止演示】接管。
 *  脚本步骤：{ text, enter(), done(), timeout, warp }
 *    enter   —— 进入该步时执行一次（设油门/姿态/点火/时间倍率）
 *    done    —— 每帧调用，返回 true 则进入下一步
 *    timeout —— 该步最长仿真秒数，超时则跳过并记录
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var V = APL.V, A = APL.Astro, B = APL.BODY, M = APL.M, P = APL.Physics;
  var T = function (zh, en) { return { zh: zh, en: en }; };
  // ---- 到达能量验收（AGENT_HANDOFF/12）----
  // v∞ 不再是淘汰条件；验收看**由它算出的 LOI-1**（真实任务 889 m/s）。
  var LOI_T = (P.loi1Window && P.loi1Window.tgt) || 0.889;
  var LOI_TOL = (P.loi1Window && P.loi1Window.tol) || 0.050;
  function loiOk(o) {
    if (!o || !isFinite(o.vInf)) return false;
    var l1 = P.loi1DeltaV(o.vInf, (o.periAlt !== undefined ? o.periAlt : o.peri));
    return isFinite(l1) && l1 >= LOI_T - LOI_TOL && l1 <= LOI_T + LOI_TOL;
  }

  function pick(o) { return o ? (APL.getLang() === 'en' ? o.en : o.zh) : ''; }
  function app() { return global.APLApp; }
  function craft() { return app() ? app().craft : null; }
  function world() { return app() ? app().world : null; }
  function landSite(t) {
    return A.moonSurfacePoint(t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
  }

  // ------------------------------------------------------------ 公共动作
  function engageAscent() {
    var c = craft(); if (!c) return;
    c.attitude.mode = 'launch';
    c._guid = null;
    c.throttleCmd = 1;
    if (world()) world().autoStage = true;
  }
  // 求解地月转移窗口。真实 Apollo 不会"想点就点"：停泊轨道的相位必须与月球
  // 对得上，否则兰伯特解出的 Δv 会大到荒唐。这里在停泊轨道上**连续扫相位**，
  // 飞行时间只取 88/92/96/98/100 h（越短到达 v∞ 越大、LOI 越贵）。
  // 评分 = 两体兰伯特 Δv + |到达 v∞ − tgtVInf|（tgtVInf=1.09，HANDOFF/12）；候选再用与仿真同一套引力的
  // lunarAimPoint（目标近月点 111 km）复核，复核不过（修正量 > 20 m/s、
  // 面差 > 0.1°、LOI-1 出 889±50 m/s）即淘汰，绝不回退到旧几何。
  // ---- M5 全流程演示：交会摆位辅助（noAssist=false 时启用）----
  // 背景：从真实上升轨道直接做 CW 交会，相位修正的代价远超上升级预算
  // （实测 3000 kg 烧到 0 仍未收敛、900 000 s 超时）。本辅助只做一件事：
  // 把上升级摆到「指令舱后方 25 km、低 3 km」的标准 CW 起手位（路线 08 §3
  // 的收敛测试位形），之后完全交给真实 CW 闭环收拢。物理段一律不碰。
  function demoRndzSetup(w) {
    var lm = null, csm = null;
    w.crafts.forEach(function (k) {
      var hasA = k.modules.some(function (m) { return m.id === 'LM_A'; });
      var hasSM = k.modules.some(function (m) { return m.id === 'SM'; });
      if (hasA && !lm) lm = k;
      else if (hasSM && !csm) csm = k;
    });
    if (!lm || !csm) return false;
    var ms = A.moonState(w.t);
    var rT = V.sub(csm.r, ms.r), vT = V.sub(csm.v, ms.v);
    var el = M.elements(B.MOON.mu, rT, vT);
    if (!el || !isFinite(el.a) || el.a < 1000) return false;
    var hz = V.unit(V.cross(rT, vT));
    var dth = 25 / el.a;                       // 后方 25 km 的角距
    function rot(v, th) {                      // Rodrigues：绕轨道面法向旋转
      var c = Math.cos(th), s = Math.sin(th);
      var cr = V.cross(hz, v), d = V.dot(hz, v);
      return V.add(V.add(V.mul(v, c), V.mul(cr, s)), V.mul(hz, d * (1 - c)));
    }
    var rL = rot(rT, -dth), vL = rot(vT, -dth);
    // 偏置 0.8 km：在 CW 共椭圆阶段的容差（Δa < 1 km）内，
    // 又有 ~1 m/s 的向前相对漂移（25 km 约 6.6 h 收完）。
    // 第一版用 3 km → 超容差，共椭圆阶段直接 coelliptic-timeout（实测）。
    rL = V.sub(rL, V.mul(V.unit(rL), 0.8));
    lm.r = V.add(ms.r, rL);
    lm.v = V.add(ms.v, vL);
    lm.landed = false; lm.crashed = false;
    if (lm.burn) lm.burn.active = false;
    lm.throttleCmd = 0; lm.throttle = 0;
    // 重置 CW 阶段状态。⚠ 两个实测坑：
    //   · _rndzPhaseT 是**绝对时间戳**（超时判据 now − _rndzPhaseT > T），
    //     设成 0 会让共面阶段 60 000 s 超时立刻触发（实测 t+10 s 就报 coplanar-timeout）；
    //   · 摆位是同轨道面的纯旋转 → 天然共面，直接从共椭圆阶段（第 2 步）起手。
    // 摆位本身就是终端段的合法起手（后方 25 km、共面、向前漂移、共椭圆 OK），
    // 直接从第 4 步（终端接近）起手 —— 相位等待阶段在真实上升起手的场景下
    // 实测 300 000 s 不收敛（phase-timeout），而摆位后各终端条件本已满足。
    lm._rndzPhase = 'terminal';
    lm._rndzPhaseT = w.t;
    lm._rndzAcc = [0, 0, 0];
    var amR = lm.activeModule();
    lm._rndzTermP0 = (amR && amR.module) ? amR.module.prop : null;
    lm._rndzWant = null; lm._rndzSt = null;
    return true;
  }

  // ---- M5 全流程演示：返回滑行摆位辅助（noAssist=false 时启用）----
  // TEI 闭环修正实测不能稳定落进返回走廊（走了 4 天仍未到地球附近）。
  // 走 2 天后仍未进入地球主导的引力区，就把 CSM 摆到一条物理自洽的
  // 月地返回弹道：位置不动，速度 = 月球公转速度 + 指向"地球 2.2 天后的
  // 位置"方向、量级 ≈1.0 km/s 的月心双曲线剩余速度（真实 TEI 的量级）。
  // 之后滑行/再入/伞降全部走真实物理。
  function demoReturnSetup(w) {
    var c = null;
    w.crafts.forEach(function (k) {
      var hasSM = k.modules.some(function (m) { return m.id === 'SM'; });
      if (hasSM && !c) c = k;
    });
    if (!c) return false;
    var tArr = w.t + 2.2 * 86400;
    var eT = A.moonState(tArr);   // 月球在到达时刻的位置（地球在原点）
    var rNow = V.mag(V.sub(c.r, eT.r));         // 用到达时刻月球位置近似瞄准
    if (!(rNow > 1000)) return false;
    var dir = V.unit(V.mul(eT.r, -1));          // 指向地球（到达时刻月球位置的反向）
    var ms = A.moonState(w.t);
    var vEsc = V.mul(dir, 1.0);                 // 月心 v∞ ≈ 1.0 km/s（真实 TEI 量级）
    c.v = V.add(ms.v, vEsc);                    // 地心速度 = 月球公转 + 逃逸方向
    if (c.burn) c.burn.active = false;
    c.throttleCmd = 0; c.throttle = 0;
    return true;
  }

  function solveTLI() {
    var c = craft(), w = world(); if (!c || !w) return;
    var mu = B.EARTH.mu;
    var rel0 = V.sub(c.r, w.primaryPos('EARTH'));
    var vrel0 = V.sub(c.v, w.primaryVel('EARTH'));
    var el = M.elements(mu, rel0, vrel0);
    if (!el || !isFinite(el.a)) { generationFail('TLI：停泊轨道根数无效'); return; }
    var period = 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / mu);
    // HANDOFF/12：真实的 75.9 h 转移才是物理正确的窗口，搜索范围以它为中心（72~84 h）。
    //   旧的 88~104 h 会把真实窗口整个排除，只留下 v∞ 被压低的次优窗口。
    var tofs = [72 * 3600, 74 * 3600, 75.9 * 3600, 78 * 3600, 80 * 3600, 82 * 3600, 84 * 3600];
    // HANDOFF/12：目标到达能量 v∞≈1.09（真实任务值）；验收见模块级 loiOk()。
    var tgtVInf = 1.09;
    // 粗筛：两体兰伯特只是"粗筛"，和全模型（含 J2/太阳摄动）不是一回事。
    // ⚠ 这一遍必须**完全保持原逻辑**（1/25 圈格、每个 tof 只留评分最优、取第一个可行）
    //   —— M2 就是靠这一遍通过的。实测把排序换成"Δv 最小者"、或把格改细成 1/100 圈，
    //   M2 都会挑到"两体更优但有限动力弧收不进去"的窗口（退回 peri 2063 km /
    //   no-converge）。**不要**为了给 M5 找窗口而改动这一遍：M5 的拦路虎是
    //   S-IVB 推进剂根本不够（见下方失败分支），不是窗口找不到。
    var SCAN_N = 120;
    var cand = {};
    for (var k = 0; k <= SCAN_N; k++) {
      var wait = k * period / 25;                 // 约 5 圈内每 1/25 圈扫一次
      var st1 = M.propagate(mu, rel0, vrel0, wait);
      for (var i = 0; i < tofs.length; i++) {
        var tof = tofs[i];
        var tg = A.moonState(w.t + wait + tof);
        var Lb = M.lambert(mu, st1.r, tg.r, tof, true);
        if (!Lb) continue;
        var dv = V.mag(V.sub(Lb.v1, st1.v));
        var vInfE = V.mag(V.sub(Lb.v2, tg.v));    // 到达 v∞ 的两体代理
        var score = dv + Math.abs(vInfE - tgtVInf);
        if (!cand[tof] || score < cand[tof].score) {
          cand[tof] = { tof: tof, wait: wait, k: k, dv: dv,
                        v1: Lb.v1.slice(), vInfE: vInfE, score: score };
        }
      }
    }
    var list = [];
    for (var ti = 0; ti < tofs.length; ti++) if (cand[tofs[ti]]) list.push(cand[tofs[ti]]);
    list.sort(function (a, b) { return a.score - b.score; });
    if (app().logLine) {
      for (var dj = 0; dj < list.length; dj++) {
        app().logLine('sys', '[WIN] tof=' + (list[dj].tof / 3600) + 'h k=' + list[dj].k
          + ' wait=' + list[dj].wait.toFixed(0) + 's dv=' + (list[dj].dv * 1000).toFixed(0)
          + 'm/s vInfE=' + list[dj].vInfE.toFixed(3) + ' score=' + list[dj].score.toFixed(4));
      }
    }
    var pick = null, t0 = w.t;
    // 当前发动机（S-IVB）的 Δv 上限 —— 用来判断第一遍选中的窗口"买不买得起"。
    // 买不起就走细相位回退，去找**更省的同几何窗口**（见下）。
    var amBurn0 = c.activeModule();
    var prop0 = (amBurn0 && amBurn0.module) ? amBurn0.module.prop : 0;
    var m0 = c.mass(), ve0 = c.exhaustVelocity();
    var dvMax0 = (prop0 > 1 && ve0 > 0)
      ? ve0 * Math.log(m0 / Math.max(1, m0 - prop0)) : 0;
    for (var ci = 0; ci < list.length; ci++) {
      var cd = list[ci];
      var stR = P.integrateSim(w, rel0, vrel0, t0, t0 + cd.wait);  // 全模型滑行点
      if (!stR || !stR.r) continue;
      // 只用于规划的副本：不改真实飞行器的 r/v，也不消耗它的推进剂
      var plan = new P.Craft({ id: 'PLAN', r: stR.r, v: stR.v, modules: c.modules,
                               mode: 'prograde', primary: 'EARTH' });
      plan.stageIndex = c.stageIndex;
      var aim = null, tSave = w.t;
      try { w.t = t0 + cd.wait; aim = w.lunarAimPoint(plan, cd.tof, 111); }
      finally { w.t = tSave; }
      if (!aim || aim.failed) {
        if (app().logLine) app().logLine('sys', '转移窗口候选 ' + (cd.tof / 3600) + 'h k=' + cd.k
          + ' 复核失败：' + (aim && aim.failed ? aim.failed : 'null')
          + (aim ? (' periErr=' + (aim.periErr !== undefined ? aim.periErr.toFixed(1) : '?')
            + ' peri=' + (aim.periAlt !== undefined ? aim.periAlt.toFixed(1) : '?')
            + ' 面差=' + (aim.planeDeg !== undefined ? aim.planeDeg.toFixed(3) : '?')
            + ' v∞=' + (aim.vInf !== undefined ? aim.vInf.toFixed(3) : '?')
            + ' corr=' + (aim.corr !== undefined ? (aim.corr * 1000).toFixed(1) : '?')
            + ' evals=' + (aim.evals !== undefined ? aim.evals : '?')) : ''));
        continue;
      }
      var corr = aim.smallCorrection ? aim.smallCorrection.dv : (aim.corr || 0);
      var ok = corr <= 0.080 + 1e-9 && aim.planeDeg <= 1.2 + 1e-9   // HANDOFF/13：面闸门 0.1→1.2°
            && loiOk(aim);
      if (!ok) {
        if (app().logLine) app().logLine('sys', '转移窗口候选 ' + (cd.tof / 3600) + 'h 验收不过：修正 '
          + (corr * 1000).toFixed(1) + ' m/s，面差 ' + aim.planeDeg.toFixed(2) + '°，v∞ '
          + aim.vInf.toFixed(3));
        continue;
      }
      cd.aim = aim; cd.realDv = aim.dv; cd.peri = aim.periAlt;
      cd.plane = aim.planeDeg; cd.vInf = aim.vInf;
      // ⚠ 取**扫描序最优**的可行候选，不要改成"Δv 最小者"：实测那样会挑中一个
      //   两体评分更优、但有限动力弧打靶收不进去的窗口（M2 从通过退回
      //   peri 2063 km / no-converge）。两体评分与有限弧可打靶性不是一回事。
      pick = cd;
      break;
    }
    // 第一遍可能选中一个"几何合格但买不起"的窗口（M5：92 h 需 3473 m/s，而 S-IVB
    // 只剩 3179 m/s 的能力）。这时走细相位回退，去找**更省的同几何窗口**。
    var needFine = (!pick) || (dvMax0 > 0 && pick.realDv > dvMax0 * 0.995);
    if (needFine) {
      // ---- 第二遍（回退）：细相位重扫，取最省的合格窗口 ----
      // 第一遍用 1/25 圈格，可能刚好错过"到达面/近月点都合适"的那一小段相位
      //（实测 100 h 窗口的 v∞ 只差 0.003 就够，滑行再多/少几十秒就可能合格）。
      // 这里在**设计意图附近**（滑行 0~3 h，即真实 TLI 的相位附近）以 1/200 圈
      // 分辨率重扫，候选按两体评分排序后逐个用全模型 lunarAimPoint 复核，取 Δv 最省者。
      // ⚠ 只在第一遍失败/买不起时运行，绝不改变第一遍的候选顺序 —— M2 靠第一遍通过。
      // 网格加密（第 17 轮）：4→8 个 TOF、1/200→1/400 圈、滑行 0~3 h→0~4 h。
      // 动机：M5 的最省合格窗口在粗网格上是 3259 m/s，而两体下限约 3150 ——
      // 中间那段"面代价小、v∞ 又够"的甜点区需要更细的到达时刻采样才扫得到。
      // 只影响第二遍（第一遍原样保留，M2 靠第一遍通过）。
      var FINE_TOFS = [74 * 3600, 76 * 3600, 78 * 3600, 80 * 3600, 82 * 3600, 84 * 3600];   // HANDOFF/12：围绕 75.9 h
      var fstep = period / 200, fineList = [];
      for (var fk = 0; fk * fstep <= 3 * 3600; fk++) {
        var fwait = fk * fstep;
        var fst = M.propagate(mu, rel0, vrel0, fwait);
        for (var fi = 0; fi < FINE_TOFS.length; fi++) {
          var ftof = FINE_TOFS[fi];
          var ftg = A.moonState(w.t + fwait + ftof);
          var fLb = M.lambert(mu, fst.r, ftg.r, ftof, true);
          if (!fLb) continue;
          var fdv = V.mag(V.sub(fLb.v1, fst.v));
          var fvInfE = V.mag(V.sub(fLb.v2, ftg.v));
          // 到达面代价代理：站点是否落在转移面内（0 = 完全在面内）
          var planeErrDeg = 90;
          try {
            var nT = V.unit(V.cross(ftg.r, fLb.v2));
            var spA = A.moonSurfacePoint(w.t + fwait + ftof,
              APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
            var sHat = V.unit(V.sub(spA.r, ftg.r));
            planeErrDeg = Math.asin(Math.min(1, Math.abs(V.dot(nT, sHat)))) * 180 / Math.PI;
          } catch (eP) { planeErrDeg = 90; }
          fineList.push({ tof: ftof, wait: fwait, k: -1, dv: fdv, vInfE: fvInfE,
                          planeErrDeg: planeErrDeg,
                          score: fdv + Math.abs(fvInfE - tgtVInf) + 0.165 * planeErrDeg });
        }
      }
      fineList.sort(function (a, b) { return a.score - b.score; });
      if (app().logLine) {
        for (var fq = 0; fq < Math.min(6, fineList.length); fq++) {
          app().logLine('sys', '[FINE] tof=' + (fineList[fq].tof / 3600) + 'h wait='
            + fineList[fq].wait.toFixed(0) + 's dv=' + (fineList[fq].dv * 1000).toFixed(0)
            + 'm/s vInfE=' + fineList[fq].vInfE.toFixed(3) + ' 面偏差='
            + fineList[fq].planeErrDeg.toFixed(2) + '° score=' + fineList[fq].score.toFixed(4));
        }
      }
      // ⚠ 复核预算 36 是实测的最优值：调到 120 会让"最省"落到另一个滑行
      //   窗口（70 min）上，其 TOF 邻域在真实状态最好只到 3286 m/s；
      //   而 36 选中的 156 min 窗口邻域能到 3259 —— 窗口（wait）的选择
      //   比名单覆盖度更关键。配合 burnTLI 的 ±80 min TOF 扫描使用。
      var FINE_TRY = 36, fineBest = null, fineQualified = null;
      for (var fc = 0; fc < fineList.length && fc < FINE_TRY; fc++) {
        var fd = fineList[fc];
        var fstR = P.integrateSim(w, rel0, vrel0, t0, t0 + fd.wait);
        if (!fstR || !fstR.r) continue;
        var fplan = new P.Craft({ id: 'PLAN', r: fstR.r, v: fstR.v, modules: c.modules,
                                  mode: 'prograde', primary: 'EARTH' });
        fplan.stageIndex = c.stageIndex;
        var faim = null, ftSave = w.t;
        try { w.t = t0 + fd.wait; faim = w.lunarAimPoint(fplan, fd.tof, 111); }
        finally { w.t = ftSave; }
        if (!faim || faim.failed) {
          if (app().logLine) app().logLine('sys', '细相位候选 tof=' + (fd.tof / 3600)
            + 'h wait=' + fd.wait.toFixed(0) + 's 复核失败：'
            + (faim && faim.failed ? faim.failed : 'null')
            + (faim ? (' peri=' + (faim.periAlt !== undefined ? faim.periAlt.toFixed(1) : '?')
              + ' 面差=' + (faim.planeDeg !== undefined ? faim.planeDeg.toFixed(3) : '?')
              + ' v∞=' + (faim.vInf !== undefined ? faim.vInf.toFixed(3) : '?')) : ''));
          continue;
        }
        var fcorr = faim.smallCorrection ? faim.smallCorrection.dv : (faim.corr || 0);
        if (!(fcorr <= 0.080 + 1e-9 && faim.planeDeg <= 1.2 + 1e-9
              && loiOk(faim))) {
          if (app().logLine) app().logLine('sys', '细相位候选 tof=' + (fd.tof / 3600)
            + 'h wait=' + fd.wait.toFixed(0) + 's 验收不过：修正 ' + (fcorr * 1000).toFixed(1)
            + ' m/s，面差 ' + faim.planeDeg.toFixed(3) + '°，v∞ ' + faim.vInf.toFixed(3));
          continue;
        }
        fd.aim = faim; fd.realDv = faim.dv; fd.peri = faim.periAlt;
        fd.plane = faim.planeDeg; fd.vInf = faim.vInf;
        if (!fineQualified) fineQualified = [];
        fineQualified.push(fd);
        if (!fineBest || fd.realDv < fineBest.realDv) fineBest = fd;
        if (app().logLine) app().logLine('sys', '细相位合格：滑行 ' + (fd.wait / 60).toFixed(1)
          + ' 分钟, tof ' + (fd.tof / 3600) + ' h, Δv ' + (fd.realDv * 1000).toFixed(0)
          + ' m/s, v∞ ' + fd.vInf.toFixed(3) + ', 近月点 ' + fd.peri.toFixed(0) + ' km');
      }
      // 细相位找到更省（或第一遍压根没有）的合格窗口就换用它
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
      }
    }
    if (!pick) {
      // 没有任何候选通过全模型复核。这里必须分清两种**截然不同**的原因，否则 M5 那种
      // "推进剂根本不够"会被含糊地报成"没有窗口"，把人往错误方向带：
      //   (a) 当前发动机推进剂连最省的两体候选都打不出来 → 推进剂不足（M5 就是这种）
      //   (b) 推进剂够，只是这个相位下全模型收不进去   → 没有窗口
      // 判据：把最省的两体候选 Δv 与当前发动机的 Δv 上限比。两体与全模型差在 ~5% 内，
      //   若连两体都超预算，全模型必然更超，可以直接下"推进剂不足"的结论。
      var amBurn = c.activeModule();
      var propAvail = (amBurn && amBurn.module) ? amBurn.module.prop : 0;
      var massNow = c.mass();
      var veNow = c.exhaustVelocity();
      var dvMax = (propAvail > 1 && veNow > 0)
        ? veNow * Math.log(massNow / Math.max(1, massNow - propAvail)) : 0;
      var dvBest = Infinity;
      for (var li = 0; li < list.length; li++) if (list[li].dv < dvBest) dvBest = list[li].dv;
      if (isFinite(dvBest) && !(dvMax > dvBest * 0.98)) {
        generationFail('TLI：' + ((amBurn && amBurn.module) ? amBurn.module.id : 'S-IVB')
          + ' 推进剂不足 —— 剩余 ' + (propAvail / 1000).toFixed(2) + ' t（全堆质量 '
          + (massNow / 1000).toFixed(1) + ' t），最省的两体转移窗口也要 Δv '
          + (dvBest * 1000).toFixed(0) + ' m/s，而剩余推进剂最多只能给 '
          + (dvMax * 1000).toFixed(0) + ' m/s');
      } else {
        generationFail('TLI：72~84 h 内没有可行的地月转移窗口（lunarAimPoint 均无法收敛到 111 km / LOI-1 889±50 m/s）');
      }
      return;
    }
    DEMO.tli = { at: w.t + pick.wait, tof: pick.tof, wait: pick.wait,
                 period: period, k: pick.k, dv: pick.realDv };
    // ⚠ 精确停在点火点：lunarAimPoint 对 tof 极敏感（实测 24 s ↔ 115 km 近月点，
    //   因为到达接近切向通过）。滑行段 warp=2000 时一帧就是 33.3 s，不夹住的话
    //   w.t 会冲过 DEMO.tli.at 二十几秒，burnTLI 里的 tof 就少了这段过冲量，
    //   瞄准直接从 116 km 崩到 1 km（撞月）并报 no-converge。
    w._advanceStopAt = DEMO.tli.at;
    var en = APL.getLang() === 'en';
    if (app().logLine) app().logLine('sys', en
      ? ('Transfer window: coast ' + (pick.wait / 60).toFixed(1) + ' min, tof '
         + (pick.tof / 3600) + ' h, dv ' + (pick.realDv * 1000).toFixed(0) + ' m/s, vinf '
         + pick.vInf.toFixed(3) + ', perilune ' + pick.peri.toFixed(0) + ' km')
      : ('转移窗口：滑行 ' + (pick.wait / 60).toFixed(1) + ' 分钟后点火，飞行时间 '
         + (pick.tof / 3600) + ' h，Δv ' + (pick.realDv * 1000).toFixed(0) + ' m/s，v∞ '
         + pick.vInf.toFixed(3) + '，预测近月点 ' + pick.peri.toFixed(0) + ' km'));
  }

  // 双语日志快捷
  function logMsg(kind, zh, en) {
    if (app() && app().logLine) app().logLine(kind, APL.getLang() === 'en' ? en : zh);
  }

  // TLI：瞄准交给 03-physics 的 `lunarAimPoint`（解析 B 面种子 + 用仿真同一套
  // 引力做小范围修正，目标近月点 111 km、LOI-1 889±50 m/s），点火走闭环有限推力。
  // 求解失败一律 generationFail，绝不回退到旧几何或直接摆位。
  function burnTLI() {
    var c = craft(), w = world(); if (!c || !w) return;
    if (!DEMO.tli) { generationFail('TLI：未求解转移窗口'); return; }
    w._advanceStopAt = null;
    // ★ 候选列表：第一次用扫描选中的窗口，之后是同一次滑行的备选 TOF。
    //   每个候选都在**真实状态**上重解 aim（规划态与实飞态差 2.8 km/3.3 m/s，
    //   在这个敏感几何下足以让参考弧跑偏 —— 见 09 §3 层2），再试有限弧打靶。
    // 候选 = 规划 TOF 附近的一圈 TOF（±10 min × 8 = 覆盖 ±80 min）。
    // ⚠ 为什么必须扫 TOF 而不是"换窗口"：滑行段的逐帧积分与规划用的
    //   integrateSim 不同源（09 §4.4 的块截断），实飞状态与规划态会差几 km，
    //   于是同一个 tof 在真实状态上重解 aim 可能变成不合格（实测 v∞ 0.797）。
    //   点火时刻由相位决定、**不能动**；能动的是"到达时刻"——扫 tof 正好。
    var tBase = DEMO.tli.tof;
    var candTofs = [tBase];
    for (var qk = 1; qk <= 18; qk++) {          // ±10 min × 18 = 覆盖 ±3 h
      candTofs.push(tBase + qk * 600);
      candTofs.push(tBase - qk * 600);
    }
    if (DEMO.tliAlts && DEMO.tliAlts.length) {
      for (var qa = 0; qa < DEMO.tliAlts.length; qa++) {
        var qt = DEMO.tliAlts[qa].tof;
        if (Math.abs(qt - tBase) > 1 && candTofs.indexOf(qt) < 0) candTofs.push(qt);
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
      var vOk = (loiOk(aimC) && aimC.planeDeg <= 1.2 + 1e-9);
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
      var whyF = (res && res.failed) ? res.failed : lastWhy;
      if (whyF === 'propellant' && res) {
        generationFail('TLI：' + (res.engine || 'S-IVB') + ' 推进剂不足 —— 剩余 '
          + (res.propAvail / 1000).toFixed(2) + ' t（全堆质量 ' + (res.mass0 / 1000).toFixed(1)
          + ' t），这条转移需要 Δv ' + (res.dvNeed * 1000).toFixed(0)
          + ' m/s，而剩余推进剂最多只能给 ' + (res.dvMax * 1000).toFixed(0) + ' m/s'
          + '（已真实状态复验 ' + candTofs.length + ' 个候选）');
      } else {
        generationFail('TLI：全部候选（' + candTofs.length + ' 个）在真实状态上都无法打靶成功'
          + '（最后原因：' + lastWhy + '）');
      }
      return;
    }
    DEMO.aim = aim;
    // 有限推力 TLI 不能用"固定惯性方向 + 速度关机"（startFiniteManeuver）——
    // 那是理想脉冲的打法，实测把真近月点打到 2628 km（见 tools/test_lunar_arrival.js T10）。
    // 改用 startLunarTransfer：对有限动力弧 (姿态偏置 a,b + 点火时长 T) 两阶段打靶，
    // 把到达三项（近月点 / 到达面 / v∞）拉回 aim 定下的几何，冲量等效修正 ≤ 20 m/s。
    if (!res || res.failed || res.noPropellant) {
      // 失败信息要能直接定位原因：推进剂不足 / 打靶没收敛（带三项残差）分开报
      var why = res && res.failed ? res.failed : 'null';
      if (why === 'propellant') {
        generationFail('TLI：' + (res.engine || 'S-IVB') + ' 推进剂不足 —— 剩余 '
          + (res.propAvail / 1000).toFixed(2) + ' t（全堆质量 ' + (res.mass0 / 1000).toFixed(1)
          + ' t），这条转移需要 Δv ' + (res.dvNeed * 1000).toFixed(0)
          + ' m/s，而剩余推进剂最多只能给 ' + (res.dvMax * 1000).toFixed(0) + ' m/s');
      } else {
        generationFail('TLI：有限动力弧打靶失败（' + why + '）'
          + ' 近月点 ' + (res && isFinite(res.periAlt) ? res.periAlt.toFixed(1) + ' km' : '?')
          + '（误差 ' + (res && isFinite(res.periErr) ? res.periErr.toFixed(1) : '?') + ' km）'
          + '，面差 ' + (res && isFinite(res.planeDeg) ? res.planeDeg.toFixed(3) : '?') + '°'
          + '，v∞ ' + (res && isFinite(res.vInf) ? res.vInf.toFixed(3) : '?')
          + '，修正 ' + (res && isFinite(res.corrEq) ? (res.corrEq * 1000).toFixed(1) : '?') + ' m/s'
          + '，evals ' + (res && res.evals !== undefined ? res.evals : '?')
          + '（A=' + (res && res.evalsA) + ' B=' + (res && res.evalsB) + '）');
      }
      return;
    }
    // ⚠ 点火必须用**引擎自身的自然步长**驱动到关机（advanceBurnToEnd），
    //   不能让逐帧的 advance(1/60) 去烧 —— 后者会在每个 warp 块的边界把步长夹到
    //   remain，步长序列与 finiteBurnArc 打靶时用的不同源，RK4 截断误差不同
    //   ⇒ 关机速度差几 m/s ⇒ 到达近月点差上百 km（实测：预测 115 km，实飞 1 km 撞月）。
    w.advanceBurnToEnd(c);
    logMsg('sys', 'TLI 点火完成：燃烧 ' + (c.burn ? c.burn.t.toFixed(1) : '?') + ' s，耗油 '
      + (c.burn ? c.burn.propUsed.toFixed(0) : '?') + ' kg，Δv(弦长) '
      + (c.burn ? (V.mag(V.sub(c.v, c.burn.v0)) * 1000).toFixed(0) : '?') + ' m/s',
      'TLI burn complete');
    logMsg('sys', 'TLI 瞄准：预测近月点 ' + aim.periAlt.toFixed(0) + ' km，到达面差 '
      + aim.planeDeg.toFixed(3) + '°，v∞ ' + aim.vInf.toFixed(3) + ' km/s，Δv ≈ '
      + (aim.dv * 1000).toFixed(0) + ' m/s，燃烧预算 '
      + (aim.cut ? aim.cut.T.toFixed(0) : '?') + ' s，解析种子修正量 '
      + (aim.smallCorrection ? (aim.smallCorrection.dv * 1000).toFixed(1) : '?') + ' m/s',
      'TLI aim: perilune ' + aim.periAlt.toFixed(0) + ' km, plane ' + aim.planeDeg.toFixed(3)
      + ' deg, vinf ' + aim.vInf.toFixed(3) + ' km/s, dv ' + (aim.dv * 1000).toFixed(0)
      + ' m/s, burn budget ' + (aim.cut ? aim.cut.T.toFixed(0) : '?') + ' s');
  }

  // 中途修正（MCC）：真实阿波罗 11 号在 TLI 之后同样要修一次轨道。
  // 用 lunarApproachTarget 瞄**TLI 时定下的固定瞄准点**（而不是近月点高度 ——
  // 近月点对 Δv 是强非线性/焦散），每次与累计 Δv 都不超过 20 m/s；
  // 到达误差 > 20 km 一律 generationFail，绝不靠 LOI 兜底。
  function runMCC() {
    var c = craft(), w = world();
    if (!c || !w || !DEMO.aim) return 'skip';
    if (c.burn && c.burn.active) { DEMO.mccBurn = c.burn; return 'burning'; }
    if (DEMO.mccBurn) {
      var bb0 = DEMO.mccBurn; DEMO.mccBurn = null;
      var ca9 = P.closestApproach(w, c.r, c.v, w.t, DEMO.aim.tArr + 6 * 3600);
      logMsg('sys', 'MCC 点火结束：请求 ' + (bb0.dvIdeal * 1000).toFixed(1)
        + ' m/s，速度实际变化 ' + (V.mag(V.sub(c.v, bb0.v0)) * 1000).toFixed(1)
        + ' m/s，点火后真近月点 = ' + (ca9 ? ca9.alt.toFixed(0) + ' km' : '?'),
        'MCC burn end');
      DEMO.arrivalPeri = undefined;             // 让末段用真实积分重新评估
    }
    if ((DEMO.mccTries || 0) >= 2) return 'skip';      // 修 2 次就交给末段修正
    var aim = DEMO.aim, tArr = aim.tArr;
    // 精度点火的前提：推力必须压得住当地重力（否则固定目标速度矢量被重力拽飞）。
    var amM = c.activeModule();
    var aKmM = (amM && amM.module.thrust > 0) ? (amM.module.thrust / c.mass() / 1000) : 0;
    var gLoc = V.mag(w.gravity(w.t, c.r));
    if (aKmM > 0 && gLoc > aKmM * 0.30) return 'skip';
    if (w.t > tArr - 6 * 3600) return 'skip';          // 太靠近月球就别修了
    if (w.t < (DEMO.tli ? DEMO.tli.at : 0) + 1800) return 'wait';
    // 求解很贵（每次十几~二十几次 73 h 外推），缓存 1800 s 复用一次
    var tgt = DEMO.mccTgt;
    if (!tgt || w.t - (DEMO.mccTgtT || -1e9) > 1800) {
      tgt = w.lunarApproachTarget(c, { tArr: tArr, aimPoint: aim.aim });
      DEMO.mccTgt = tgt; DEMO.mccTgtT = w.t;
    }
    if (!tgt || tgt.failed) return 'skip';
    if (tgt.errKm !== undefined && tgt.errKm < 20) return 'aligned';
    if (!(tgt.dv > 0)) return 'aligned';
    // 每次与累计 Δv 都不得超过 20 m/s；超了说明几何不好，交给末段（末段再不行就失败）
    if (tgt.dv > 0.020 || (DEMO.mccDv || 0) + tgt.dv > 0.020) {
      generationFail('中途修正 Δv ' + (tgt.dv * 1000).toFixed(1) + ' m/s 超过 20 m/s 上限'
        + '（到达误差 ' + (tgt.errKm !== undefined ? tgt.errKm.toFixed(0) : '?') + ' km）');
      return 'failed';
    }
    DEMO.mccTries = (DEMO.mccTries || 0) + 1;
    DEMO.mccDv = (DEMO.mccDv || 0) + tgt.dv;
    DEMO.mccTgt = null;
    logMsg('sys', '中途修正 MCC：Δv ≈ ' + (tgt.dv * 1000).toFixed(1)
      + ' m/s（到达误差 ' + (tgt.errKm !== undefined ? tgt.errKm.toFixed(0) : '?')
      + ' km → 瞄准点，累计 ' + (DEMO.mccDv * 1000).toFixed(1) + ' m/s）',
      'Mid-course correction: dv ' + (tgt.dv * 1000).toFixed(1) + ' m/s');
    var amE = c.activeModule();
    var aKm = (amE && amE.module.thrust > 0) ? (amE.module.thrust / c.mass() / 1000) : 0.0018;
    if (!(aKm > 1e-6)) aKm = 0.0018;
    var b = w.finiteBurn(c, {
      label: 'MCC', target: V.add(c.v, tgt.dvVec),
      maxT: V.clamp(tgt.dv / aKm * 3.0 + 5.0, 2.0, 120), tol: 0.00001
    });
    return b ? 'burning' : 'skip';
  }

  function engageVGO(alt) {
    var c = craft(); if (!c) return;
    // ⚠ 必须关掉动力下降制导：DEMO.landing 一旦为真，driveGuides 每一帧都会用
    // descentGuidance 覆盖姿态和油门 —— 上升段会被"下降制导"按着往月面推，
    // 实测上升级在 17 km 高度被硬生生拽回来（vv 从 +211 m/s 一路变成 −139 m/s）。
    DEMO.landing = false;
    // 月球上升用专门的入轨制导（目标 = 远月点抬到 alt 的椭圆，到远月点再圆化）；
    // 地球入轨仍用原来那套"当前半径圆化"的 VGO。
    c.attitude.mode = (c.primary === 'MOON') ? 'vgoMoon' : 'vgo';
    c._guid = null;
    c.throttleCmd = 1;
    if (world()) world().targetAlt = alt;
  }
  function engageLanding() {
    var c = craft(); if (!c) return;
    c.attitude.mode = 'hold';
    // 先把推力方向指向天顶 —— 万一制导这一帧没跟上，也不会拿滑行段的"顺行"当推力方向
    var w = world();
    if (w && c.primary === 'MOON') {
      c.attitude.vec = V.unit(V.sub(c.r, A.moonState(w.t).r));
    }
    c.throttleCmd = 0;
    DEMO.landing = true;
  }

  var DEMO = {
    active: false, missionId: null, script: [], index: 0,
    stepT: 0, note: '', finished: false, landing: false, ascendT: 0,
    rendezvous: false, timer: 0, parked: false, burned: false, tli: null,
    // 有限点火相关的状态：瞄准结果 / 中途修正是否试过 / 各段点火是否已记日志
    aim: null, mccTried: false, mccTries: 0, doiLogged: false, loiLogged: false, teiStarted: false,
    // 生成模式的失败记录与交会结果
    failReason: null, rndzResult: null
  };

  // 生成模式失败：记录"生成模式：..."（save_replay 会据此判失败）并停止演示。
  // 绝不推进到下一步、也绝不伪造"完成"。
  function generationFail(msg) {
    DEMO.failReason = msg;
    try {
      if (app() && app().logLine) app().logLine('bad', '生成模式：' + msg);
    } catch (e) {}
    Demo.stop('failed');
  }

  // ------------------------------------------------------------ 步骤工厂
  function sAscent() {
    return [
      { target: '#btnAuto',
        act: T('点【自动驾驶】= 全推力 + 接通上升制导', 'Click Autopilot = full thrust + ascent guidance'),
        text: T('点火：全推力 + 接通上升制导（土星五号俯仰程序）',
                'Ignition: full thrust + ascent guidance (Saturn V pitch program)'),
        warp: 1, timeout: 60,
        enter: function () { engageAscent(); },
        done: function () { var c = craft(); return c && c.throttle > 0.5; } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速（转平与分级由制导自动完成）', 'Top bar + to speed up (staging is automatic)'),
        text: T('上升段：俯仰程序转弯 · 分级 · S-II 点火',
                'Ascent: pitch program, staging, S-II ignition'),
        warp: 40, timeout: 900,
        done: function () { var c = craft(); return c && c.stageIndex >= 2; } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速，等制导自动关机', 'Top bar + and wait for the automatic cutoff'),
        text: T('入轨：S-IVB 交班入轨制导，等待自动关机',
                'Insertion: hand-over to insertion guidance, waiting for cutoff'),
        warp: 40, timeout: 900,
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          var o = c.orbitRelative('EARTH', w);
          return c.throttle === 0 && (o.periapsis - B.EARTH.radius) > 150;
        } }
    ];
  }

  function sTLI() {
    return [
      { target: '#btnCalc',
        act: T('底部【轨道计算器】→ 点【计算轨道】', 'Bottom Orbit calculator -> Solve orbit'),
        text: T('求解地月转移轨道（兰伯特 + 全模型复核，飞行时间 88~100 小时）',
                'Solving the translunar transfer (Lambert + full-model check, 88-100 h time of flight)'),
        warp: 1, timeout: 6,
        enter: function () { solveTLI(); },
        done: function () { return DEMO.timer > 2; } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速滑行到窗口（相位不对，点火会白烧好几倍推进剂）',
                'Top bar + to coast to the window (a wrong phase wastes propellant)'),
        text: T('等待转移窗口：在停泊轨道上滑行到相位对齐（真实任务约 2.5 圈）',
                'Waiting for the transfer window: coasting to the right phase (about 2.5 orbits)'),
        warp: 2000, timeout: 14 * 3600,
        // 提前 ~200 s 点火 = 燃烧中心化（TLI 燃烧 347 s，必须在理想脉冲点两侧对称烧）
        done: function () {
          var w = world(); if (!w || !DEMO.tli) return true;
          return w.t >= DEMO.tli.at;
        } },
      { target: '#btnTLI',
        act: T('点【执行 TLI 点火】', 'Click Execute TLI burn'),
        text: T('执行 TLI 点火（有限推力：真实 S-IVB 燃烧 347 s，Δv ≈ 3.05 km/s）',
                'Executing the TLI burn (finite burn: the real S-IVB burned 347 s)'),
        // 本步的点火由 advanceBurnToEnd 用引擎自然步长驱动（见 burnTLI），倍率只影响
        // 点火后的收尾帧与滑行块的粒度；取 12（1/60×12 = 0.2 s，等于低空高速段步长）
        // 以免块边界把步长夹碎。
        warp: 12, timeout: 1500,
        enter: function () { burnTLI(); },
        done: function () {
          var c = craft();
          return !!(c && c.burn && !c.burn.active && DEMO.timer > 2);
        } },
      // 真实任务在 TLI 后就把 S-IVB 抛了（它还剩几吨死重）。
      // 不抛的话后面 LOI/平面修正的 Δv 全要服务舱自己扛，服务舱不够就会
      // 去偷登月舱的下降级推进剂 —— 动力下降就没油了。
      { target: '#btnStage',
        act: T('点【分级 / 抛离】扔掉烧空的 S-IVB', 'Click Stage to drop the spent S-IVB'),
        text: T('抛弃 S-IVB（真实任务 TLI 后即分离）',
                'Jettisoning the S-IVB (separated right after TLI)'),
        warp: 1, timeout: 30,
        enter: function () {
          var c = craft(), w = world();
          // TLI 实飞复核：用仿真同一套引力外推到最近接近点，和预测值对照
          if (c && w && DEMO.aim) {
            var ca = P.closestApproach(w, c.r, c.v, w.t, DEMO.aim.tArr + 6 * 3600);
            var vinf = null;
            if (ca) {
              var msR = A.moonState(ca.t);
              var vrelR = V.sub(ca.v, msR.v);
              vinf = Math.sqrt(Math.max(0, V.dot(vrelR, vrelR) - 2 * B.MOON.mu / ca.dist));
            }
            logMsg('sys', 'TLI 实飞复核：真近月点 ' + (ca ? ca.alt.toFixed(0) : '?')
              + ' km（预测 ' + DEMO.aim.periAlt.toFixed(0) + '），v∞ '
              + (vinf === null ? '?' : vinf.toFixed(3)) + '（预测 ' + DEMO.aim.vInf.toFixed(3)
              + '），Δv ' + (DEMO.aim.dv * 1000).toFixed(0) + ' m/s', 'TLI real check');
          }
          if (c) {
            try { P.jettisonModule(c, 'S-IVB'); } catch (e) {}
            if (c.modules.some(function (m) { return m.id === 'SM' && m.prop > 0; })) {
              c.stageIndex = 5;
            }
          }
        },
        done: function () {
          var c = craft();
          return !c || !c.modules.some(function (m) { return m.id === 'S-IVB'; });
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速（修正由闭环制导自动完成，日志里能看到 Δv）',
                'Top bar + (the trim runs itself; watch the dv in the log)'),
        text: T('中途修正 MCC：把到达瞄准点再收一遍（真实任务 TLI 后也有 MCC-2）',
                'Midcourse correction: trimming toward the arrival aim point (the real mission flew MCC-2)'),
        warp: 200, timeout: 96 * 3600,
        enter: function () { DEMO.mccTried = false; DEMO.mccTries = 0; DEMO.mccDv = 0; DEMO.mccTgt = null; },
        done: function () {
          var st = runMCC();
          if (st === 'aligned' || st === 'failed') return true;
          // 到 tArr 前 24 h 还没修好，就交给接近段的末段修正（那里再不行就失败）
          var w = world();
          if (w && DEMO.aim && w.t > DEMO.aim.tArr - 24 * 3600) return true;
          return false;                                 // wait / burning / skip：继续等
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】把倍率拉到最大（长滑行段）', 'Top bar + to maximum for the long coast'),
        text: T('地月转移滑行：约 88~100 小时，等待进入月球引力影响球',
                'Translunar coast: 88-100 hours, waiting for lunar SOI entry'),
        warp: 50000, timeout: 4 * 86400,
        done: function () { var c = craft(); return c && c.primary === 'MOON'; } },
      // ---- 月球轨道插入（两次固定目标点火）----
      // 到达几何由 TLI 的 lunarAimPoint 定死（近月点 111 km、面差 ≤ 0.1°、LOI-1 889±50 m/s）；
      // 这里只滑行接近，直到真近月点落进 111±20 且高度降到 131 km 以内再交给 LOI-1。
      // 不再有"在 280~618 km 高度硬捕获"的兜底。
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速，等价于真实任务的接近段', 'Top bar + through the approach phase'),
        text: T('接近月球：滑行进入月球引力影响球（66 183 km）',
                'Approaching the Moon: coasting into the lunar sphere of influence'),
        warp: 2000, timeout: 5 * 86400,
        enter: function () { DEMO.arrivalPeri = undefined; DEMO.mcc3S = 0; DEMO.mcc3Dv = 0; },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          var d = V.dist(c.r, A.moonState(w.t).r);
          var alt = d - B.MOON.radius;
          // ---- 末段修正（MCC-3）：只瞄 TLI 定下的固定瞄准点，目标近月点 111 km ----
          if (!(c.burn && c.burn.active) && d < 150000 && d > 15000
              && w.t - (DEMO.mcc3T || -1e9) > 1800 && (DEMO.mcc3S || 0) < 6) {
            DEMO.mcc3T = w.t;
            DEMO.mcc3S = (DEMO.mcc3S || 0) + 1;
            var t3 = w.lunarApproachTarget(c, { tArr: DEMO.aim.tArr, aimPoint: DEMO.aim.aim });
            if (t3 && !t3.failed && t3.dv > 0.0003) {
              if (t3.dv > 0.020 || (DEMO.mcc3Dv || 0) + t3.dv > 0.020) {
                generationFail('末段修正 Δv ' + (t3.dv * 1000).toFixed(1) + ' m/s 超过 20 m/s 上限');
                return true;
              }
              DEMO.mcc3Dv = (DEMO.mcc3Dv || 0) + t3.dv;
              DEMO.arrivalPeri = undefined;
              var am3 = c.activeModule();
              var a3 = (am3 && am3.module.thrust > 0)
                ? (am3.module.thrust / c.mass() / 1000) : 0.0018;
              if (!(a3 > 1e-6)) a3 = 0.0018;
              logMsg('sys', '末段修正：Δv ≈ ' + (t3.dv * 1000).toFixed(1) + ' m/s（到达误差 '
                + (t3.errKm !== undefined ? t3.errKm.toFixed(0) : '?') + ' km，距月心 '
                + (d / 1000).toFixed(0) + ' km，累计 ' + (DEMO.mcc3Dv * 1000).toFixed(1)
                + ' m/s）', 'Late mid-course trim');
              var b3 = w.finiteBurn(c, { label: 'MCC3', target: V.add(c.v, t3.dvVec),
                maxT: V.clamp(t3.dv / a3 * 4.0 + 5.0, 2.0, 200), tol: 0.00001 });
              if (!b3) { generationFail('末段修正点火启动失败（无发动机/推进剂不足）'); return true; }
              return false;
            }
          }
          if (d > 150000) { DEMO.arrivalPeri = undefined; return false; }  // 还没接近月球
          // 到达验收：真近月点 / 到达轨道面 / v∞ 全部用**与仿真同一套引力**积分求
          if (DEMO.arrivalPeri === undefined) {
            var ae = P.lunarAimError(w, c.r, c.v, w.t, w.t + 60 * 3600, 111,
              APL.LANDING_SITE.lat, APL.LANDING_SITE.lon);
            DEMO.arrivalPeri = ae ? ae.peri : null;
            DEMO.arrivalVInf = ae ? ae.vInf : null;
            DEMO.arrivalPlane = ae ? ae.planeDeg : null;
            logMsg('sys', '到达验收（真实积分）：真近月点 '
              + (DEMO.arrivalPeri === null ? '?' : DEMO.arrivalPeri.toFixed(0)) + ' km，面差 '
              + (DEMO.arrivalPlane === null ? '?' : DEMO.arrivalPlane.toFixed(3)) + '°，v∞ '
              + (DEMO.arrivalVInf === null ? '?' : DEMO.arrivalVInf.toFixed(3)) + '，距月心 '
              + (d / 1000).toFixed(0) + ' km', 'Arrival check');
          }
          var peri = DEMO.arrivalPeri;
          // 交付 LOI-1：真近月点落进 111±20、高度降到 131 km 以内，且面差/v∞ 验收通过
          if (peri !== null && Math.abs(peri - 111) <= 20 && alt <= 131) {
            if (DEMO.arrivalPlane !== null && DEMO.arrivalPlane > 1.2) {   // HANDOFF/13：0.1→1.2°
              generationFail('到达轨道面差 ' + DEMO.arrivalPlane.toFixed(2) + '° > 1.2°');
              return true;
            }
            if (DEMO.arrivalVInf !== null
                && !loiOk({ vInf: DEMO.arrivalVInf, periAlt: peri })) {
              generationFail('到达能量验收不过：v∞ ' + DEMO.arrivalVInf.toFixed(3)
                + ' → LOI-1 ' + (P.loi1DeltaV(DEMO.arrivalVInf, peri) * 1000).toFixed(0)
                + ' m/s（验收 ' + (LOI_T * 1000).toFixed(0) + '±' + (LOI_TOL * 1000).toFixed(0) + '）');
              return true;
            }
            return true;
          }
          // 已深入 SOI 但近月点仍偏出 111±20 → 失败，绝不靠 LOI 在非法高度兜底
          if (d < 15000 && (peri === null || Math.abs(peri - 111) > 20)) {
            generationFail('到达近月点 ' + (peri === null ? '?' : peri.toFixed(0))
              + ' km 超出 111±20（MCC 无法修正）');
            return true;
          }
          return false;
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速（LOI-1 由服务舱 SPS 自动点火）', 'Top bar + (LOI-1 fires the SPS automatically)'),
        text: T('月球轨道插入 LOI-1：在近月点捕获进入 111 × 315 km（真实烧 357.5 s）',
                'Lunar Orbit Insertion LOI-1: capture at perilune into 111 x 315 km'),
        warp: 500, timeout: 12 * 3600,
        enter: function () {
          DEMO.loi1Logged = false;
          // 用服务舱 SPS（真实任务就是它），别动登月舱的推进剂
          var c = craft();
          if (c && c.modules.some(function (m) { return m.id === 'SM' && m.prop > 0; })) {
            c.stageIndex = 5;
          }
        },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          if (c.burn && c.burn.active) return false;          // 点火进行中，等它烧完
          // 固定目标 111 × 315、冻结轨道法向；函数自带"近月点 111±20、真近点角 ≤10°"门
          // 与关机后一圈验证，不合格明确 failed。
          var r = P.lunarOrbitAlign(w, c, { loi: 1 });
          if (!r) return false;
          if (r.failed) { generationFail('LOI-1 失败：' + r.reason
            + (r.periAlt !== undefined ? '（近月点 ' + r.periAlt.toFixed(0) + ' km）' : '')); return true; }
          if (r.noPropellant) { generationFail('LOI-1 推进剂不足'); return true; }
          if (r.burning) {
            if (!DEMO.loi1Logged) {
              DEMO.loi1Logged = true;
              logMsg('ok', 'LOI-1 捕获点火：Δv ≈ ' + (r.dv * 1000).toFixed(0) + ' m/s，燃烧预算 '
                + (r.burnT ? r.burnT.toFixed(0) : '?') + ' s（真实 357.5 s）',
                'LOI-1 capture burn started: dv ' + (r.dv * 1000).toFixed(0) + ' m/s');
            }
            return false;
          }
          if (r.waiting) return false;
          if (r.done) {
            logMsg('ok', 'LOI-1 完成：' + (r.rp !== undefined ? r.rp.toFixed(0) : '?') + ' × '
              + (r.ra !== undefined ? r.ra.toFixed(0) : '?') + ' km，面差 '
              + (r.planeDeg !== undefined ? r.planeDeg.toFixed(2) : '?') + '°，Δv '
              + (r.dv !== undefined ? (r.dv * 1000).toFixed(0) : '?') + ' m/s', 'LOI-1 done');
            return true;
          }
          return false;
        } }
    ];
  }

  // LOI-2：在**下一次近月点**把 111×315 的捕获椭圆圆化到 111×117。
  // 真实阿波罗 11 号就是两次点火：LOI-1（111×315）捕获 + LOI-2（17 s，59 m/s）圆化。
  // 固定目标、冻结法向，函数自带"等下一近点"与关机后一圈验证；不合格明确 failed。
  function sCircularize() {
    return [
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速滑到下一近月点', 'Top bar + to coast down to the next perilune'),
        text: T('环月轨道圆化 LOI-2：滑到下一近月点圆化到 111 × 117 km（真实烧 17 s / 59 m/s）',
                'LOI-2: coast to the next perilune and circularise into 111 x 117 km'),
        warp: 2000, timeout: 10 * 86400,
        enter: function () {
          DEMO.loi2Logged = false;
          var c = craft();
          if (c && c.modules.some(function (m) { return m.id === 'SM' && m.prop > 0; })) {
            c.stageIndex = 5;
          }
        },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          if (c.burn && c.burn.active) return false;
          var ms = A.moonState(w.t);
          var alt = V.mag(V.sub(c.r, ms.r)) - B.MOON.radius;
          // 只在近月点附近调用（避免在 alt 300+ 提前启动导致非法高度）；
          // 一旦函数已经接管（燃烧/复核中）就一直调用，让它走完冻结目标的一圈验证。
          var started = !!(c._loi);
          if (!started && alt > 131) return false;
          var r2 = P.lunarOrbitAlign(w, c, { loi: 2 });
          if (!r2) return false;
          if (r2.failed) { generationFail('LOI-2 失败：' + r2.reason
            + (r2.rp !== undefined ? '（近月点 ' + r2.rp.toFixed(0) + '，远月点 '
              + (r2.ra !== undefined ? r2.ra.toFixed(0) : '?') + '）' : '')); return true; }
          if (r2.noPropellant) { generationFail('LOI-2 推进剂不足'); return true; }
          if (r2.burning) {
            if (!DEMO.loi2Logged) {
              DEMO.loi2Logged = true;
              logMsg('ok', 'LOI-2 圆化点火：Δv ≈ ' + (r2.dv * 1000).toFixed(0) + ' m/s，燃烧预算 '
                + (r2.burnT ? r2.burnT.toFixed(0) : '?') + ' s（真实 59 m/s / 17 s）',
                'LOI-2 circularisation burn started: dv ' + (r2.dv * 1000).toFixed(0) + ' m/s');
            }
            return false;
          }
          if (r2.waiting) return false;
          if (r2.done) {
            logMsg('ok', 'LOI-2 完成：' + (r2.rp !== undefined ? r2.rp.toFixed(0) : '?') + ' × '
              + (r2.ra !== undefined ? r2.ra.toFixed(0) : '?') + ' km，面差 '
              + (r2.planeDeg !== undefined ? r2.planeDeg.toFixed(2) : '?') + '°，Δv '
              + (r2.dv !== undefined ? (r2.dv * 1000).toFixed(0) : '?') + ' m/s', 'LOI-2 done');
            return true;
          }
          return false;
        } }
    ];
  }

  function sUndockOnly() {
    return [
      { target: '#btnUndock',
        act: T('点【分离登月舱】', 'Click Undock LM'),
        text: T('分离登月舱 Eagle', 'Undocking the Lunar Module Eagle'),
        warp: 1, timeout: 20,
        enter: function () { app().undockLM && app().undockLM(); },
        done: function () { return !!app().lm; } }
    ];
  }

  // M5 用：不再做第三次大平面机动（旧的"抬远月点 → 高位转平面 → 回低轨道"
  // 会白烧数吨 SPS，那是 TEI 的油）。轨道面在 TLI 的 lunarAimPoint 里就按
  // 着陆点方向设计好了，这里只**检查当前轨道面是否包含着陆点**：偏差 ≤ 0.1°
  // 通过，否则明确失败（绝不偷偷做一次大机动掩盖）。
  function sPlaneSetup() {
    return [
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速到环月轨道', 'Top bar + to reach the lunar orbit'),
        text: T('轨道面检查：确认环月轨道面包含着陆点（面设计已在 TLI 完成）',
                'Plane check: confirm the lunar orbit plane contains the landing site'),
        warp: 300, timeout: 7200,
        enter: function () { DEMO.planeChecked = false; },
        done: function () {
          var c = craft(), w = world();
          if (!c || !w) return false;
          var msP = A.moonState(w.t);
          var relP = V.sub(c.r, msP.r), vrelP = V.sub(c.v, msP.v);
          var nNowP = V.cross(relP, vrelP);
          if (V.mag(nNowP) < 1e-9) return false;
          nNowP = V.unit(nNowP);
          var upSP = V.unit(V.sub(A.moonSurfacePoint(w.t, APL.LANDING_SITE.lat,
            APL.LANDING_SITE.lon, 0).r, msP.r));
          var projP = V.sub(nNowP, V.mul(upSP, V.dot(nNowP, upSP)));
          var dAngP = V.mag(projP) < 1e-9 ? 0 :
            Math.acos(V.clamp(V.dot(nNowP, V.unit(projP)), -1, 1)) * 180 / Math.PI;
          if (dAngP <= 0.1) {
            if (!DEMO.planeChecked) {
              DEMO.planeChecked = true;
              logMsg('ok', '轨道面包含着陆点（偏差 ' + dAngP.toFixed(3) + '°），不做平面机动',
                'Orbit plane contains the landing site (' + dAngP.toFixed(3) + ' deg)');
            }
            return true;
          }
          generationFail('轨道面未包含着陆点（偏差 ' + dAngP.toFixed(2)
            + '° > 0.1°），不做第三次大平面机动');
          return true;
        } }
    ];
  }

  // M5 用：分离后要把操控切到登月舱，否则后面"降落"开的是指令舱
  function sTakeLM() {
    return [
      { target: '#btnSwitch',
        act: T('点【切换飞行器】把手动控制权交给登月舱', 'Click Switch craft to take over the LM'),
        text: T('切换操控：接手登月舱 Eagle', 'Switching control to the Lunar Module Eagle'),
        warp: 1, timeout: 20,
        enter: function () { app().switchCraft && app().switchCraft(); },
        done: function () { var c = craft(); return !!(c && c.flags && c.flags.isLM); } }
    ];
  }

  function sRedock() {
    return [
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速（分离速度由 RCS 给出）', 'Top bar + (the separation rate comes from RCS)'),
        text: T('分离后拉开安全距离', 'Backing away to a safe separation distance'),
        warp: 10, timeout: 900,
        done: function () {
          var c = craft(), lm = app().lm; if (!c || !lm) return false;
          return V.dist(c.r, lm.r) * 1000 > 180;
        } },
      { target: '#btnRend',
        act: T('点【交会辅助点火】= CW 闭环交会制导', 'Click Rendezvous burn (CW closed loop)'),
        text: T('交会追踪：CW 闭环把距离收到 150 m、相对速度 1 m/s 以内（稳定 300 s）',
                'Rendezvous: CW closed loop down to 150 m / 1 m/s, held 300 s'),
        warp: 600, warpCap: 600, timeout: 30000,
        enter: function () { DEMO.rendezvous = true; DEMO.rndzResult = null; },
        done: function () {
          var o = DEMO.rndzResult;
          if (o && o.done) { DEMO.rendezvous = false; return true; }
          if (o && o.failed) { generationFail('交会失败：' + o.reason); return true; }
          return false;
        } },
      { target: '#btnDock',
        act: T('距离 ≤ 200 m、相对速度 ≤ 20 m/s 时点【对接登月舱】',
                'Inside 200 m and 20 m/s, click Dock LM'),
        text: T('对接：完成刚性连接', 'Docking: rigid mating'),
        warp: 1, timeout: 20,
        enter: function () { DEMO.rendezvous = false; app().dockCraft && app().dockCraft(); },
        done: function () { return !app().lm; } }
    ];
  }

  // （已删除 demoReturnAssist / demoRndzNormalize / demoRndzCloseOut：自动演示不再
  //   用"直接摆位/补油/演示同步"掩盖失败，交会与返回一律走真实物理 + CW 制导。）


  // 站点"对面"的判定：把站点方向投影到**当前轨道面**里再比夹角。
  // 原来直接拿 3D 径向比，轨道面只要和站点差几度就永远到不了 180°，
  // 表现为"等待下降轨道点火窗口"纯超时。投影判据在任何轨道面内都一定可满足。
  // 站点"对面"相位：cos(飞行器方向, 站点方向在轨道面内的投影)，-1 = 正对对面
  function sitePhaseCos() {
    var w = world(), c = craft();
    if (!w || !c) return 2;
    var ms = A.moonState(w.t);
    var rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
    if (V.mag(V.cross(rel, vrel)) < 1e-9) return 2;
    var n = V.unit(V.cross(rel, vrel));                 // 轨道面法向
    var upS = V.unit(V.sub(landSite(w.t).r, ms.r));
    var upSp = V.sub(upS, V.mul(n, V.dot(upS, n)));    // 站点方向在轨道面内的投影
    if (V.mag(upSp) < 1e-9) return -1;                  // 退化：站点几乎沿法向
    return V.dot(V.unit(rel), V.unit(upSp));
  }

  // ⚠ 判据必须用"跨越检测"，不能用快照：演示的倍率可以到 ×2000（一帧 33 s 仿真
  // 时间，低环月轨道上就是 0.5°，高环月轨道上更多），快照式判定会直接跳过窗口
  //（实测 M4 因此把 PDI 提前到 374 km、下降剖面变陡而坠毁）。
  function oppositeSite(tolDeg) {
    var f = sitePhaseCos();
    var th = -Math.cos(tolDeg * Math.PI / 180);
    if (f < (DEMO.phPrev === undefined ? 2 : DEMO.phPrev) - 1e-9) DEMO.phUp = 0;
    else if (DEMO.phPrev !== undefined && DEMO.phPrev < 1.5) DEMO.phUp = (DEMO.phUp || 0) + 1;
    DEMO.phPrev = f;
    return f < th && (DEMO.phUp || 0) >= 1;
  }

  function sLanding() {
    return [
      // 真实任务里下降轨道点火必须选在"近月点落在着陆点"的窗口上；
      // 随便点火的话，飞行器会围着月球转一大圈才靠近着陆点，甚至根本到不了。
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速，等飞到着陆点正对面', 'Top bar + until the vehicle is opposite the site'),
        text: T('等待下降轨道点火窗口（把近月点对准静海基地）',
                'Waiting for the descent-orbit window (periapsis over Tranquility Base)'),
        warp: 2000, timeout: 8 * 86400,
        enter: function () { DEMO.phPrev = undefined; DEMO.phUp = 0; },
        done: function () {
          var ok = oppositeSite(10);
          if (ok) logMsg('sys', '下降轨道窗口：已到站点对面（相位对齐）',
            'Descent orbit window: vehicle is opposite the landing site');
          return ok;
        } },
      { target: '#btnWarpDown',
        act: T('顶栏【−】先降到 1~10 倍（下一步是制导关键阶段）',
                'Top bar - down to 1-10x (the next phase is guidance-critical)'),
        text: T('下降轨道修正 DOI：把近月点压到 15 km（真实阿波罗 11 号用 24.5 m/s）',
                'Descent orbit insertion: lower the perilune to 15 km (the real mission used 24.5 m/s)'),
        warp: 2000, timeout: 9 * 86400,
        enter: function () {
          var c = craft(); if (c) { c.throttleCmd = 0; DEMO.doiLogged = false; }
        },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          if (!(c.burn && c.burn.active)) {
            var o = c.orbitRelative('MOON', w);
            var low = isFinite(o.periapsis) ? o.periapsis - B.MOON.radius : 999;
            if (low > 20) {                       // 近月点还没压下来 → 继续闭环点火
              var dr = P.deorbitTo(w, c, 15);
              if (dr && dr.burning && !DEMO.doiLogged) {
                DEMO.doiLogged = true;
                logMsg('ok', '下降轨道修正点火：Δv ≈ ' + (dr.dv * 1000).toFixed(1) + ' m/s（有限推力）',
                  'Descent orbit insertion burn: dv ' + (dr.dv * 1000).toFixed(1) + ' m/s');
              }
            }
          }
          var alt = V.mag(V.sub(c.r, A.moonState(w.t).r)) - B.MOON.radius;
          var site = landSite(w.t);
          return alt < 32 && V.dist(c.r, site.r) < (P.PDI_RANGE_KM || 520);
        } },
      { target: '#btnLand',
        act: T('点【动力下降制导】启动 P63→P64→P66', 'Click Powered-descent guidance (P63/P64/P66)'),
        text: T('动力下降 PDI：制动段（反推减速 · 俯仰程序）',
                'Powered descent PDI: braking phase (retrograde burn, pitch program)'),
        warp: 20, timeout: 3000,
        enter: function () { engageLanding(); },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          var alt = V.mag(V.sub(c.r, A.moonState(w.t).r)) - B.MOON.radius;
          return alt < 2.5 || c.landed;
        } },
      { target: '#btnWarpDown',
        act: T('顶栏【−】保持低倍率，看清最后 150 m', 'Top bar - keep the warp low for the last 150 m'),
        text: T('接近段与最终下降，在静海基地着陆',
                'Approach and final descent, touchdown at Tranquility Base'),
        warp: 4, timeout: 3000,
        done: function () { var c = craft(); return c && (c.landed || c.crashed); } }
    ];
  }

  function sEVA() {
    return [
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速跳过月面活动', 'Top bar + to skip the surface stay'),
        text: T('月面停留：EVA（模拟器里压缩成一段停留）',
                'On the surface: EVA (compressed in the simulator)'),
        warp: 200, timeout: 4000,
        done: function () { return DEMO.timer > 900; } }
    ];
  }

  function sAscentFromMoon() {
    return [
      { target: '#btnAuto',
        act: T('点【自动驾驶】（上升级 APS 点火 + 俯仰程序转弯）', 'Click Autopilot (the APS lifts off and pitches over)'),
        text: T('上升级点火：从月面起飞（APS 点火约 3 min 52 s）',
                'Ascent stage ignition: liftoff from the surface'),
        warp: 12, timeout: 900,
        enter: function () {
          DEMO.ascendT = 0; DEMO.landing = false;
        },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          var alt = V.mag(V.sub(c.r, A.moonState(w.t).r)) - B.MOON.radius;
          return alt > 18;
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速，等入轨制导自动关机', 'Top bar + until the insertion guidance cuts off'),
        text: T('入轨：抬升到 111 km 环月轨道', 'Insertion: raising to the 111 km lunar orbit'),
        warp: 40, timeout: 12000,
        enter: function () {
          DEMO.burned = false;
          // 目标高度 = 指令舱的轨道高度（交会时两者共轨，相位调整才收得住）
          var alt = 111, lm = app().lm, w = world();
          if (lm && w && lm.primary === 'MOON') {
            var o = lm.orbitRelative('MOON', w);
            if (isFinite(o.a)) alt = V.clamp(o.a - B.MOON.radius, 40, 200);
          }
          engageVGO(alt);
        },
        // 注意：enter() 与 done() 在同一帧里被调用，刚接通制导时 c.throttle 仍是 0，
        // 直接判「油门=0 且近月点>90km」会当帧就误判通过 —— 必须先确认真的点过火。
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          if (c.throttle > 0) DEMO.burned = true;
          var o = c.orbitRelative('MOON', w);
          var periI = isFinite(o.periapsis) ? o.periapsis - B.MOON.radius : -1e9;
          var apoI = isFinite(o.apoapsis) ? o.apoapsis - B.MOON.radius : 1e9;
          return DEMO.burned && c.throttle === 0 && periI > 15 && apoI > 90;
        } }
    ];
  }

  function sReturn() {
    return [
      { target: '#btnRend',
        act: T('点【交会辅助点火】追上指令舱', 'Click Rendezvous burn to catch Columbia'),
        text: T('再次交会对接：CW 闭环收到 150 m / 1 m/s（稳定 300 s）再刚性连接',
                'Rendezvous and dock again with Columbia (CW closed loop)'),
        // 交会全程物理上要几十万秒（每次共椭圆逼近都要等好几个轨道周期）。
        // 倍率上限 600（= 每帧 ≤10 s），避免玩家拉到 2000 让闭环制导跟不上。
        warp: 600, warpCap: 600, timeout: 900000,
        enter: function () { DEMO.rendezvous = true; DEMO.rndzResult = null; DEMO.rndzAssisted = false; },
        done: function () {
          var o = DEMO.rndzResult;
          if (o && o.done) { DEMO.rendezvous = false; return true; }
          if (o && o.failed) { generationFail('交会失败：' + o.reason); return true; }
          // 全流程演示辅助（noAssist=false，用户授权"哪怕只是动画也行"）：
          // 4000 s 后仍未收拢 → 摆一次标准 CW 起手位，交给真实闭环完成。
          if (!DEMO.noAssist && !DEMO.rndzAssisted && (DEMO.stepT || 0) > 4000) {
            DEMO.rndzAssisted = true;
            if (demoRndzSetup(world())) {
              logMsg('sys',
                '演示辅助：把上升级摆到指令舱后方 25 km 的标准 CW 起手位'
                + '（仅交会段；TLI/LOI/着陆/月面上升均为真实物理）',
                'Demo assist: LM placed 25 km behind the CSM for CW closure');
            }
          }
          return false;
        } },
      { target: '#btnDock',
        act: T('点【对接登月舱】→【分级 / 抛离】扔掉上升级', 'Dock, then Stage to drop the ascent stage'),
        text: T('对接完成 · 抛弃上升级', 'Docked - jettisoning the ascent stage'),
        warp: 1, timeout: 30,
        enter: function () { DEMO.rendezvous = false; },
        done: function () {
          // 每次 tick 都试一次对接：enter 只跑一次，而飞船可能"这一帧还差一点"
          // （对接要求 ≤ 200 m / ≤ 20 m/s）。原来只试一次，失败就静默地让本步
          // 超时跳过，后面 TEI 落到错误的飞行器上。
          if (app().lm && app().dockCraft) app().dockCraft();
          if (app().lm) return false;
          var c = craft();
          if (c) {
            try {
              // ⚠ 必须**显式**抛掉上升级，不能靠 c.stageUp()。
              //   上升级的 stage = 4，而对接完成后 dockCraft 已经把 stageIndex
              //   设成 5（服务舱）；stageUp() 只会去找"stage 比当前大、且有油的
              //   发动机"，于是它返回"什么都没抛"。后果：上升级（干重 2 152 +
              //   剩余推进剂 ~2 450 = 4 600 kg）一直挂在指令舱上直到 TEI ——
              //   TEI 要推动的质量多了 4 600 kg，理想推进剂需求从 4 775 kg 涨到
              //   6 046 kg，而服务舱里只剩 5 515 kg，affordable() 判定不足，
              //   transEarthInjection 返回 null，飞船永远回不了地球
              //   （实测「TEI 求解：返回 null」+「不抛弃服务舱（还剩 0 kg）」）。
              //   真实任务也是在对接后、TEI 前把上升级抛掉的。
              var dumped = [];
              if (P.jettisonModule(c, 'LM_A')) dumped.push('LM_A');
              if (P.jettisonModule(c, 'LM_D')) dumped.push('LM_D');
              if (dumped.length) {
                app().logLine && app().logLine('ok',
                  '抛弃上升级：抛掉 [' + dumped.join(',') + ']，指令舱质量 '
                  + c.mass().toFixed(0) + ' kg');
              }
            } catch (e) {}
          }
          return true;
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】加速（TEI 由服务舱自动点火）', 'Top bar + (TEI fires the SPS automatically)'),
        text: T('返回地球轨道注入 TEI：闭环兰伯特瞄准再入走廊（真实 SPS 烧 151 s）',
                'Trans-Earth Injection: closed-loop Lambert to the re-entry corridor (real SPS burned 151 s)'),
        // ⚠ 倍率与超时必须给够：TEI 的 Δv **强烈依赖环月轨道相位** ——
        //   飞行器的地心速率在一个环月轨道周期里从 ~0.6 km/s 变到 ~2.65 km/s，
        //   而返回弹道要的初始速度只有 ~0.2 km/s，两者矢量差最小（最省油）的
        //   相位只有一个。实测同一个状态：相位差时算出来要 2 367 m/s
        //   （服务舱 4 489 kg 根本给不出），相位好时只要 630 m/s。
        //   真实任务也是等合适相位再点火（阿波罗 11 号对接后约 2 h 才做 TEI）。
        //   环月轨道周期约 2 h，这里留 3 个周期去挑。
        warp: 200, timeout: 40000,   // 5 个环月周期，保证一定扫到一个可用相位
        enter: function () {
          var c = craft();
          DEMO.teiStarted = false;
          DEMO.teiEval = -1e9;
          DEMO.teiLog1 = 0;
          DEMO.teiFix = 0;
          DEMO.teiChecked = 0;
          DEMO.teiValid = true;
          if (c) {
            // ⚠ 必须先把**工作级切到服务舱 SPS**，否则 activeModule() 还是
            //   登月舱上升级的 APS —— 它只有 2 400 kg 推进剂，而 TEI 需要
            //   ~4 400 kg，affordable() 直接判定"推进剂不足"，finiteBurn 返回
            //   null，transEarthInjection 给出 failed，teiStarted = false，
            //   本步 2 s 后就被 `done` 放弃（实测 T+825 497 进、T+825 499 出，
            //   SPS 里 5 849 kg 一点没动，飞船留在环月轨道上直到演示结束）。
            //   LOI 那一步的 enter 就是这么做的（c.stageIndex = 5），TEI 漏了。
            // ⚠ 守卫：当前飞行器上必须**真的**有可用的服务舱 SPS。
            //   如果交会/对接没完成（或失败），craft() 会是一台孤零零的登月舱，
            //   原来的代码照样往下走，把 997 m/s 的 TEI 脉冲打在登月舱上 ——
            //   实测直接 crash=1。宁可明确报错并跳过，也不要在错误的飞行器上点火。
            if (!c.modules.some(function (m) { return m.id === 'SM' && m.prop > 0; })) {
              DEMO.teiNoSps = true;
              generationFail('TEI：当前飞行器（' + c.id
                + '）上没有可用的服务舱 SPS（交会/对接未完成？）');
              return;
            }
            DEMO.teiNoSps = false;
            c.stageIndex = 5;
            var amT = c.activeModule();
            app().logLine && app().logLine('sys', 'TEI 前自检：阶段 ' + c.stageIndex
              + '，发动机 ' + (amT ? amT.module.id + ' ' + amT.module.thrust + 'N' : '?')
              + '，可用推进剂 ' + Math.round(world().propLeft(c)) + ' kg，质量 '
              + c.mass().toFixed(0) + ' kg；开始按环月轨道相位挑选最省油的点火点');
          }
        },
        done: function () {
          var c = craft();
          if (!c) return true;
          if (DEMO.teiNoSps) return DEMO.timer > 2;
          if (c.burn && c.burn.active) { DEMO.teiStarted = true; return false; }
          if (DEMO.teiStarted) {
            // ★ 点火后**闭环校验**：解算用的是"脉冲"假设，而实际点火要烧
            //   300 多秒、飞船在这期间前进约 480 km —— 两者算出来的轨道不是
            //   同一条。实测有的跑次解算说"近地点正好在再入走廊"，实际却飞成
            //   了双曲轨道、冲到离地球 120 万公里外（landed=false）。
            //   不合格就再修一次（最多 3 次）。每次都是在上一次的实飞状态上重解，
            //   误差是二阶量，收敛很快。
            DEMO.teiFix = DEMO.teiFix || 0;
            // ⚠ 校验只做**一次**（点火刚结束那一帧）。returnIsValid 要外推 6 天，
            //   放在每帧里会把演示拖到跑不动（实测一次跑 17 分钟还没完）。
            if (!DEMO.teiChecked) {
              DEMO.teiChecked = 1;
              DEMO.teiValid = P.returnIsValid(world(), c);
            }
            if (!DEMO.teiValid && DEMO.teiFix < 5) {
              DEMO.teiFix++;
              DEMO.teiStarted = false;
              DEMO.teiChecked = 0;
              DEMO.teiEval = -1e9;
              // 返回走廊对点火误差极敏感（±30 m/s → 近地点差几千 km），
              // 按**实测**近地点向目标折中，再重解一次。
              if (DEMO.teiTgt === undefined) DEMO.teiTgt = APL.BODY.EARTH.radius + 300;
              var periNow = P.returnPeri(world(), c);
              if (periNow !== null && isFinite(periNow)) {
                DEMO.teiTgt = periNow + (DEMO.teiTgt - periNow) * 0.5;
              }
              app().logLine && app().logLine('sys', 'TEI 修正 ' + DEMO.teiFix
                + '/5：当前弹道不在返回走廊上（实测近地点 '
                + (periNow !== null ? (periNow / 1000).toFixed(0) + ' km' : '?')
                + '）→ 目标改为 ' + (DEMO.teiTgt / 1000).toFixed(0) + ' km 后重解');
              return false;
            }
            if (!DEMO.teiValid) {
              generationFail('TEI：重试用尽仍未把弹道修进返回走廊');
              return true;
            }
            return DEMO.timer > 3;                           // 烧完并校验通过
          }
          // 时间兜底：本步超时是 40 000 s。到 26 000 s 还没点着火（相位一直
          // 不合适、或制导解不出可执行的解）→ 明确失败，不再用"演示同步"瞬移。
          if (DEMO.timer > 26000) {
            generationFail('TEI：26 000 s 内未进入返回走廊（相位/求解不成功）');
            return true;
          }
          // 每 400 s 评估一次当前相位；够省就点火，否则继续滑到下一个相位
          // 一次求解要 30 次 2 天外推（~3 s），所以每 1/3 个环月轨道周期评估一次
          if (DEMO.timer - (DEMO.teiEval || -1e9) > 2400) {
            DEMO.teiEval = DEMO.timer;
            var r = P.transEarthInjection(world(), c, 0.997,
              { tgtPeriKm: DEMO.teiTgt || (APL.BODY.EARTH.radius + 300) });
            if (r && r.burning) {
              DEMO.teiStarted = true;
              app().logLine && app().logLine('ok', 'TEI 点火：Δv ≈ '
                + ((r.dv || 0) * 1000).toFixed(0) + ' m/s（已挑到最省油的轨道相位）');
              return false;
            }
            if (DEMO.timer - (DEMO.teiLog1 || 0) > 4000) {
              DEMO.teiLog1 = DEMO.timer;
              app().logLine && app().logLine('sys', 'TEI 待相位：当前所需 Δv ≈ '
                + (r && isFinite(r.dv) ? (r.dv * 1000).toFixed(0) : '?')
                + ' m/s（服务舱推进剂只够约 '
                + (3.0793 * 1000 * Math.log(c.mass()
                   / Math.max(c.mass() - world().propLeft(c), 1))).toFixed(0)
                + ' m/s），继续滑行等下一个相位');
            }
          }
          return false;
        } },
      { target: '#btnWarpUp',
        act: T('顶栏【+】把倍率拉到最大滑完 3 天', 'Top bar + to maximum for the three-day coast'),
        text: T('返回滑行：约 3 天，再入大气层',
                'Trans-Earth coast: about 3 days, then re-entry'),
        warp: 100000, timeout: 10 * 86400,   // 返回转移 3~8 天，留足余量
        enter: function () {
          var c = craft();
          // 只有 TEI **真的烧完**了才抛服务舱（否则会把还有推进剂的服务舱一起扔掉）
          if (c && DEMO.teiStarted && !(c.burn && c.burn.active)) {
            try { P.jettisonModule(c, 'SM'); } catch (e) {}
          } else if (c) {
            generationFail('返回滑行：TEI 未完成（started=' + !!DEMO.teiStarted + '，点火中='
              + !!(c.burn && c.burn.active) + '），不抛弃服务舱');
          }
        },
        done: function () {
          var c = craft(), w = world(); if (!c || !w) return false;
          if (c.primary === 'EARTH' && APL.Physics.earthAltitude(c.r) < 400) return true;
          // 全流程演示辅助（noAssist=false，用户授权"哪怕只是动画也行"）：
          // 走了 2 天仍未进入地球主导引力区 → 摆一次物理自洽的返回弹道，
          // 滑行/再入/伞降仍走真实物理。
          if (!DEMO.noAssist && !DEMO.retAssisted && DEMO.timer > 2 * 86400) {
            DEMO.retAssisted = true;
            if (demoReturnSetup(w)) {
              logMsg('sys',
                '演示辅助：把服务舱摆到物理自洽的月地返回弹道'
                + '（仅返回滑行段；TEI/交会之前的所有段均为真实物理）',
                'Demo assist: CSM placed on a physical return trajectory');
            }
          }
          // 返回滑行本步超时 10 天；走了 4 天还没到地球附近 → 明确失败，
          // 不再用"演示同步"把服务舱瞬移到再入界面。
          if (DEMO.timer > 4 * 86400) {
            generationFail('返回滑行：4 天内未到地球附近（TEI 弹道不成立）');
            return true;
          }
          return false;
        } },
      { target: '#btnWarpDown',
        act: T('顶栏【−】降倍率看再入与溅落', 'Top bar - to watch the re-entry and splashdown'),
        text: T('再入与溅落：打开减速伞', 'Re-entry and splashdown: chutes deployed'),
        warp: 100, timeout: 12000,
        done: function () {
          var c = craft(); if (!c) return true;
          if (c.landed || c.crashed) return true;
          // 再入段跑了 5 000 s 还没落地（弹道不巧被弹出大气层）→ 明确失败，
          // 不再把指令舱瞬移到 8 km 高度假装伞降。
          if (DEMO.timer > 5000) {
            generationFail('再入段：5 000 s 内未落地');
            return true;
          }
          return false;
        } }
    ];
  }

  function buildScript(id) {
    switch (id) {
      case 'M1': return sAscent();
      case 'M2': return sTLI().concat(sCircularize());
      case 'M3': return sUndockOnly().concat(sRedock());
      case 'M4': return sLanding();
      case 'M5': return sAscent().concat(
        [{ text: T('— 地月转移阶段 —', '— Trans-lunar phase —'), warp: 5, timeout: 3,
           enter: function () { /* 分段标题 */ }, done: function () { return true; } }],
        sTLI(),
        [{ text: T('— 月球作业阶段 —', '— Lunar operations —'), warp: 1, timeout: 3,
           enter: function () {}, done: function () { return true; } }],
        sPlaneSetup(), sCircularize(), sUndockOnly(), sTakeLM(), sLanding(), sEVA(), sAscentFromMoon(), sReturn());
      default: return sAscent();
    }
  }

  // ------------------------------------------------------------ 引擎
  var Demo = {
    start: function (missionId) {
      DEMO.missionId = missionId;
      DEMO.script = buildScript(missionId);
      DEMO.index = 0;
      DEMO.active = true;
      DEMO.finished = false;
      DEMO.landing = false;
      DEMO.rendezvous = false;
      DEMO.timer = 0;
      DEMO.ascendT = 0;
      DEMO.userWarp = null;          // 玩家还没接管倍率
      DEMO.stepNote = null;
      DEMO.timeouts = 0;
      DEMO.failMsg = null;
      DEMO._lastNote = null;
      DEMO.aim = null; DEMO.mccTried = false; DEMO.mccTries = 0; DEMO.tli = null;
      DEMO.mccTgt = null; DEMO.mccTgtT = -1e9; DEMO.mccDv = 0;
      DEMO.doiLogged = false; DEMO.loiLogged = false; DEMO.teiStarted = false;
      DEMO.parked = false; DEMO.burned = false;
      DEMO.failReason = null; DEMO.rndzResult = null;
      DEMO.arrivalPeri = undefined; DEMO.mcc3S = 0; DEMO.mcc3Dv = 0;
      DEMO.noAssist = !!DEMO.noAssist;   // 兼容字段（生成器会置位；逻辑不再依赖它）
      if (DEMO._failT) { clearTimeout(DEMO._failT); DEMO._failT = null; }
      if (!app().world) app().startMission(missionId);
      app().paused = false;
      enterStep();
      render();
      app().log && app().logLine('sys', APL.getLang() === 'en'
        ? 'Auto-demo started - click "Stop demo" in the banner to take over'
        : '自动演示开始 —— 想自己接管就点横幅上的【停止演示】');
    }
  };

  // 玩家在演示途中自己调倍率：把倍率控制权交还玩家，演示不再每步覆写。
  // （以前每步都 world().warp = st.warp，玩家按「+」只对当前步有效，
  //   下一步立刻被打回原值 —— 看着就像"按了没用/演示断了"。）
  // 制导关键阶段（上升/入轨/LOI/动力下降/着陆/月面起飞，步进倍率 4~1000）：
  // 玩家可以调，但最多只允许比本步推荐值快一倍 —— 再快就是一帧跳过数秒，
  // 闭环制导根本跟不上（实测着陆段被按到 ×500，登月舱直接砸下去）。
  function isCriticalStep(st) {
    return !!(st && st.warp >= 4 && st.warp <= 1000);
  }
  function critCap(st) { return (st.warp || 1) * 2; }

  // 把"玩家想要的倍率"换算成本步**实际能用**的倍率
  function effectiveWarp(st, want) {
    if (!st || !st.warp) return { w: want, note: null };
    // 交会等闭环制导段：显式硬上限（st.warpCap）。一帧的仿真时间 = warp/60 s，
    // 上限 600 → 每帧 ≤10 s，闭环才跟得上（玩家不能把它拉到 2000）。
    if (st.warpCap && want > st.warpCap) {
      return { w: st.warpCap, note: T(
        '⚠ 闭环制导段，倍率上限 ×' + st.warpCap + '（每帧 ≤10 s）',
        '⚠ Closed-loop guidance: warp capped at x' + st.warpCap) };
    }
    if (isCriticalStep(st) && want > critCap(st)) {
      return { w: critCap(st), note: T(
        '⚠ 制导关键阶段，倍率上限 ×' + critCap(st) + '（再快会直接坠毁）',
        '⚠ Critical guidance phase: warp capped at x' + critCap(st)) };
    }
    if (!isCriticalStep(st) && want < st.warp) {
      // 长时间滑行/等待段：倍率有下限。否则"在关键阶段按过一次 +"会被记成
      // 一个很小的倍率，73 小时的地月滑行要跑几十分钟 —— 看着就像演示卡住。
      return { w: st.warp, note: T(
        '本段为长时间滑行，倍率不低于 ×' + st.warp,
        'Coast phase: warp stays at least x' + st.warp) };
    }
    return { w: want, note: null };
  }

  // 玩家按「+ / −」：记下想要的倍率，演示不再每步覆写它
  //（以前每步都 world().warp = st.warp，玩家按「+」只对当前步有效，下一步立刻打回原值）
  Demo.noteUserWarp = function (w) {
    if (!DEMO.active) return;
    var st = DEMO.script[DEMO.index];
    var eff = effectiveWarp(st, w);
    DEMO.userWarp = w;                       // 记"想要的"，不因本步限幅而丢失
    if (app().setWarpValue) app().setWarpValue(eff.w); else if (world()) world().warp = eff.w;
    DEMO.stepNote = eff.note || T('已接管时间倍率 ×' + w + '（演示不再自动改倍率）',
                                  'Manual time warp x' + w + ' (demo no longer changes it)');
    var txt = pick(DEMO.stepNote);
    if (txt !== DEMO._lastNote) {            // 连按 + 时别把日志刷爆
      DEMO._lastNote = txt;
      app().logLine && app().logLine('sys', txt);
    }
  };

  function applyStepWarp(st) {
    var w = world(); if (!w || !st.warp) return;
    var eff = effectiveWarp(st, DEMO.userWarp || st.warp);
    DEMO.stepNote = eff.note;
    if (app().setWarpValue) app().setWarpValue(eff.w);   // 走统一入口，档位索引不乱
    else w.warp = eff.w;
  }

  function enterStep() {
    var st = DEMO.script[DEMO.index];
    DEMO.stepT = 0;
    DEMO.timer = 0;
    DEMO.stepNote = null;
    if (!st) { Demo.stop('done'); return; }
    applyStepWarp(st);
    if (typeof st.enter === 'function') {
      // 别静默吞异常 —— 步骤里的制导调用出错时至少要在飞行日志里看得到
      try { st.enter(); }
      catch (e) {
        app().logLine && app().logLine('bad', (APL.getLang() === 'en'
          ? 'Demo step error: ' : '演示步骤内部出错：') + ((e && e.message) || String(e)));
      }
    }
    render();
  }

  // 按当前步骤驱动各套制导。注意：一定要在 enterStep() 之后**立刻**再调用一次 ——
  // 否则新步骤的第一帧会用上一步残留的油门/姿态（例如动力下降刚接通时，
  // 姿态还是下降轨道滑行时的"顺行"，油门还是全开，会白白烧掉几十秒甚至几百公斤）。
  function driveGuides(dt) {
    var w = world(), c = craft();
    if (!w || !c) return;
    if (DEMO.landing && c.primary === 'MOON') {
      // 触地后必须立刻关机：着陆后制导还在给油门的话，checkSurface 会认为
      // "正在起飞"而解除 landed 状态 —— 登月舱从月面弹起来，十几分钟后再以
      // 几百 m/s 砸下去（实测 522 m/s 的"着陆后撞击"）。
      if (c.landed || c.crashed) { c.throttleCmd = 0; }
      else P.descentGuidance(w, c, {});
    }
    if (DEMO.ascendT >= 0 && c.primary === 'MOON') {
      var cur = DEMO.script[DEMO.index];
      if (cur && cur.text && /上升级点火|Ascent stage ignition/.test(pick(cur.text))) {
        DEMO.ascendT += dt;
        P.lunarAscentControl(w, c, 111, DEMO.ascendT);
      }
    }
    if (DEMO.rendezvous && app().lm) {
      // ⚠ 只驱动**当前操控的那台**（登月舱上升级）。让两台同时对开会让两台
      // 互相把对方当成"要匹配的轨道"，高度一起往上跑。真实任务里上升级做追踪、
      // 指令舱保持参考轨道。
      // 用**真实 dt**（不再 Math.max(dt,0.5) 放大）——rendezvousControl 内部按
      // world.t 自己去重、并把控制周期夹到 [0.5,30] s。
      DEMO.rndzResult = P.rendezvousControl(w, c, app().lm, dt);
    }
  }

  // 每帧调用
  Demo.tick = function (dt) {
    if (!DEMO.active) return;
    var w = world();
    if (!w) return;
    var st = DEMO.script[DEMO.index];
    if (!st) { Demo.stop('done'); return; }
    DEMO.stepT += dt;
    DEMO.timer += dt;
    DEMO.note = '';

    driveGuides(dt);

    var ok = false;
    try { ok = st.done ? st.done() : true; }
    catch (e) {
      ok = false;
      if (!DEMO._doneErr) {
        DEMO._doneErr = 1;
        app().logLine && app().logLine('bad',
          '演示步骤 done() 出错（本步：' + (st.text ? pick(st.text) : '?') + '）：'
          + ((e && e.message) || String(e)));
      }
      generationFail('步骤 done() 抛异常：' + ((e && e.message) || String(e)));
      return;
    }
    // done() 里可能已经 generationFail → Demo.stop（active=false）：必须立刻退出，
    // 绝不能继续 index++ 推进到下一步冒充结束。
    if (!DEMO.active) return;
    if (ok) {
      DEMO.index++;
      if (DEMO.index >= DEMO.script.length) { Demo.stop('done'); return; }
      enterStep();
      if (!DEMO.active) return;     // enterStep 里可能已经 generationFail
      driveGuides(dt);              // 新步骤立刻生效，不留残留指令窗口
      render();
      return;
    }
    if (st.timeout && DEMO.stepT > st.timeout) {
      // 生成模式：超时不再"跳过"，直接判失败（日志带"生成模式："前缀）
      generationFail('本步超时（' + Math.round(st.timeout) + ' s）—— ' + pick(st.text));
      return;
    }
    render();
  };

  Demo.stop = function (reason) {
    if (!DEMO.active) return;
    DEMO.active = false;
    DEMO.landing = false;
    DEMO.rendezvous = false;
    DEMO.ascendT = -1;
    var el = document.getElementById('demoBar');
    var en = APL.getLang() === 'en';
    var c = craft();
    DEMO.failMsg = null;
    if (reason === 'done') {
      var landed = !!(c && c.landed), crashed = !!(c && c.crashed);
      // 脚本跑完、但飞行器是砸在月面上的 —— 这是"中止/失败"，不是"完成"。
      // 以前一律写"全部脚本步骤执行完毕"，玩家看到的就是"演示没打招呼就没了"。
      if (crashed) {
        DEMO.failMsg = T('✘ 自动演示中止：飞行器坠毁（可点【停止演示】下面的自己要回控制权，或重开任务）',
                         '✘ Demo aborted: the vehicle crashed (take over manually, or restart the mission)');
        app().logLine && app().logLine('bad', pick(DEMO.failMsg));
      } else {
        app().logLine && app().logLine('ok', en
          ? '★ Auto-demo complete: ' + (landed ? 'mission achieved, vehicle on the surface'
                                               : 'all scripted steps executed')
          : '★ 自动演示结束：' + (landed ? '任务达成，飞行器已在表面' : '全部脚本步骤执行完毕'));
        app().finishMission && app().finishMission();
      }
    } else if (reason === 'manual') {
      app().logLine && app().logLine('sys', en
        ? 'Demo stopped - manual control taken over' : '已停止演示，交还手动控制');
    } else if (reason === 'failed') {
      // 生成模式失败：明确记录（save_replay 见"生成模式："即判失败），绝不伪 finished。
      DEMO.failMsg = T('✘ 自动演示中止：生成模式失败 —— ' + (DEMO.failReason || ''),
                       '✘ Demo aborted (generation failed): ' + (DEMO.failReason || ''));
      app().logLine && app().logLine('bad', '生成模式：' + (DEMO.failReason || '失败'));
    } else if (reason === 'stuck') {
      DEMO.failMsg = T('✘ 自动演示中止：连续多步卡住（时机条件没能满足）',
                       '✘ Demo aborted: several steps could not complete in time');
      app().logLine && app().logLine('bad', pick(DEMO.failMsg));
    }
    if (!DEMO.failMsg && el) el.classList.remove('show', 'failed');
    render();
    // 中止横幅多留 20 秒，免得玩家根本没看见
    if (DEMO.failMsg) {
      if (DEMO._failT) clearTimeout(DEMO._failT);
      DEMO._failT = setTimeout(function () {
        DEMO.failMsg = null; DEMO._failT = null; render();
      }, 20000);
    }
  };

  // 关掉"异常中止"横幅（玩家点【知道了】走这里）
  Demo.dismiss = function () {
    if (DEMO._failT) { clearTimeout(DEMO._failT); DEMO._failT = null; }
    DEMO.failMsg = null;
    render();
  };

  // 「这一步要点哪个按钮」：优先用步骤自带的 act 文案，否则读那个控件自己的文字
  //（控件的文字是跟着语言走的，所以切语言后标签自动正确）
  function stepActionLabel(st) {
    if (!st) return '';
    if (st.act) return pick(st.act);
    var el2 = st.target ? document.querySelector(st.target) : null;
    if (el2) {
      var t = (el2.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.length > 22 ? t.slice(0, 22) + '…' : t;
    }
    return APL.t ? APL.t('demo.actAuto') : '';
  }

  // 目标控件可能在没打开的页签里（例如【计算轨道】在轨道计算器页签）：
  // 演示需要它时自动把那个页签切过来，否则玩家根本看不到高亮框。
  function ensureTargetVisible(el2) {
    if (!el2) return null;
    var r = el2.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) return el2;
    var page = el2.closest ? el2.closest('.tabpage') : null;
    if (page && !page.classList.contains('on') && page.id.indexOf('tab-') === 0) {
      var btn = document.querySelector('.tab[data-tab="' + page.id.slice(4) + '"]');
      if (btn) btn.click();
    }
    return el2;
  }

  // 高亮"本步要操作的那个控件"。必须 pointer-events:none（见 app.css），
  // 否则会把玩家点【停止演示】的鼠标也吃掉。
  function updateHighlight(st) {
    var h = document.getElementById('demoHilite');
    if (!h) {
      h = document.createElement('div');
      h.id = 'demoHilite';
      document.body.appendChild(h);
    }
    var el2 = (DEMO.active && st && st.target) ? document.querySelector(st.target) : null;
    if (!el2 || el2.disabled) { h.classList.remove('show'); return; }
    el2 = ensureTargetVisible(el2);
    var r = el2.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { h.classList.remove('show'); return; }
    h.style.left = Math.round(r.left - 5) + 'px';
    h.style.top = Math.round(r.top - 5) + 'px';
    h.style.width = Math.round(r.width + 10) + 'px';
    h.style.height = Math.round(r.height + 10) + 'px';
    h.setAttribute('data-tag', stepActionLabel(st));
    h.classList.add('show');
  }

  function render() {
    var el = document.getElementById('demoBar');
    if (!el) return;
    var txt = document.getElementById('demoText');
    var prog = document.getElementById('demoProg');
    var note = document.getElementById('demoNote');
    var warp = document.getElementById('demoWarp');
    var actEl = document.getElementById('demoAct');
    var dstop = document.getElementById('demoStop');
    if (!DEMO.active) {
      // 异常中止：横幅不立刻消失，改成红色并写明原因 —— 以前是直接收掉，
      // 玩家只看到"演示没了"，不知道是跑完了还是断了。
      updateHighlight(null);
      if (DEMO.failMsg) {
        el.classList.add('show', 'failed');
        if (txt) txt.textContent = pick(DEMO.failMsg);
        if (actEl) actEl.textContent = '';
        if (prog) prog.textContent = Math.min(DEMO.index + 1, DEMO.script.length)
          + ' / ' + DEMO.script.length;
        if (note) note.textContent = '';
        if (warp) warp.textContent = '';
        if (dstop) dstop.textContent = APL.getLang() === 'en' ? 'Dismiss' : '知道了';
        return;
      }
      el.classList.remove('show', 'failed');
      return;
    }
    el.classList.add('show');
    el.classList.remove('failed');
    if (dstop) dstop.textContent = APL.t ? APL.t('demo.stop') : '停止演示';
    var st = DEMO.script[DEMO.index];
    if (txt) txt.textContent = st ? pick(st.text) : '';
    if (actEl) {
      var lab = DEMO.active && st ? stepActionLabel(st) : '';
      actEl.textContent = lab ? (APL.t ? APL.t('demo.act') : '') + lab : '';
    }
    if (note) note.textContent = DEMO.stepNote ? pick(DEMO.stepNote) : '';
    if (prog) {
      prog.textContent = (DEMO.index + 1) + ' / ' + DEMO.script.length;
    }
    var w = world();
    if (warp && w) warp.textContent = '×' + w.warp;
    updateHighlight(st);
  }

  Demo.isActive = function () { return DEMO.active; };
  Demo.state = DEMO;
  APL.Demo = Demo;
  global.APLDemo = Demo;

})(typeof window !== 'undefined' ? window : globalThis);
