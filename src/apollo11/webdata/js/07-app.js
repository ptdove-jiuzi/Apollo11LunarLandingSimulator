/* =========================================================================
 *  07-app.js  —  游戏主逻辑与界面
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var V = APL.V, M = APL.M, A = APL.Astro, B = APL.BODY, P = APL.Physics, C = APL.C;

  var App = {
    world: null, renderer: null, agc: null, agcProg: null,
    mission: null, craft: null, lm: null,
    warpIndex: 0, paused: true, lastFrame: 0, fps: 0,
    mode: 'live',            // 'live' 实时物理 / 'replay' 离线轨迹回放
    driverExternal: false,   // 外部固定步长驱动（生成器/回放）接管主循环
    objectives: {}, ui: {}, logs: [], maxLog: 400,
    started: false
  };
  global.APLApp = App;
  var $ = function (id) { return document.getElementById(id); };
  // 双语快捷函数：L(中文, English)
  function L(zh, en) { return (APL.getLang && APL.getLang() === 'en') ? en : zh; }
  function TT(key, params) { return APL.t ? APL.t(key, params) : key; }

  // 推进级英文名
  var MODULE_EN = {
    'S-IC': 'S-IC first stage', 'S-II': 'S-II second stage', 'S-IVB': 'S-IVB third stage',
    'ESA': 'Instrument unit / adapter / escape tower',
    'LM_D': 'LM descent stage', 'LM_A': 'LM ascent stage',
    'SM': 'Service module (SPS)', 'CM': 'Command module'
  };
  function modName(m) {
    return (APL.getLang() === 'en' && MODULE_EN[m.id]) ? MODULE_EN[m.id] : m.name;
  }

  // 有限点火的中英文名称（飞行日志用）
  var BURN_ZH = {
    TLI: 'TLI 地月转移注入', LOI: '环月轨道插入', TEI: '返回地球轨道注入',
    DOI: '下降轨道修正', MCC: '中途修正',
    'plane-raise': '抬高远月点', 'plane-turn': '轨道面调整', 'orbit-align': '环月轨道圆化'
  };
  var BURN_EN = {
    TLI: 'TLI translunar injection', LOI: 'lunar orbit insertion', TEI: 'trans-earth injection',
    DOI: 'descent orbit insertion', MCC: 'midcourse correction',
    'plane-raise': 'apolune raise', 'plane-turn': 'plane change', 'orbit-align': 'lunar orbit circularisation'
  };
  function burnName(label) {
    var en = APL.getLang && APL.getLang() === 'en';
    var t = en ? BURN_EN[label] : BURN_ZH[label];
    return t || label || 'burn';
  }
  var el = function (tag, cls, txt) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (txt !== undefined) d.textContent = txt;
    return d;
  };

  // ============================================================ 工具箱
  function num(x, n) { return (isFinite(x) ? x : 0).toFixed(n === undefined ? 2 : n); }
  function km(x) {
    var a = Math.abs(x);
    if (a >= 1e6) return (x / 1e6).toFixed(3) + 'M';
    if (a >= 1e4) return (x / 1e3).toFixed(1) + 'k';
    return x.toFixed(a >= 100 ? 1 : 2);
  }
  function v3(arr) { return arr.map(function (x) { return num(x, 3); }).join(', '); }

  // ============================================================ 任务场景
  function orbitStateAround(mu, centerPos, centerVel, radius, incRad, raanRad, nuRad, progradeSign) {
    var el = { a: radius, e: 0, i: incRad, raan: raanRad, argp: 0, nu: nuRad };
    var st = M.stateFromElements(mu, el);
    return { r: V.add(centerPos, st.r), v: V.add(centerVel, st.v) };
  }

  var SCENARIO_T = { M2: 700, M3: 360000, M4: 362000, M5: 0, M1: 0 };

  function buildScenario(id) {
    var w = new P.World();
    w.running = true;
    var mission = APL.MISSIONS.filter(function (m) { return m.id === id; })[0];
    var c;
    w.t = SCENARIO_T[id] || 0;

    if (mission.startState === 'prelaunch') {
      var site = A.siteState(0, APL.SITE.lat, APL.SITE.lon, 0.02);
      c = new P.Craft({ id: 'CSM', name: 'Columbia', r: site.r, v: site.v, mode: 'launch' });
      c.throttleCmd = 0;
      w.addCraft(c);
      w.autoStage = true;
      w.t = 0;
    } else if (mission.startState === 'parking') {
      // 已在地球停泊轨道：183.2 x 185.9 km, i = 32.521°
      // 关键：轨道面必须尽量包含「TLI 到达时刻的月球方向」，否则兰伯特
      // 解出来的 Δv 会大得离谱（实测 11.5 km/s，真实 TLI 只有 3.05 km/s）。
      // 真实任务靠选发射方位角 + 发射窗口来实现同一件事。
      var rp = B.EARTH.radius + 183.2, ra = B.EARTH.radius + 185.9;
      var a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
      var incP = APL.SITE.parkingInclination * M.D2R;
      var tofP = 96 * 3600;
      var uArr = V.unit(A.moonState(w.t + tofP).r);
      var uMtarget = A.moonState(w.t + tofP).r;
      var rMid = (rp + ra) / 2;
      var bestST = null;
      M.raanCandidates(incP, uArr).forEach(function (raanP) {
        var nP = M.orbitNormal(incP, raanP);
        var depP = V.sub(uArr, V.mul(nP, V.dot(uArr, nP)));
        if (V.mag(depP) < 1e-9) return;
        depP = V.unit(depP);
        var rDep = V.mul(depP, -rMid);
        var vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(B.EARTH.mu / rMid));
        // 正对月球的180° Lambert退化，两候选都会无解；不能默认取第一个高倾面。
        var moonArrival = A.moonState(w.t + tofP);
        var lunarNormal = V.unit(V.cross(moonArrival.r, moonArrival.v));
        var planeScore = Math.acos(V.clamp(V.dot(nP, lunarNormal), -1, 1));
        var Lb = M.lambert(B.EARTH.mu, rDep, uMtarget, tofP, true);
        var dv = Lb ? V.mag(V.sub(Lb.v1, vDep)) : null;
        if (!bestST || planeScore < bestST.planeScore) {
          bestST = { dv: dv, planeScore: planeScore, r: rDep, v: vDep, raan: raanP, n: nP };
        }
      });
      var st = bestST ? { r: bestST.r, v: bestST.v } : { r: [rMid, 0, 0], v: [0, 7.7, 0] };
      if (w.pushEvent) w.pushEvent('SCEN', '停泊轨道面已对准月球（RAAN = ' +
        (bestST ? (bestST.raan * M.R2D).toFixed(1) : '?') + '°，预计 TLI Δv = ' +
        (bestST && bestST.dv !== null ? bestST.dv.toFixed(3) : '待窗口求解') + ' km/s）');
      var mods = P.buildSaturnVStack().filter(function (m) {
        return m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA';
      });
      c = new P.Craft({ id: 'CSM', name: 'Columbia', r: st.r, v: st.v, modules: mods, mode: 'prograde' });
      c.stageIndex = 2;
      w.addCraft(c);
      // 任务时钟按 TLI 窗口对齐
      var site2 = A.siteState(w.t, APL.SITE.lat, APL.SITE.lon, 0);
    } else if (mission.startState === 'lunar_orbit' || mission.startState === 'lunar_orbit_low') {
      w.t = SCENARIO_T[id] || 360000;
      // 关键：轨道面必须"包含着陆点"，否则飞行器会从着陆点旁边几十公里
      // 掠过，横向速度几百 m/s，动力下降段根本追不回来。
      // P.orbitOverSite 会把飞行器放在着陆点正对面、且轨道面精确通过着陆点，
      // 绕半圈后正好从静海基地上空经过（真实任务同样要选这个窗口）。
      var orb = P.orbitOverSite(w, 111);
      var pos = orb.r, vel = orb.v;
      if (mission.startState === 'lunar_orbit_low') {
        // 只保留登月舱
        var lmMods = P.buildSaturnVStack().filter(function (m) { return m.group === 'LM'; });
        c = new P.Craft({ id: 'LM', name: 'Eagle', r: pos, v: vel, modules: lmMods, mode: 'prograde' });
        c.stageIndex = 3;
        c.primary = 'MOON';
        c.flags.isLM = true;
        w.addCraft(c);
      } else {
        // CSM + LM 已对接
        var mods2 = P.buildSaturnVStack().filter(function (m) {
          return m.id === 'LM_D' || m.id === 'LM_A' || m.id === 'SM' || m.id === 'CM';
        });
        c = new P.Craft({ id: 'CSM', name: 'Columbia', r: pos, v: vel, modules: mods2, mode: 'prograde' });
        c.stageIndex = 5;
        c.primary = 'MOON';
        w.addCraft(c);
      }
    }
    w.mission = mission;
    return { world: w, craft: c };
  }

  // ============================================================ 初始化
  App.init = function () {
    App.renderer = new APL.Renderer($('sky'));
    App.renderer.resize();
    window.addEventListener('resize', function () { App.renderer.resize(); });
    bindUI();
    initAGC();
    showMissionPicker();
    requestAnimationFrame(loop);
  };

  // ============================================================ 任务选择
  function showMissionPicker() {
    var box = $('missionList');
    box.innerHTML = '';
    APL.MISSIONS.forEach(function (m) {
      var card = el('div', 'mcard');
      card.dataset.mid = m.id;
      card.appendChild(el('div', 'mcode', m.code));
      card.appendChild(el('div', 'mname', APL.missionText(m, 'name')));
      card.appendChild(el('div', 'msub', APL.missionText(m, 'subtitle')));
      card.appendChild(el('div', 'mbrief', APL.missionText(m, 'brief')));
      var ul = el('ul', 'mneed');
      (APL.missionText(m, 'need') || []).forEach(function (n) { ul.appendChild(el('li', null, n)); });
      card.appendChild(ul);
      var btn = el('button', 'primary', TT('mis.start'));
      btn.onclick = function () { startMission(m.id); };
      card.appendChild(btn);
      // 【开始任务】下面：自动演示
      var btnD = el('button', 'demo', TT('mis.demo'));
      // 轨迹清单（traj/manifest.json）里没有这个任务 → 直接置灰并写明原因：
      // 免得玩家点了才在飞行日志里看到一行红色 404。手动飞行仍然可用。
      var trajReady = !(APL.Replay && APL.Replay.isAvailable && !APL.Replay.isAvailable(m.id));
      if (!trajReady) {
        btnD.disabled = true;
        btnD.textContent = TT('mis.demoNA');
        btnD.title = TT('mis.demoNATip');
      }
      btnD.onclick = function () {
        if (!trajReady) {
          logLine('sys', TT('mis.demoNATip'));
          return;
        }
        startMission(m.id);
        // 自动演示 = 离线轨迹回放（固定样本；不实时求解制导）
        if (APL.Replay) APL.Replay.start(m.id);
        else if (APL.Demo) APL.Demo.start(m.id);
      };
      card.appendChild(btnD);
      card.appendChild(el('div', 'demotip', TT('mis.demoTip')));
      box.appendChild(card);
    });
    $('modalMissions').classList.add('show');
  }
  function hidePicker() { $('modalMissions').classList.remove('show'); }

  App.startMission = startMission;
  App.showMissionPicker = showMissionPicker;
  App.updateAgcRunBtn = updateAgcRunBtn;
  // 以下接口是「自动演示」（11-demo.js）和外部调试用的。
  // 之前没导出，导致演示里 app().execTLI() / undockLM() / dockCraft() 全部静默失效
  // —— TLI 不点火、登月舱不分离，演示看着在走流程其实什么都没做。
  App.execTLI = execTLI;
  App.setWarpValue = setWarpValue;   // 演示引擎按真实数值设倍率（顺带同步档位索引）
  App.stepWarp = stepWarp;           // 「+/−」= 相对当前倍率走一档
  App.runCalculator = runCalculator;
  App.undockLM = undockLM;
  App.dockCraft = dockCraft;
  App.stageNow = stageNow;
  App.switchCraft = switchCraft;
  App.logLine = logLine;
  App.finishMission = finishMission;
  App.updatePrediction = updatePrediction;   // 供无头测试/外部驱动
  App.renderGuide = renderGuide;             // 制导手册重绘（语言切换/自检用）
  function startMission(id) {
    // 换任务时如果自动演示还在跑，先把它停掉 —— 否则演示会拿着上一条
    // 任务的脚本去飞新任务的飞行器。
    if (APL.Demo && APL.Demo.isActive()) APL.Demo.stop('manual');
    // 回放（含还在加载中的）也必须一起取消：否则 mode 仍是 replay、
    // driverExternal 仍是 true，主循环不推进物理，旧回放会一直往新任务里写状态。
    if (APL.Replay && APL.Replay.state && APL.Replay.state.abort) {
      var rpS = APL.Replay.state;
      if (rpS.active || rpS.loading || App.mode === 'replay' || App.driverExternal) rpS.abort();
    }
    var sc = buildScenario(id);
    App.world = sc.world;
    App.craft = sc.craft;
    App.mission = sc.world.mission;
    App.objectives = {};
    App.logs = [];
    App.descent = { on: false };        // 换任务时清掉上一关的制导开关
    App.rendezvous = { on: false };
    PRED.state = null; PRED.pts = [];
    App.lm = null;
    hidePicker();
    $('missionTitle').textContent = App.mission.code + ' · ' + APL.missionText(App.mission, 'name');
    $('missionSub').textContent = APL.missionText(App.mission, 'brief');
    // 重载 AGC
    initAGC();
    logLine('sys', L('任务开始：', 'Mission start: ') + APL.missionText(App.mission, 'name')
      + L('（', ' (') + APL.missionText(App.mission, 'subtitle') + L('）', ')'));
    APL.Tutorial && APL.Tutorial.notify('mission_started');
    // 有限推力点火的日志钩子：把"真实"的燃烧时间 / 推进剂 / 重力损耗写进飞行日志
    App.world.onBurnStart = function (cr, b) {
      if (cr !== App.craft) return;
      logLine('sys', L('点火开始：' + burnName(b.label) + '（有限推力，需 Δv '
        + (b.dvIdeal * 1000).toFixed(0) + ' m/s）',
        'Burn start: ' + burnName(b.label) + ' (finite thrust, dv '
        + (b.dvIdeal * 1000).toFixed(0) + ' m/s)'));
    };
    App.world.onBurnEnd = function (cr, b) {
      if (cr !== App.craft) return;
      var ok = (b.reason === 'reached');
      var nm = burnName(b.label);
      logLine(ok ? 'ok' : 'bad', L(
        nm + ' 点火结束：燃烧 ' + b.t.toFixed(0) + ' s，耗推进剂 '
          + ((b.propUsed || 0) / 1000).toFixed(2) + ' t，发动机累计 Δv = '
          + (b.dvEngine * 1000).toFixed(0) + ' m/s（理想 '
          + (b.dvIdeal * 1000).toFixed(0) + ' m/s，差值是重力损耗）',
        nm + ' burn ended: ' + b.t.toFixed(0) + ' s, propellant '
          + ((b.propUsed || 0) / 1000).toFixed(2) + ' t, engine dv '
          + (b.dvEngine * 1000).toFixed(0) + ' m/s (ideal '
          + (b.dvIdeal * 1000).toFixed(0) + ' m/s; the difference is gravity loss)'));
      if (b.label === 'TLI' && ok) {
        App.objectives.tli = true;
        APL.Tutorial && APL.Tutorial.notify('tli_done');
      }
    };
    App.world.running = true;
    App.paused = true;
    setWarp(0);
    refreshAll();
    updateButtons();
    document.querySelectorAll('.mbtn').forEach(function (x) {
      x.classList.toggle('on', x.dataset.mode === App.craft.attitude.mode);
    });
  }

  // ============================================================ AGC
  function initAGC() {
    App.agc = new APL.AGC();
    App.agc.standby = false;
    App.agcProg = null;
    // AGC 与飞船的桥：通道 030o 节流阀, 031o..033o 姿态模式, 034o 点火
    App.agc.hook.writeChannel = function (ch, v, agc) {
      if (!App.craft) return;
      if (ch === 0o30) {                       // 指令油门（0-1，按 0..16384 归一）
        var t = Math.max(0, Math.min(1, APL.AGCUtil.wordToNum(v) / 16384));
        App.craft.throttleCmd = t;
      } else if (ch === 0o31) {                // 姿态模式
        var modes = ['prograde', 'retrograde', 'radial', 'antiradial', 'normal', 'antinormal', 'hold'];
        var mi = APL.AGCUtil.wordToNum(v) | 0;
        if (modes[mi]) App.craft.attitude.mode = modes[mi];
      } else if (ch === 0o32) {                // 分级
        if (APL.AGCUtil.wordToNum(v) !== 0) stageNow();
      }
    };
    renderDSKY();
    $('agcState').textContent = TT('dsky.agcReady');
  }

  // AGC 运行/暂停按钮的文案（随语言与状态一起更新）
  function updateAgcRunBtn() {
    var el = document.getElementById('btnAgcRun');
    if (!el) return;
    el.textContent = App.agcPaused ? ('\u25b6 ' + L('运行', 'Run'))
      : ('\u23f8 ' + L('暂停', 'Pause'));
  }

  function renderDSKY() {
    var d = App.agc.dsky.display();
    $('dProg').textContent = d.prog;
    $('dVerb').textContent = d.verb;
    $('dNoun').textContent = d.noun;
    $('dR1').textContent = d.r1;
    $('dR2').textContent = d.r2;
    $('dR3').textContent = d.r3;
    var lampBox = $('dLamps');
    if (lampBox.children.length !== APL.AGCUtil.LAMP_BITS.length) {
      lampBox.innerHTML = '';
      APL.AGCUtil.LAMP_BITS.forEach(function (lb) {
        var s = el('span', 'lamp', lb[0]);
        s.dataset.lamp = lb[0];
        lampBox.appendChild(s);
      });
    }
    for (var i = 0; i < lampBox.children.length; i++) {
      var n = lampBox.children[i].dataset.lamp;
      lampBox.children[i].classList.toggle('on', !!d.lamps[n]);
    }
  }

  function agcTick(budget) {
    if (!App.agc) return;
    if (App.agcPaused) return;
    var n = App.agc.run(budget);
    if (App.agc.recent.length) $('agcTrace').textContent = App.agc.recent.slice(-14).join('\n');
    $('agcCount').textContent = App.agc.instructions.toLocaleString();
    $('agcCycles').textContent = App.agc.cycles.toLocaleString();
    renderDSKY();
  }

  // ============================================================ 轨道预演
  // 用与仿真完全一致的引力（地球 μ+J2、月球 μ+J2、太阳）做 RK4 外推。
  // 一段轨迹几百步 × 每步 4 次引力求值，一帧算不完 —— 分帧计算：
  // 每帧推进一小块，烧火/状态变化/1.5 秒后自动重算。
  var PRED = {
    state: null, pts: [], t0: 0, dt: 60, total: 0, r0: null, age: 0
  };
  function updatePrediction() {
    var w = App.world, c = App.craft;
    if (!w || !c) { if (w) w.predTraj = null; return; }
    if (!w.showPrediction || c.crashed || c.landed) { w.predTraj = null; return; }
    PRED.age++;
    // 重算条件：点火（轨道马上要变）/ 沿轨迹走掉 35% / 10 秒没刷新。
    // 之前用「位置变了 1%」做判据，在高倍率下每几帧就重置一次，
    // 轨迹永远只画出一小段 —— 预演等于没用。
    var span = (PRED.pts.length > 1)
      ? V.dist(PRED.pts[PRED.pts.length - 1].r, PRED.pts[0].r) : Math.max(1, V.mag(c.r) * 0.5);
    var moved = PRED.r0 && V.dist(c.r, PRED.r0) > Math.max(60, span * 0.35);
    if (!PRED.state || c.throttle > 0 || moved || PRED.age > 600) {
      PRED.state = { r: c.r.slice(), v: c.v.slice(), t: w.t };
      PRED.pts = [];
      PRED.t0 = w.t;
      PRED.r0 = c.r.slice();
      PRED.age = 0;
      var mu = c.primary === 'MOON' ? B.MOON.mu : B.EARTH.mu;
      var o = c.orbitRelative(c.primary, w);
      var T = (isFinite(o.a) && o.a > 0) ? 2 * Math.PI * Math.sqrt(o.a * o.a * o.a / mu) : 5400;
      PRED.dt = V.clamp(T / 300, 1, 900);
      PRED.total = Math.min(700, Math.ceil(2.2 * T / PRED.dt));
    }
    if (PRED.pts.length < PRED.total) {
      var n2 = Math.min(16, PRED.total - PRED.pts.length);
      var res = w.predict(c, n2, PRED.dt, PRED.state);
      PRED.pts = PRED.pts.concat(res.pts);
      PRED.state = res.state;
    }
    w.predTraj = { pts: PRED.pts, t0: PRED.t0, dt: PRED.dt };
  }

  // ============================================================ 主循环
  function loop(ts) {
    var dt = App.lastFrame ? Math.min((ts - App.lastFrame) / 1000, 0.08) : 0.016;
    App.lastFrame = ts;
    App.fps = App.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;

    if (!App.driverExternal) descentGuidance();
    if (App.world) {
      var simDt = 0;
      if (!App.paused && !App.driverExternal) {
        var before = App.world.t;
        App.world.advance(dt);
        simDt = App.world.t - before;
        checkMilestones(before, App.world.t);
      }
      if (!App.driverExternal && APL.Demo && APL.Demo.isActive()) {
        APL.Demo.tick(simDt > 0 ? simDt : dt);
      }
      // 回放模式：只按样本时间插值（不积分、不制导、不耗推进剂）
      if (App.mode === 'replay' && APL.Replay) APL.Replay.tick(dt);
      if (App.mode !== 'replay') updatePrediction();
      App.renderer.draw(App.world, App.craft);
      refreshPanels();
      checkOrbitReached();
    }
    agcTick(14000);
    updateTopBar();
    if (!App.world && App.renderer) App.renderer.drawIdle();
    if (App.frameSkip === undefined) App.frameSkip = 0;
    if ((App.frameSkip++ % 15) === 0) markTimeline();
    requestAnimationFrame(loop);
  }

  // ============================================================ 里程碑 / 事件
  function checkMilestones(t0, t1) {
    var w = App.world;
    for (var i = 0; i < APL.TIMELINE.length; i++) {
      var ev = APL.TIMELINE[i];
      if (ev.t > t0 && ev.t <= t1 && !w.milestones[ev.tag]) {
        w.milestones[ev.tag] = true;
        logLine('t', 'T' + M.fmtMet(ev.t) + '  ' + APL.tlText(ev, 'name')
          + ' — ' + APL.tlText(ev, 'detail'));
      }
    }
    // 事件队列
    while (w.events.length) {
      var e = w.events.shift();
      logLine('e', 'T' + M.fmtMet(e.t) + '  ' + localEvent(e.tag, e.text));
      evaluateObjectives(e.tag);
    }
    // 任务结束判定
    if (App.mission && t1 > App.mission.getEnd + 600) {
      logLine('sys', L('任务时段结束，进行成绩评定。',
        'Mission window over - computing the debrief.'));
      finishMission();
    }
  }

  // 飞行事件的英文说明（模拟器自身产生的事件）
  var EVENT_EN = {
    'SOI_MOON': 'Entered the Moon\'s sphere of influence (SOI 66,183 km)',
    'SOI_EARTH': 'Left the Moon\'s sphere of influence',
    'GUID': 'Ascent guidance hand-over: insertion phase',
    'CUTOFF': 'Guidance cutoff: target orbit reached',
    'TOUCHDOWN': 'Lunar touchdown',
    'SPLASHDOWN': 'Splashdown'
  };
  function localEvent(tag, text) {
    if (APL.getLang() !== 'en') return text;
    if (EVENT_EN[tag]) return EVENT_EN[tag];
    if (tag === 'CRASH') return 'Impact with the surface - ' + text.replace(/^.*?([\d.]+) m\/s.*$/, 'closing speed $1 m/s');
    if (tag === 'STAGE') {
      var ids = text.replace(/^[^:：]*[:：]\s*/, '');
      return 'Staging - jettisoned ' + ids;
    }
    return text;
  }

  function evaluateObjectives(tag) {
    var o = App.objectives, c = App.craft;
    if (!c) return;
    if (tag === 'SOI_MOON') logLine('ok', L('✔ 已进入月球引力影响球',
      '✔ Entered the Moon\'s sphere of influence'));
    if (tag === 'TOUCHDOWN' && c.primary === 'MOON') {
      o.landing = true;
      logLine('ok', L('✔ 月面着陆成功', '✔ Successful lunar landing'));
      APL.Tutorial && APL.Tutorial.notify('landing_done');
    }
    if (tag === 'SPLASHDOWN') {
      o.splashdown = true;
      logLine('ok', L('✔ 溅落回收', '✔ Splashdown and recovery'));
    }
    if (tag === 'CRASH') logLine('bad', '✘ ' + (APL.getLang() === 'en'
      ? 'Impact with the surface' : App.world.lastEventText));
  }

  // 入轨判定：近地点高于 150 km 且远地点低于 300 km 视为稳定停泊轨道
  function checkOrbitReached() {
    var c = App.craft;
    if (!c || c.primary !== 'EARTH' || App.objectives._orbitNotified) return;
    var orb = c.orbitRelative('EARTH', App.world);
    var per = orb.periapsis - B.EARTH.radius, apo = orb.apoapsis - B.EARTH.radius;
    if (per > 150 && apo < 300 && orb.e < 0.02) {
      App.objectives._orbitNotified = true;
      logLine('ok', L('✔ 已进入稳定的地球停泊轨道',
        '✔ Stable Earth parking orbit achieved'));
      APL.Tutorial && APL.Tutorial.notify('orbit_reached');
    }
  }

  function finishMission() {
    App.paused = true;
    var o = App.objectives, m = App.mission, c = App.craft;
    var orb = c.orbitRelative(c.primary, App.world);
    var lines = [];
    var pass = 0, total = m.objectives.length;
    function add(name, ok, detail) {
      lines.push((ok ? '✔ ' : '✘ ') + name + (detail ? '  — ' + detail : ''));
      if (ok) pass++;
    }
    m.objectives.forEach(function (ob) {
      if (ob === 'orbit') {
        var apo = orb.apoapsis - B.EARTH.radius, per = orb.periapsis - B.EARTH.radius;
        add(TT('st.earthOrbit'), c.primary === 'EARTH' && per > 150 && apo < 300 && orb.e < 0.02,
          L('远地点 ', 'apoapsis ') + km(apo) + L(' km / 近地点 ', ' km / periapsis ') + km(per) + ' km');
      } else if (ob === 'tli') {
        add(TT('st.tli'), orb.apoapsis > 350000 || App.objectives.soiMoon || c.primary === 'MOON',
          L('远地点 ', 'apoapsis ') + km(orb.apoapsis) + ' km');
      } else if (ob === 'loi') {
        add(TT('st.loi'), c.primary === 'MOON', '');
      } else if (ob === 'undock') {
        add(TT('st.undock'), !!App.objectives.undock, '');
      } else if (ob === 'rendezvous') {
        add(TT('st.rendezvous'), !!App.objectives.rendezvous, '');
      } else if (ob === 'dock') {
        add(TT('st.dock'), !!App.objectives.dock, '');
      } else if (ob === 'landing') {
        add(TT('st.landing'), !!App.objectives.landing, '');
      } else if (ob === 'tei') {
        add(TT('st.tei'), !!App.objectives.tei, '');
      } else if (ob === 'splashdown') {
        add(TT('st.splashdown'), !!App.objectives.splashdown, '');
      }
    });
    $('resultBody').innerHTML =
      '<div class="rsum">' + TT('res.summary',
        { p: pass, t: total, time: M.fmtTime(App.world.t) }) + '</div>' +
      '<pre class="rlines">' + lines.join('\n') + '</pre>';
    $('modalResult').classList.add('show');
  }

  // ============================================================ 日志
  function logLine(kind, text) {
    App.logs.push({ t: App.world ? App.world.t : 0, kind: kind, text: text });
    if (App.logs.length > App.maxLog) App.logs.shift();
    var box = $('logBox');
    var d = el('div', 'lg lg-' + kind, text);
    box.appendChild(d);
    while (box.children.length > App.maxLog) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ============================================================ 顶栏
  function updateTopBar() {
    if (!App.world) return;
    $('met').textContent = M.fmtMet(App.world.t);
    var jd = A.jdFromT(App.world.t);
    var utcSec = (jd - Math.floor(jd - 0.5) - 0.5) * 86400;
    var h = Math.floor(utcSec / 3600), mi = Math.floor((utcSec % 3600) / 60), s = Math.floor(utcSec % 60);
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    $('utc').textContent = '1969-07-' + (App.world.t < 259200 ? '16' : (App.world.t < 432000 ? '20' : '22')) +
      ' ' + p(h) + ':' + p(mi) + ':' + p(s) + ' UTC';
    $('warpTxt').textContent = '×' + App.world.warp;
    $('fpsTxt').textContent = App.fps.toFixed(0) + ' fps  (' + App.world.stepsLastFrame
      + L(' 步/帧', ' steps/frame') + ')';
  }

  // ============================================================ 面板刷新
  function refreshPanels() {
    var c = App.craft; if (!c) return;
    var w = App.world;
    var isMoon = c.primary === 'MOON';
    var center = w.primaryPos(c.primary), vc = w.primaryVel(c.primary);
    var rel = V.sub(c.r, center), vrel = V.sub(c.v, vc);
    var alt = isMoon ? (V.mag(rel) - B.MOON.radius) : P.earthAltitude(c.r);
    var spd = V.mag(vrel);
    var up = V.unit(rel);
    var vr = V.dot(vrel, up);
    var vh = Math.sqrt(Math.max(spd * spd - vr * vr, 0));
    var orb = c.orbitRelative(c.primary, w);
    var mu = isMoon ? B.MOON.mu : B.EARTH.mu;
    var body = isMoon ? B.MOON : B.EARTH;

    $('tAlt').textContent = num(alt, 2) + ' km';
    $('tSpeed').textContent = spd.toFixed(4) + ' km/s';
    $('tVr').textContent = (vr * 1000).toFixed(1) + ' m/s';
    $('tVh').textContent = vh.toFixed(4) + ' km/s';
    $('tApo').textContent = km(orb.apoapsis - body.radius) + ' km';
    $('tPer').textContent = km(orb.periapsis - body.radius) + ' km';
    $('tEcc').textContent = orb.e.toFixed(5);
    $('tInc').textContent = (orb.i * M.R2D).toFixed(3) + '°';
    $('tPeriod').textContent = isFinite(orb.period) ? M.fmtTime(orb.period) : '—';
    $('tPrimary').textContent = isMoon ? TT('body.moon') : TT('body.earth');
    $('tMass').textContent = (c.mass() / 1000).toFixed(2) + ' t';
    $('tThrust').textContent = (c.currentThrust() / 1000).toFixed(1) + ' kN';
    $('tAccel').textContent = c.thrustAccel.toFixed(2) + ' m/s²  (' + c.gLoad.toFixed(2) + ' g)';
    $('tDv').textContent = c.dvUsed.toFixed(3) + ' km/s';
    $('tPhase').textContent = fpAngle(rel, vrel);
    $('tFpa').textContent = (Math.atan2(vr, vh) * M.R2D).toFixed(2) + '°';

    // 距离月球
    var ms = A.moonState(w.t);
    $('tMoonDist').textContent = km(V.dist(c.r, ms.r)) + ' km';
    $('tMoonPhase').textContent = (A.moonPhase(w.t).illum * 100).toFixed(1) + '%';
    $('tSunElev').textContent = A.lunarSunElevation(w.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon).toFixed(2) + '°';
    $('tSiteDist').textContent = km(distToSite(c, w)) + ' km';

    // 推进级
    renderStages(c);

    // 燃料条
    var m0 = c.activeModule();
    $('thrLabel').textContent = m0
      ? (modName(m0.module) + ' · ' + (c.throttleCmd * 100).toFixed(0) + '%')
      : L('无可用发动机', 'No engine available');
    var modeKey = { prograde: 'mode.prograde', retrograde: 'mode.retrograde', radial: 'mode.radial',
      antiradial: 'mode.antiradial', normal: 'mode.normal', antinormal: 'mode.antinormal',
      launch: 'mode.launch', vgo: 'mode.vgo', hold: 'mode.hold' }[c.attitude.mode];
    $('modeLabel').textContent = modeKey ? TT(modeKey) : c.attitude.mode;
  }

  function fpAngle(rel, vrel) {
    var up = V.unit(rel);
    var vr = V.dot(vrel, up);
    var vh = Math.sqrt(Math.max(V.mag2(vrel) - vr * vr, 0));
    return (Math.atan2(vr, vh) * M.R2D).toFixed(2) + '°';
  }
  function distToSite(c, w) {
    if (c.primary !== 'MOON') return V.dist(c.r, A.moonState(w.t).r) - B.MOON.radius + 1737;
    var sp = A.moonSurfacePoint(w.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
    return V.dist(c.r, sp.r);
  }

  function renderStages(c) {
    var box = $('stageList');
    var sig = c.modules.map(function (m) { return m.id + ':' + (m.prop / 1000).toFixed(1); }).join('|');
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = '';
      c.modules.forEach(function (m) {
        var d = el('div', 'stg' + (Math.abs(m.stage - c.stageIndex) < 1e-9 ? ' active' : ''));
        d.appendChild(el('span', 'sid', m.id));
        d.appendChild(el('span', 'sname', modName(m)));
        var bar = el('div', 'sbar');
        var fill = el('div', 'sfill');
        var pct = m.propMax > 0 ? (m.prop / m.propMax * 100) : 0;
        fill.style.width = pct.toFixed(1) + '%';
        bar.appendChild(fill);
        d.appendChild(bar);
        d.appendChild(el('span', 'snum', m.propMax > 0 ? (m.prop / 1000).toFixed(1) + ' t' : (m.dry / 1000).toFixed(1) + ' t'));
        box.appendChild(d);
      });
    }
  }

  // ============================================================ 轨道计算器
  function runCalculator() {
    var c = App.craft, w = App.world;
    if (!c) return;
    var rel = V.sub(c.r, w.primaryPos('EARTH'));
    var vrel = V.sub(c.v, w.primaryVel('EARTH'));
    var out = $('calcOut');
    var lines = [];
    var orb = M.elements(B.EARTH.mu, rel, vrel);
    APL.Tutorial && APL.Tutorial.notify('calc_used');
    lines.length = 0;
    lines.push(L('【当前地球轨道】', '[Current Earth orbit]'));
    lines.push(L('  半长轴 a = ', '  Semi-major axis a = ') + num(orb.a, 1) + ' km');
    lines.push(L('  偏心率 e = ', '  Eccentricity e = ') + orb.e.toFixed(6));
    lines.push(L('  倾角 i = ', '  Inclination i = ') + (orb.i * M.R2D).toFixed(3) + '°');
    lines.push(L('  近地点高度 = ', '  Periapsis altitude = ') + km(orb.periapsis - B.EARTH.radius) + ' km');
    lines.push(L('  远地点高度 = ', '  Apoapsis altitude = ') + km(orb.apoapsis - B.EARTH.radius) + ' km');
    lines.push(L('  周期 T = ', '  Period T = ') + (isFinite(orb.period) ? M.fmtTime(orb.period) : '—'));
    lines.push(L('  速度 = ', '  Speed = ') + num(orb.vmag, 4) + ' km/s');
    lines.push(L('  速度增量余量 = ', '  Remaining delta-v = ') + num(c.remainingDeltaV(), 3) + ' km/s');
    var ms = A.moonState(w.t);
    lines.push('');
    lines.push('');
    lines.push(L('【地月几何 / 月球历表】', '[Earth-Moon geometry / lunar ephemeris]'));
    lines.push(L('  月心距 = ', '  Earth-Moon distance = ') + num(V.mag(ms.r), 0)
      + L(' km （平均 384 400 km）', ' km (mean 384,400 km)'));
    lines.push(L('  月黄经 = ', '  Lunar ecliptic longitude = ') + A.moonEcliptic(w.t).lon.toFixed(3) + '°');
    lines.push(L('  月黄纬 = ', '  Lunar ecliptic latitude = ') + A.moonEcliptic(w.t).lat.toFixed(3) + '°');
    lines.push(L('  月相照度 = ', '  Moon illumination = ') + (A.moonPhase(w.t).illum * 100).toFixed(1) + '%');
    lines.push(L('  天平动 = ', '  Libration in longitude = ') + A.moonFrame(w.t).libration.toFixed(3) + '°');
    lines.push(L('  静海基地太阳高度角 = ', '  Sun elevation at Tranquility Base = ') +
      A.lunarSunElevation(w.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon).toFixed(2) + '°');
    lines.push('');
    lines.push(L('【霍曼式估算（到月球轨道半径）】', '[Hohmann-style estimate to lunar radius]'));
    var hm = M.hohmann(B.EARTH.mu, V.mag(rel), V.mag(ms.r));
    lines.push(L('  转移轨道半长轴 = ', '  Transfer semi-major axis = ') + num(hm.aTransfer, 0) + ' km');
    lines.push(L('  第一次点火 Δv = ', '  First burn dv = ') + num(hm.dv1, 4) + ' km/s');
    lines.push(L('  到达时 Δv = ', '  Arrival dv = ') + num(hm.dv2, 4) + ' km/s');
    lines.push(L('  合计 Δv ≈ ', '  Total dv ≈ ') + num(hm.dvTotal, 4) + ' km/s');
    lines.push(L('  转移时间 ≈ ', '  Transfer time ≈ ') + M.fmtTime(hm.tof)
      + L(' （真实 TLI 约 3 天）', ' (the real TLI took about 3 days)'));
    lines.push(L('  说明：真实 TLI 采用自由返回轨道，Δv ≈ 3.05 km/s',
      '  Note: the real TLI used a free-return trajectory, dv 3.05 km/s'));

    // 兰伯特：求到「t+tof 时刻月球位置」的转移
    var tof = parseFloat($('calcTof').value) * 3600;
    if (tof > 0) {
      var target = A.moonState(w.t + tof).r;
      var Lb = M.lambert(B.EARTH.mu, rel, target, tof, true);
      lines.push('');
      lines.push(L('【兰伯特转移求解 → 月球 ' + (tof / 3600).toFixed(1) + ' 小时后位置】',
        '[Lambert solution to the Moon\'s position in ' + (tof / 3600).toFixed(1) + ' hours]'));
      if (!Lb) {
        lines.push(L('  无单圈解（可调整飞行时间）',
          '  No single-revolution solution (try a different transfer time)'));
      } else {
        var dv1 = V.sub(Lb.v1, vrel);
        lines.push(L('  转移速度 v1 = ', '  Transfer velocity v1 = ') + num(V.mag(Lb.v1), 4) + ' km/s');
        lines.push(L('  所需点火 Δv = ', '  Required burn dv = ') + num(V.mag(dv1), 4) + ' km/s');
        lines.push(L('  剩余速度增量 = ', '  Remaining delta-v = ') + num(c.remainingDeltaV(), 4) + ' km/s');
        var st1 = M.elements(B.EARTH.mu, rel, Lb.v1);
        lines.push(L('  转移轨道远地点 = ', '  Transfer apoapsis = ') + km(st1.apoapsis) + ' km');
        lines.push(L('  到达时月心距 = ', '  Distance to Moon on arrival = ')
          + num(V.dist(M.propagate(B.EARTH.mu, rel, Lb.v1, tof).r, target), 1)
          + L(' km（应≈0）', ' km (should be ~0)'));
        lines.push(L('  判据：', '  Verdict: ') + (V.mag(dv1) <= c.remainingDeltaV()
          ? L('✅ 速度增量充足', 'OK - enough delta-v')
          : L('⚠️ 速度增量不足', 'WARNING - not enough delta-v')));
        lines.push(L('  提示：点击「执行 TLI 点火」按此解自动点火。',
          '  Tip: click "Execute TLI burn" to apply this solution.'));
        App.pendingTLI = { dv: V.mag(dv1), dir: V.unit(dv1), tof: tof };
      }
    }
    // 转移窗口提示：停泊轨道相位不对时 Δv 会大得离谱（能到 11 km/s），
    // 真实 Apollo 会在轨道上等到相位对齐（约 2.5 圈）再点火。
    var elC = M.elements(B.EARTH.mu, rel, vrel);
    if (isFinite(elC.a) && elC.a > 0) {
      var perC = 2 * Math.PI * Math.sqrt(elC.a * elC.a * elC.a / B.EARTH.mu);
      var bw = null;
      // 连续扫描：相位（不是整圈）才是关键，步长取 1/20 个轨道周期
      for (var kk = 0; kk <= 60; kk++) {
        var wp = kk * perC / 20;
        var s1 = M.propagate(B.EARTH.mu, rel, vrel, wp);
        for (var ti = 0; ti < 5; ti++) {
          var tf = (64 + ti * 4) * 3600;
          var tg2 = A.moonState(w.t + wp + tf).r;
          var Lb2 = M.lambert(B.EARTH.mu, s1.r, tg2, tf, true);
          if (!Lb2) continue;
          var d2 = V.mag(V.sub(Lb2.v1, s1.v));
          if (!bw || d2 < bw.dv) bw = { dv: d2, wait: wp, tof: tf, k: kk };
        }
      }
      lines.push('');
      lines.push(L('【最佳转移窗口】', '[Best transfer window]'));
      if (bw) {
        lines.push(L('  再在停泊轨道滑行 ' + (bw.wait / 60).toFixed(1) + ' 分钟（约 ' +
          (bw.k / 20).toFixed(1) + ' 圈）点火，Δv 最小 ≈ ', '  Coast another ' + (bw.wait / 60).toFixed(1) +
          ' min (about ' + (bw.k / 20).toFixed(1) + ' orbits) then burn: min dv = ') + num(bw.dv, 4) + ' km/s');
        lines.push(L('  说明：相位不对就点火会白白多烧好几倍的推进剂（真实 TLI ≈ 3.05 km/s）。',
          '  Note: burning at the wrong phase wastes several times the propellant (the real TLI was about 3.05 km/s).'));
      } else {
        lines.push(L('  未找到可用窗口', '  No usable window found'));
      }
    }
    out.textContent = lines.join('\n');
  }

  // ============================================================ 控制
  function stageNow() {
    var c = App.craft; if (!c) return;
    var dumped = c.stageUp();
    if (dumped.length) logLine('sys', L('手动分级：抛离 ', 'Manual staging: jettisoned ')
      + dumped.join(' + '));
    else logLine('sys', L('分级：无可抛离的级（或已分离）',
      'Staging: nothing to jettison (or already separated)'));
    APL.Tutorial && APL.Tutorial.notify('stage_done');
    c.stageIndex = c.stageIndex;
    updateButtons();
  }

  function undockLM() {
    var c = App.craft; if (!c) return;
    if (App.lm) { logLine('sys', L('登月舱已分离。', 'The LM is already separated.')); return; }
    var lm = c.undock('LM');
    if (!lm) { logLine('bad', L('无法分离：未找到登月舱模块',
      'Cannot undock: no Lunar Module attached')); return; }
    App.lm = lm;
    App.world.addCraft(lm);
    App.objectives.undock = true;
    // 给一点分离速度
    lm.v = V.add(lm.v, V.mul(V.unit(lm.attitude.vec || [1, 0, 0]), 0.0008));
    logLine('ok', L('✔ 登月舱 Eagle 与 Columbia 分离',
      '✔ Lunar Module Eagle has separated from Columbia'));
    APL.Tutorial && APL.Tutorial.notify('undock_done');
    updateButtons();
  }

  // 交换当前操控的飞行器（分离后要改开登月舱时用）。
  // 交换后 App.craft 是"我在开的"，App.lm 是"目标"，UI 语义保持一致。
  function switchCraft() {
    if (!App.lm) { logLine('bad', L('没有可切换的飞行器', 'No other vehicle to switch to')); return false; }
    var t = App.craft;
    App.craft = App.lm;
    App.lm = t;
    App.craft.attitude.mode = 'prograde';
    App.craft.throttleCmd = 0;
    logLine('sys', L('已切换到 ', 'Now controlling ') + App.craft.id +
      L('（另一台为 ', ' (the other vehicle is ') + App.lm.id + '）');
    try { App.renderer && App.renderer.draw(App.world, App.craft); } catch (e) {}
    updateButtons();
    return true;
  }

  function dockCraft() {
    // ⚠ 对接**永远以指令舱为主飞行器**。
    //   原来的代码写死了 `var c = App.craft`，而演示里"接手登月舱 Eagle"用过
    //   switchCraft()，它会把 App.craft / App.lm **对调** —— 于是走到这里时
    //   App.craft 其实是登月舱，代码就把指令舱的模块并进了登月舱，并把它从
    //   world.crafts 里删掉。后果：此后"当前飞行器"是登月舱（模块里虽然带着
    //   SM，id/质量/状态全是登月舱的），TEI 那一整段都打在错误的飞行器上；
    //   实测 TEI 自检打印出「阶段 4，发动机 LM_A 15570N，质量 4908 kg」，
    //   然后 997 m/s 的脉冲打在登月舱上，飞船直接崩掉。
    //   真实任务里对接之后是 CSM 带着 LM 走，不可能是反过来。
    if (!App.lm || App.lm.crashed) { logLine('bad', L('没有可对接的登月舱',
      'No Lunar Module available to dock with')); return false; }
    function hasCSM(x) {
      return !!x && x.modules.some(function (m) { return m.id === 'SM' || m.id === 'CM'; });
    }
    var primary = hasCSM(App.craft) ? App.craft : (hasCSM(App.lm) ? App.lm : App.craft);
    var other = (primary === App.craft) ? App.lm : App.craft;
    var d = V.dist(primary.r, other.r);
    var rv = V.mag(V.sub(primary.v, other.v));
    if (d > 0.2) { logLine('bad', L('距离 ', 'Range ') + (d * 1000).toFixed(0)
      + L(' m，太远无法对接（需 ≤ 200 m）', ' m - too far to dock (must be <= 200 m)')); return false; }
    if (rv > 0.02) { logLine('bad', L('相对速度 ', 'Relative speed ') + (rv * 1000).toFixed(1)
      + L(' m/s 过快（需 ≤ 20 m/s）', ' m/s - too fast (must be <= 20 m/s)')); return false; }
    primary.docked.push(other);
    // 合并模块（登月舱 -> 指令舱）
    other.modules.forEach(function (m) { primary.modules.push(m); });
    other.modules = [];
    App.world.crafts = App.world.crafts.filter(function (x) { return x !== other; });
    // 合并后主级交给服务舱 SPS —— 后面 TEI / 中途修正都该用它，
    // 否则 activeModule() 会按 stageIndex 掉到上升级那台小发动机上。
    var hasSM = primary.modules.some(function (m2) { return m2.id === 'SM' && m2.prop > 0; });
    if (hasSM) primary.stageIndex = 5;
    // **把操控权交回指令舱**：不然 App.craft 还指着那台已经被摘掉的登月舱。
    App.craft = primary;
    App.objectives.dock = true;
    App.objectives.rendezvous = true;
    App.lm = null;
    logLine('ok', L('✔ 对接完成：Eagle 与 Columbia 刚性连接（操控交回指令舱）',
      '✔ Docking complete: Eagle and Columbia rigidly mated (back to the CSM)'));
    APL.Tutorial && APL.Tutorial.notify('dock_done');
    updateButtons();
    return true;
  }

  // 执行 TLI。真实 TLI 是**有限推力**点火（S-IVB 燃烧约 347 s、消耗约 76 t 推进剂），
  // 不是瞬时脉冲：制导每一步把推力对准"还差多少速度"，目标速度由兰伯特重新求解
  //（pendingTLI.targetFn = 闭环制导），于是燃烧期间飞船沿轨道前移约 2 700 km 带来的
  // 目标漂移会被自动跟上，重力损耗也自然出现。
  function execTLI() {
    if (!App.pendingTLI) { logLine('bad', L('请先在轨道计算器中求解转移（设置飞行时间并点击计算）',
      'Solve the transfer in the orbit calculator first')); return; }
    var c = App.craft, wt = App.pendingTLI;
    var b = null;
    if (wt.openloop) {
      // 开环常值推力方向（打靶法解出来的姿态 + 按时关机）—— 推荐的路径
      b = App.world.finiteBurn(c, {
        label: 'TLI', dirFixed: wt.dir, T: wt.T, dvIdeal: wt.dv,
        maxT: wt.T * 1.6 + 60
      });
    } else if (wt.target) {
      // 燃烧中心化后的固定目标速度矢量（推荐路径）
      b = App.world.finiteBurn(c, {
        label: 'TLI', dvIdeal: wt.dv, target: wt.target, maxT: 1800
      });
    } else if (wt.targetFn) {
      b = App.world.finiteBurn(c, {
        label: 'TLI', dvIdeal: wt.dv, targetFn: wt.targetFn, maxT: 1500
      });
    }
    if (!b) {
      // 退路：没有闭环目标（或推进剂不足）时退回瞬时脉冲模型
      var ok = App.world.impulsiveBurn(c, wt.dv, wt.dir);
      if (!ok) { logLine('bad', L('推进剂不足，无法完成该机动',
        'Not enough propellant for this manoeuvre')); return; }
      App.objectives.tli = true;
      logLine('ok', L('✔ TLI 点火完成（瞬时脉冲模型），Δv = ',
        '✔ TLI burn complete (impulsive model), dv = ') + wt.dv.toFixed(4) + ' km/s');
      APL.Tutorial && APL.Tutorial.notify('tli_done');
      c.attitude.mode = 'prograde';
      return;
    }
    c.attitude.mode = 'hold';
    logLine('ok', L('✔ TLI 点火：需 Δv = ', '✔ TLI burn started: required dv = ')
      + (b.dvIdeal * 1000).toFixed(0) + L(' m/s，闭环制导中（燃烧结束会自动关机）',
        ' m/s, closed-loop guidance running (cutoff is automatic)'));
  }

  // 与给定倍率最接近的档位（演示用的倍率不一定正好在 WARP 表里）
  function warpIndexFor(v) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < APL.WARP.length; i++) {
      var d = Math.abs(APL.WARP[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function setWarp(i) {
    App.warpIndex = Math.max(0, Math.min(APL.WARP.length - 1, i));
    if (App.world) App.world.warp = APL.WARP[App.warpIndex];
    // 演示进行中、玩家自己动了倍率 => 把倍率控制权交还玩家
    if (APL.Demo && APL.Demo.isActive() && APL.Demo.noteUserWarp) {
      APL.Demo.noteUserWarp(App.world ? App.world.warp : APL.WARP[App.warpIndex]);
    }
    APL.Tutorial && APL.Tutorial.notify('warp_changed');
  }
  // 演示引擎用：按真实数值设倍率（允许不在档位表里），并同步档位索引，
  // 这样玩家接着按 +/- 时是从"当前真实倍率"往上/往下走，不会突然掉档。
  function setWarpValue(v) {
    if (App.world) App.world.warp = v;
    App.warpIndex = warpIndexFor(v);
  }
  // 【+】/【−】= 相对**当前倍率**加/减一档。
  // 原来用的是 App.warpIndex，而演示每步把 world.warp 改成自己的值却不更新索引，
  // 于是演示在 ×50000 滑行时玩家按「+」，倍率反而被压到 ×2 —— 演示看着就像卡死/中断。
  function stepWarp(dir) {
    var cur = App.world ? App.world.warp : APL.WARP[App.warpIndex];
    var list = APL.WARP, i;
    if (dir > 0) {
      for (i = 0; i < list.length; i++) { if (list[i] > cur * 1.0001) break; }
      if (i >= list.length) i = list.length - 1;
    } else {
      for (i = list.length - 1; i >= 0; i--) { if (list[i] < cur * 0.9999) break; }
      if (i < 0) i = 0;
    }
    setWarp(i);
  }

  function updateButtons() {
    if (!App.world) return;
    var c = App.craft;
    $('btnPlay').textContent = App.paused ? TT('btn.play') : TT('btn.pause');
    $('btnUndock').disabled = !!App.lm || !c || c.primary === 'EARTH';
    $('btnDock').disabled = !App.lm;
    // 分离之后玩家必须能自己接手登月舱：以前只有演示引擎能切，
    // 界面上根本没有这个按钮（"分离完就开不动 LM 了"）。
    if ($('btnSwitch')) {
      $('btnSwitch').disabled = !App.lm;
      $('btnSwitch').textContent = App.lm
        ? L('切换飞行器（→ ', 'Switch craft (to ') + App.lm.id + L('）', ')')
        : L('切换飞行器', 'Switch craft');
    }
    $('btnStage').disabled = !c || c.modules.length <= 1;
  }

  function bindUI() {
    // 顶栏
    $('btnPlay').onclick = function () { App.paused = !App.paused; updateButtons(); };
    $('btnWarpUp').onclick = function () { stepWarp(+1); };
    $('btnWarpDown').onclick = function () { stepWarp(-1); };
    $('btnMissions').onclick = showMissionPicker;
    $('btnLang').onclick = function () { APL.toggleLang(); };
    var _dstop = document.getElementById('demoStop');
    if (_dstop) _dstop.onclick = function () {
      if (!APL.Demo) return;
      // 演示在跑 → 交还手动控制；横幅是"异常中止"提示 → 关掉它
      if (APL.Demo.isActive()) APL.Demo.stop('manual');
      else if (APL.Demo.dismiss) APL.Demo.dismiss();
    };
    // 玩家一旦手动操作飞行控制条或计算器动作，就交还控制权
    var giveBack = function () {
      if (APL.Demo && APL.Demo.isActive()) APL.Demo.stop('manual');
    };
    var cb = document.getElementById('ctrlbar');
    if (cb) {
      cb.addEventListener('click', giveBack, true);
      cb.addEventListener('input', giveBack, true);
    }
    ['btnTLI', 'btnCirc', 'btnLand', 'btnRend'].forEach(function (id) {
      var e2 = document.getElementById(id);
      if (e2) e2.addEventListener('click', giveBack, true);
    });
    $('btnTutorial').onclick = function () {
      dismissHint();
      APL.Tutorial.toggle();
    };
    var _hs = document.getElementById('frhStart');
    if (_hs) _hs.onclick = function () {
      dismissHint();
      APL.Tutorial.start(0);
    };
    var _hk = document.getElementById('frhSkip');
    if (_hk) _hk.onclick = dismissHint;
    $('btnSave').onclick = saveGame;
    $('btnLoad').onclick = loadGame;
    $('btnFinish').onclick = finishMission;

    // 视图（只绑定带 data-view 的按钮；「轨道预演」是开关，不在其中）
    document.querySelectorAll('.vtab[data-view]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('.vtab[data-view]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        App.renderer.view = b.dataset.view;
        // 切视图时重置平移/缩放，避免上一个视图的偏移带过来
        App.renderer.cam.pan = [0, 0, 0];
        App.renderer.cam.userZoom = 1;
        // 「轨道面俯视」用的自定义相机基向量也要清掉，否则会带到 3D 视图上
        // （拖拽失效，看着就像 3D 被换成了 2D）
        App.renderer.cam.customBasis = null;
        App.renderer.cam.polarAxis = null;
        APL.Tutorial && APL.Tutorial.notify('view_changed');
      };
    });

    // 视角模式：3D（可旋转）/ 2D（视线垂直于当前轨道面的平面俯视）
    function setMode(m) {
      var r = App.renderer, cam = r.cam;
      r.mode = m;
      cam.customBasis = null; cam.polarAxis = null;
      cam.pan = [0, 0, 0]; cam.userZoom = 1;
      var b3 = document.getElementById('btnMode3d'), b2 = document.getElementById('btnMode2d');
      if (b3) b3.classList.toggle('on', m === '3d');
      if (b2) b2.classList.toggle('on', m === '2d');
      logLine('sys', m === '2d'
        ? L('视角切到 2D：垂直于当前轨道面俯视（拖动 = 平移）',
            'View mode: 2D - perpendicular to the current orbit plane (drag to pan)')
        : L('视角切到 3D：可旋转的三维视角（拖动 = 旋转）',
            'View mode: 3D - rotatable three-dimensional view (drag to rotate)'));
      APL.Tutorial && APL.Tutorial.notify('view_changed');
    }
    App.setViewMode = setMode;
    var b3d = document.getElementById('btnMode3d'), b2d = document.getElementById('btnMode2d');
    if (b3d) b3d.onclick = function () { setMode('3d'); };
    if (b2d) b2d.onclick = function () { setMode('2d'); };

    // 回放控制条
    var rpPlay = document.getElementById('rpPlay');
    if (rpPlay) rpPlay.onclick = function () {
      if (APL.Replay.state.playing) APL.Replay.pause(); else APL.Replay.play();
    };
    var rpStop = document.getElementById('rpStop');
    if (rpStop) rpStop.onclick = function () { APL.Replay.stop(); };
    var rpRp = document.getElementById('rpReplay');
    if (rpRp) rpRp.onclick = function () { APL.Replay.replay(); };
    var rpSD = document.getElementById('rpSpeedDown');
    if (rpSD) rpSD.onclick = function () { APL.Replay.cycleSpeed(-1); };
    var rpSU = document.getElementById('rpSpeedUp');
    if (rpSU) rpSU.onclick = function () { APL.Replay.cycleSpeed(1); };
    var rpSeek = document.getElementById('rpSeek');
    if (rpSeek) rpSeek.oninput = function () {
      var st = APL.Replay.state;
      if (st.data) {
        APL.Replay.seek((st.t0 || 0) +
          parseFloat(rpSeek.value) / 1000 * (st.span - (st.t0 || 0)));
      }
    };
    var rpExit = document.getElementById('rpExit');
    if (rpExit) rpExit.onclick = function () { APL.Replay.exit(); };

    // 轨道预演开关
    var bp = $('btnPredict');
    if (bp) bp.onclick = function () {
      if (!App.world) return;
      App.world.showPrediction = !App.world.showPrediction;
      App.world.predTraj = null;
      PRED.state = null;
      bp.classList.toggle('on', App.world.showPrediction);
      bp.textContent = TT(App.world.showPrediction ? 'btn.predictOn' : 'btn.predictOff');
      logLine('sys', App.world.showPrediction
        ? L('✔ 轨道预演开启：按当前速度与全部引力外推接下来的轨迹',
            'Orbit preview ON: extrapolating the upcoming trajectory from current velocity and full gravity')
        : L('轨道预演关闭', 'Orbit preview OFF'));
      APL.Tutorial && APL.Tutorial.notify('view_changed');
    };

    // 姿态
    document.querySelectorAll('.mbtn').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('.mbtn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (App.craft) { App.craft.attitude.mode = b.dataset.mode; App.craft._guid = null; }
      };
    });
    $('thr').oninput = function () {
      if (!App.craft) return;
      App.craft.throttleCmd = parseFloat(this.value) / 100;
      if (App.craft.throttleCmd > 0 && App.craft.attitude.mode === 'hold') App.craft.attitude.mode = 'prograde';
    };
    $('btnStage').onclick = stageNow;
    $('btnUndock').onclick = undockLM;
    $('btnDock').onclick = dockCraft;
    if ($('btnSwitch')) $('btnSwitch').onclick = function () { switchCraft(); updateButtons(); };
    $('btnCut').onclick = function () { if (App.craft) { App.craft.throttleCmd = 0; App.craft.throttle = 0; } $('thr').value = 0; };
    $('btnFull').onclick = function () { if (App.craft) { App.craft.throttleCmd = 1; } $('thr').value = 100; };
    $('btnAuto').onclick = function () {
      if (!App.craft) return;
      App.craft.attitude.mode = 'launch';
      App.craft._guid = null;
      App.craft.throttleCmd = 1;
      $('thr').value = 100;
      document.querySelectorAll('.mbtn').forEach(function (x) { x.classList.remove('on'); });
      document.querySelector('.mbtn[data-mode="launch"]').classList.add('on');
      logLine('sys', L('自动驾驶已接管：执行土星五号俯仰程序',
        'Autopilot engaged: running the Saturn V pitch program'));
      APL.Tutorial && APL.Tutorial.notify('autopilot_on');
    };

    // 页签
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
        document.querySelectorAll('.tabpage').forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        $('tab-' + t.dataset.tab).classList.add('on');
        if (t.dataset.tab === 'calc') runCalculator();
        APL.Tutorial && APL.Tutorial.notify('tab_' + t.dataset.tab);
      };
    });

    // 计算器
    $('btnCalc').onclick = runCalculator;
    $('btnTLI').onclick = execTLI;
    $('btnCirc').onclick = function () {
      var c = App.craft; if (!c) return;
      c.attitude.mode = 'vgo';
      c._guid = null;
      c.throttleCmd = 1; $('thr').value = 100;
      App.world.targetAlt = parseFloat($('calcTargetAlt').value) || 185;
      logLine('sys', L('入轨制导已启动，目标高度 ', 'Insertion guidance engaged, target altitude ')
        + App.world.targetAlt + ' km');
      runCalculator();
    };
    $('btnLand').onclick = function () { startDescentGuidance(); };
    $('btnRend').onclick = function () { rendezvousAssist(); };

    // AGC
    $('btnAgcRun').onclick = function () {
      App.agcPaused = !App.agcPaused;
      updateAgcRunBtn();
    };
    $('btnAgcAsm').onclick = function () { assembleSource(); };
    $('btnAgcLoad').onclick = function (e) { e.preventDefault(); loadProgram(); };
    $('btnAgcReset').onclick = function () {
      initAGC();
      logLine('sys', L('AGC 已复位（FRESH START）', 'AGC reset (fresh start)'));
    };
    $('fileInput').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { $('agcSrc').value = r.result; assembleSource(); };
      r.readAsText(f);
    };
    bindDskyKeys();

    // 弹窗关闭
    $('closeResult').onclick = function () { $('modalResult').classList.remove('show'); };
    $('closeMissions').onclick = function () { $('modalMissions').classList.remove('show'); };
  }

  function bindDskyKeys() {
    document.querySelectorAll('.dkey').forEach(function (k) {
      k.onclick = function () {
        App.agc.dsky.press(k.dataset.key);
        logLine('agc', L('DSKY 按键 ', 'DSKY key ') + k.dataset.key);
        APL.Tutorial && APL.Tutorial.notify('dsky_pressed');
      };
    });
  }

  // ============================================================ AGC 源码编辑
  function assembleSource() {
    var src = $('agcSrc').value;
    var r = APL.Asm.assemble(src);
    var out = $('asmOut');
    if (!r.ok) {
      out.textContent = L('汇编失败（', 'Assembly failed (') + r.errors.length
        + L(' 个错误）：\n', ' errors):\n') +
        r.errors.slice(0, 20).map(function (e) {
          return L('  行 ', '  line ') + e.line + ': ' + e.msg;
        }).join('\n');
      return;
    }
    // 载入固定存储器（按源程序所在页整体载入）
    var bankMap = {};
    for (var i = 0; i < r.listing.length; i++) bankMap[r.listing[i].bank] = true;
    for (var bk in bankMap) {
      var b = parseInt(bk, 10);
      App.agc.mem.fixed[b].set(r.mem.subarray(b * 1024, (b + 1) * 1024));
    }
    var entry = r.symbols['START'] ? r.symbols['START'].value : r.start;
    App.agc.FB = (entry >> 10) & 0o37;
    App.agc._curBank = (entry >> 10) & 0o37;
    App.agc.Z = ((entry >> 10) << 10) | (entry & 0o1777);
    App.agc.NextZ = App.agc.Z;
    App.agc.instructions = 0; App.agc.cycles = 0;
    App.agc.halted = false;
    App.agc.recent.length = 0;
    App.agcPaused = false;
    updateAgcRunBtn();
    var syms = Object.keys(r.symbols).map(function (k) {
      return '  ' + k.padEnd(10) + ' ' + APL.AGCUtil.oct(r.symbols[k].value, 5) +
        (r.symbols[k].erasable
          ? L('  (可擦)', '  (erasable)')
          : L('  页', '  bank ') + r.symbols[k].bank);
    });
    APL.Tutorial && APL.Tutorial.notify('asm_done');
    out.textContent = L('汇编成功 ✓  共 ', 'Assembly OK - ') + r.listing.length
      + L(' 个字\n', ' words\n') +
      L('入口 START = ', 'Entry START = ') + APL.AGCUtil.oct(entry, 5)
        + L('（页 ', ' (bank ') + ((entry >> 10) & 0o37) + L('）', ')') + '\n\n' +
      L('符号表（', 'Symbol table (') + syms.length + L(' 项）:\n', ' entries):\n')
        + syms.join('\n');
  }

  function loadProgram(name) {
    var n = name || $('progSelect').value;
    if (!n) { logLine('bad', L('请选择示例程序', 'Please pick a sample program')); return; }
    // 优先使用内置文本（浏览器兜底模式同样可用）
    if (APL.PROGRAMS && APL.PROGRAMS[n]) {
      $('agcSrc').value = APL.PROGRAMS[n];
      assembleSource();
      logLine('agc', L('已载入示例程序 ', 'Sample program loaded: ') + n);
      return;
    }
    if (window.pywebview && window.pywebview.api) {
      window.pywebview.api.read_program(n).then(function (res) {
        if (res && res.ok) {
          $('agcSrc').value = res.text; assembleSource();
          logLine('agc', L('已载入示例程序 ', 'Sample program loaded: ') + n);
        } else logLine('bad', L('读取失败：', 'Read failed: ') + (res && res.error));
      });
    } else {
      logLine('bad', L('未找到示例程序 ', 'Sample program not found: ') + n);
    }
  }

  // ============================================================ 制导辅助
  function startDescentGuidance() {
    var c = App.craft; if (!c) return;
    if (c.primary !== 'MOON') {
      logLine('bad', L('动力下降需在月球引力范围内执行',
        'Powered descent must be flown inside the Moon\'s sphere of influence'));
      return;
    }
    App.descent = { on: true };
    c.attitude.mode = 'retrograde';
    c.throttleCmd = 1;
    $('thr').value = 100;
    logLine('sys', L('动力下降制导启动：先制动减速，再转入最终下降',
      'Powered-descent guidance engaged: brake first, then final descent'));
  }

  // 动力下降制导：交给 03-physics.js 里那套闭环律（自动演示与手动辅助共用）
  function descentGuidance() {
    var c = App.craft;
    if (!c || !App.descent || !App.descent.on || !App.world) return;
    var ms = A.moonState(App.world.t);
    var alt = V.dist(c.r, ms.r) - B.MOON.radius;
    var sp = V.mag(V.sub(c.v, ms.v));
    P.descentGuidance(App.world, c, App.descent.opt || {});
    if (alt <= 0.02 && sp < 0.004) {
      App.descent.on = false;
      c.throttleCmd = 0;
      logLine('ok', L('✔ 着陆制导结束：已安全接触月面',
        '✔ Descent guidance complete: safe lunar touchdown'));
      APL.Tutorial && APL.Tutorial.notify('landing_done');
    }
  }

  // 交会辅助：接通**闭环交会制导**（和自动演示用的是同一条 P.rendezvousControl），
  // 再点一次关闭。以前这里是一次瞬时脉冲 Δv —— 既和其它机动不一致，玩家也看不到过程。
  function rendezvousAssist() {
    var c = App.craft;
    if (!App.lm) { logLine('bad', L('没有可交会的目标（登月舱还连着）',
      'No rendezvous target (the LM is still docked)')); return; }
    App.rendezvous = App.rendezvous || { on: false };
    App.rendezvous.on = !App.rendezvous.on;
    if (App.rendezvous.on) {
      logLine('sys', L('交会制导已接通：闭环缩小距离并收住相对速度（再点一次可关闭）',
        'Rendezvous guidance engaged: closing the range while nulling the relative velocity'));
    } else {
      c.throttleCmd = 0;
      logLine('sys', L('交会制导已关闭', 'Rendezvous guidance off'));
    }
  }

  // 每帧驱动交会制导（与动力下降制导同一套写法）
  function rendezvousTick(dt) {
    if (!App.rendezvous || !App.rendezvous.on) return;
    var c = App.craft;
    if (!c || !App.lm || App.lm.crashed) { App.rendezvous.on = false; return; }
    var r = P.rendezvousControl(App.world, c, App.lm, dt);
    if (r && r.d < 150 && r.rv < 20) {
      App.rendezvous.on = false;
      c.throttleCmd = 0;
      logLine('ok', L('✔ 交会到位：距离 ', '✔ Rendezvous complete: range ')
        + r.d.toFixed(0) + L(' m、相对速度 ', ' m, relative speed ')
        + r.rv.toFixed(1) + L(' m/s —— 可以点【对接登月舱】了',
          ' m/s - you can now click Dock LM'));
    }
  }

  // ============================================================ 存档
  function saveGame() {
    var w = App.world; if (!w) return;
    var data = { t: w.t, mission: App.mission.id, warp: w.warp, craft: [], objectives: App.objectives };
    w.crafts.forEach(function (c) {
      data.craft.push({
        id: c.id, name: c.name, r: c.r, v: c.v, primary: c.primary,
        stageIndex: c.stageIndex, throttleCmd: c.throttleCmd, mode: c.attitude.mode,
        rcsProp: c.rcsProp, dvUsed: c.dvUsed, flags: c.flags,
        modules: c.modules.map(function (m) {
          return { id: m.id, name: m.name, dry: m.dry, prop: m.prop, propMax: m.propMax,
                   thrust: m.thrust, isp: m.isp, thrustSL: m.thrustSL, ispSL: m.ispSL,
                   throttleMin: m.throttleMin, hasEngine: m.hasEngine, jettison: m.jettison,
                   group: m.group, stage: m.stage };
        })
      });
    });
    var payload = JSON.stringify(data, null, 1);
    if (window.pywebview && window.pywebview.api) {
      window.pywebview.api.save_game(payload, 'mission_' + App.mission.id).then(function (r) {
        logLine(r.ok ? 'ok' : 'bad', r.ok
          ? L('存档已保存：', 'Saved to ') + r.path
          : L('存档失败：', 'Save failed: ') + r.error);
        if (r.ok) APL.Tutorial && APL.Tutorial.notify('saved');
      });
    } else {
      try {
        localStorage.setItem('apollo11save', payload);
        logLine('ok', L('存档已写入浏览器本地存储', 'Saved to browser local storage'));
        APL.Tutorial && APL.Tutorial.notify('saved');
      } catch (e) { logLine('bad', L('存档失败', 'Save failed')); }
    }
  }

  function loadGame() {
    function apply(data) {
      // 读档会整体换掉世界：回放必须一起中止，否则 mode 仍是 replay、
      // 主循环不推进物理，旧回放还会继续往刚读进来的世界上写样本。
      if (APL.Replay && APL.Replay.state && APL.Replay.state.abort) {
        var rpS = APL.Replay.state;
        if (rpS.active || rpS.loading || App.mode === 'replay' || App.driverExternal) rpS.abort();
      }
      var sc = buildScenario(data.mission);
      App.world = sc.world;
      App.mission = sc.world.mission;
      App.world.t = data.t;
      App.world.crafts = [];
      App.lm = null;
      data.craft.forEach(function (cd) {
        var c = new P.Craft({ id: cd.id, name: cd.name, r: cd.r, v: cd.v, modules: cd.modules, mode: cd.mode });
        c.primary = cd.primary; c.stageIndex = cd.stageIndex;
        c.throttleCmd = cd.throttleCmd; c.rcsProp = cd.rcsProp; c.dvUsed = cd.dvUsed;
        c.flags = cd.flags || {};
        App.world.addCraft(c);
        if (!App.craft) App.craft = c;
      });
      App.craft = App.world.crafts[0];
      // 存档里记了倍率，读档要恢复（否则读回来的 100× 会悄悄变成 1×）
      if (data.warp) {
        App.world.warp = data.warp;
        App.warpIndex = warpIndexFor(data.warp);
      }
      // 恢复"另一台飞行器"的引用（否则读档后【切换飞行器】【对接】都报"没有可切换的飞行器"）
      for (var ci = 0; ci < App.world.crafts.length; ci++) {
        var cc = App.world.crafts[ci];
        if (cc === App.craft) continue;
        if ((cc.flags && cc.flags.isLM) || cc.id === 'LM' || !App.lm) App.lm = cc;
      }
      App.objectives = data.objectives || {};
      logLine('ok', L('读档完成，任务时间 ', 'Game loaded, mission time ') + M.fmtTime(data.t));
      refreshAll();
    }
    if (window.pywebview && window.pywebview.api) {
      window.pywebview.api.load_game('mission_' + (App.mission ? App.mission.id : 'M1')).then(function (r) {
        if (r.ok) apply(r.data);
        else logLine('bad', L('读档失败：', 'Load failed: ') + r.error);
      });
    } else {
      var s = localStorage.getItem('apollo11save');
      if (s) apply(JSON.parse(s));
      else logLine('bad', L('没有找到存档', 'No save file found'));
    }
  }

  // ============================================================ 自检
  function runSelfTest() {
    var out = [];
    function ok(n, c, d) { out.push((c ? '✔ ' : '✘ ') + n + (d ? '   ' + d : '')); return c; }
    var pass = 0, total = 0;
    function T(n, c, d) { total++; if (ok(n, c, d)) pass++; }

    // 历表
    var m0 = A.moonEcliptic(0).lon;
    T(L('月球历表历元黄经 ≈135.4°', 'Lunar ephemeris epoch longitude ~135.4 deg'),
      Math.abs(m0 - 135.4) < 0.1, m0.toFixed(3) + '°');
    var md = A.moonEcliptic(0).dist;
    T(L('发射时刻月心距 ≈403922 km', 'Earth-Moon distance at liftoff ~403,922 km'),
      Math.abs(md - 403922) < 300, md.toFixed(0) + ' km');
    var se = A.lunarSunElevation(370060, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon);
    T(L('着陆时刻静海太阳高度角 ≈10.5°',
        'Sun elevation at Tranquility Base at touchdown ~10.5 deg'),
      Math.abs(se - 10.5) < 1.0, se.toFixed(2) + '°');

    // 轨道数学
    var R = B.EARTH.radius + 185;
    var e1 = M.elements(B.EARTH.mu, [R, 0, 0], [0, Math.sqrt(B.EARTH.mu / R), 0]);
    T(L('圆轨道根数 e≈0，高度 185 km', 'Circular orbit elements: e ~ 0, altitude 185 km'),
      e1.e < 1e-6 && Math.abs(e1.periapsis - R) < 1e-6, e1.e.toExponential(1));
    var prop = M.propagate(B.EARTH.mu, [R, 0, 0], [0, Math.sqrt(B.EARTH.mu / R), 0], e1.period);
    T(L('二体传播一整圈闭合 <1 m', 'Two-body propagation closes to < 1 m over one revolution'),
      V.dist(prop.r, [R, 0, 0]) < 1e-3,
      (V.dist(prop.r, [R, 0, 0]) * 1000).toExponential(2) + ' m');
    var Lb = M.lambert(B.EARTH.mu, [R, 0, 0], [R * 0.5, R * 0.866, 0], 3600, true);
    var lerr = Lb ? V.dist(M.propagate(B.EARTH.mu, [R, 0, 0], Lb.v1, 3600).r, [R * 0.5, R * 0.866, 0]) : 1e9;
    T(L('兰伯特求解往返误差 <1 m', 'Lambert solution round-trip error < 1 m'),
      lerr < 1e-3, (lerr * 1000).toExponential(2) + ' m');

    // 汇编器 / AGC
    var as = APL.Asm.assemble('SETLOC 5400\n BANK 2\nSTART CAF K1\n EXTEND\n WRITE 21\n TCF START\nSETLOC 5700\n BANK 2\nK1 DEC 42\n');
    T(L('AGC 汇编器可用', 'AGC assembler works'),
      as.ok && as.symbols['START'] !== undefined,
      L('符号 ', 'symbols ') + Object.keys(as.symbols).length + L(' 个', ''));
    var ag = new APL.AGC();
    ag.mem.fixed[2].set(as.mem.subarray(2048, 3072));
    ag.FB = 2; ag._curBank = 2;
    var ent = as.symbols['START'].value;
    ag.Z = ent; ag.NextZ = ent; ag.standby = false;
    ag.run(4000);
    T(L('AGC 执行并驱动 DSKY', 'AGC executes and drives the DSKY'),
      ag.dsky.prog === 42, 'PROG=' + ag.dsky.prog);
    var dis = APL.AGCUtil.disassemble(ag.mem.fixed[2][0o1400]);
    T(L('反汇编可用', 'Disassembler works'), !!dis, dis || '');

    // 物理
    var w = new P.World();
    var site = A.siteState(0, APL.SITE.lat, APL.SITE.lon, 0.02);
    var cr = new P.Craft({ id: 'T', r: site.r, v: site.v, mode: 'launch' });
    w.addCraft(cr);
    var g = V.mag(w.gravity(0, site.r)) * 1000;
    T(L('地表重力加速度 ≈9.78 m/s²', 'Surface gravity ~9.78 m/s2'),
      Math.abs(g - 9.78) < 0.15, g.toFixed(3) + ' m/s²');
    cr.ambientP = 1;
    T(L('海平面大气压比 =1', 'Sea-level pressure ratio = 1'),
      Math.abs(cr.ambientRatio() - 1) < 1e-9, '');

    out.unshift(L('自检结果：', 'Self-test results: ') + pass + ' / ' + total
      + L(' 项通过\n', ' checks passed\n'));
    $('selfTestOut').textContent = out.join('\n');
    logLine(pass === total ? 'ok' : 'bad', L('系统自检：', 'Self-test: ')
      + pass + '/' + total + L(' 通过', ' passed'));
  }

  // ---------------------------------------------------------- 画布交互
  // 制导手册（第 7 个页签）：内容在 09-i18n.js 的 APL.Guide 里，中英各一份。
  // 切语言时必须重建（否则出现"半中半英"，见 01 文档第 2 节）。
  function renderGuide() {
    var host = $('guideBody');
    if (!host) return;
    var en = APL.getLang && APL.getLang() === 'en';
    host.textContent = '';
    (APL.Guide || []).forEach(function (sec) {
      var h = el('h4', null, en ? sec.h.en : sec.h.zh);
      host.appendChild(h);
      (sec.rows || []).forEach(function (r) {
        var row = el('div', 'grow');
        row.appendChild(el('b', null, en ? r.t.en : r.t.zh));
        row.appendChild(el('span', null, en ? r.b.en : r.b.zh));
        host.appendChild(row);
      });
    });
  }

  function bindCanvas() {
    var cv = $('sky'), dragging = false, lx = 0, ly = 0;
    cv.addEventListener('mousedown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', function () { dragging = false; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var cam = App.renderer.cam;
      if (App.renderer.mode === '2d') {
        // 2D 模式：拖拽 = 在轨道面内平移（pan 的两分量 = 沿 ex / 沿 ey）
        cam.pan = cam.pan || [0, 0, 0];
        cam.pan[0] -= (e.clientX - lx) / cam.scale;
        cam.pan[1] += (e.clientY - ly) / cam.scale;
      } else {
        cam.yaw -= (e.clientX - lx) * 0.006;
        cam.tilt = Math.max(-1.45, Math.min(1.45, cam.tilt + (e.clientY - ly) * 0.005));
      }
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var cam = App.renderer.cam;
      cam.userZoom = V.clamp((cam.userZoom || 1) * (e.deltaY < 0 ? 1.14 : 1 / 1.14), 0.02, 60);
    }, { passive: false });
    cv.addEventListener('dblclick', function () {
      App.renderer.cam.pan = [0, 0, 0];
      App.renderer.cam.userZoom = 1;
    });
  }

  // ---------------------------------------------------------- 任务时序表
  function buildTimelineTable() {
    var tb = $('timeTable').querySelector('tbody');
    tb.innerHTML = '';
    APL.TIMELINE.forEach(function (ev) {
      var tr = el('tr');
      tr.dataset.t = ev.t;
      tr.appendChild(el('td', null, M.fmtMet(ev.t)));
      tr.appendChild(el('td', null, APL.tlText(ev, 'name')));
      tr.appendChild(el('td', null, APL.tlText(ev, 'detail')));
      tb.appendChild(tr);
    });
  }
  function markTimeline() {
    if (!App.world) return;
    var rows = $('timeTable').querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('past', parseFloat(rows[i].dataset.t) <= App.world.t);
    }
  }

  // ---------------------------------------------------------- 下传遥测
  function refreshDownlink() {
    if (!App.agc) return;
    var io = App.agc.ioLog.slice(-22);
    var lines = io.map(function (e) {
      return L('  通道 ', '  channel ') + APL.AGCUtil.oct(e.ch, 3) + '  <-  ' +
        APL.AGCUtil.oct(e.v, 5) + '   (' + APL.AGCUtil.wordToNum(e.v) + ')';
    });
    $('downOut').textContent = lines.length
      ? L('最近 ', 'Last ') + lines.length + L(' 次通道写入：\n', ' channel writes:\n')
        + lines.join('\n')
      : L('（尚无通道写入）', '(no channel writes yet)');
    var kl = App.agc.dsky.keyLog.slice(-14).map(function (k) {
      return '  t=' + k.t + L('  键 ', '  key ') + k.key + L('  码 ', '  code ')
        + APL.AGCUtil.oct(k.code, 2);
    });
    var al = App.agc.alarms.slice(-8).map(function (a) {
      return L('  告警 ', '  alarm ') + a.code + ' - ' + (APL.getLang() === 'en'
        ? (a.code === 'DV ZERO' ? 'divide by zero' : a.text) : a.text);
    });
    $('downLog').textContent =
      (kl.length ? L('DSKY 键盘事件：\n', 'DSKY keystrokes:\n') + kl.join('\n')
        : L('（尚无键盘事件）', '(no keystrokes yet)')) +
      '\n\n' + (al.length ? L('程序告警：\n', 'Program alarms:\n') + al.join('\n')
        : L('（无告警）', '(no alarms)')) +
      '\n\n' + L('DSKY 显示：', 'DSKY display: ') +
      'PROG=' + (App.agc.dsky.prog === null ? '--' : App.agc.dsky.prog) +
      '  VERB=' + (App.agc.dsky.verb === null ? '--' : App.agc.dsky.verb) +
      '  NOUN=' + (App.agc.dsky.noun === null ? '--' : App.agc.dsky.noun);
  }

  function refreshAll() {
    refreshPanels();
    updateButtons();
    updateTopBar();
  }

  // 着陆制导与交会每帧调用
  var _origLoop = loop;
  var _rdvLastT = 0;
  function loop2(ts) {
    descentGuidance();
    if (App.world) {
      var dt = Math.max(1 / 60, Math.min(5, App.world.t - _rdvLastT));
      rendezvousTick(dt);
    }
    _origLoop(ts);
    _rdvLastT = App.world ? App.world.t : 0;
  }

  App.bootstrap = function () {
    // 先按保存的语言翻译静态界面
    if (APL.applyI18n) APL.applyI18n();
    App.init();
    // 定时刷新计算器
    setInterval(function () {
      if ($('tab-calc').classList.contains('on')) runCalculator();
    }, 1000);
    // 自检按钮
    $('btnSelfTest').onclick = runSelfTest;
    // 按钮文案由 data-i18n 统一负责，这里不要再硬编码覆盖
    App.agcPaused = false;
    updateAgcRunBtn();
    buildTimelineTable();
    bindCanvas();
    renderGuide();
    setInterval(refreshDownlink, 700);
    // 语言切换后重建所有「运行时生成」的内容
    window.addEventListener('apollo-lang-changed', function () {
      if (APL.Replay && APL.Replay.ui) APL.Replay.ui();
      try {
        // ① 任务选择弹窗
        showMissionPicker();
        $('modalMissions').classList.remove('show');
        // ② 任务时序表
        buildTimelineTable();
        // ②b 制导手册
        renderGuide();
        // ③ 当前任务的标题 / 副标题（startMission 时写入的，需要重新翻译）
        if (App.mission) {
          $('missionTitle').textContent = App.mission.code + ' · '
            + APL.missionText(App.mission, 'name');
          $('missionSub').textContent = APL.missionText(App.mission, 'brief');
        }
        // ④ 推进级列表：清掉签名缓存强制重建
        var sl = $('stageList');
        if (sl) sl.dataset.sig = '';
        // ⑤ 计算器 / 遥测 / 按钮 / 下传面板
        refreshAll();
        refreshDownlink();
        updateAgcRunBtn();
        if (APL.Demo && APL.Demo.isActive()) APL.Demo.state && null;
        if (App.craft) renderStages(App.craft);
        // ⑥ 日志：历史条目保留写入时的语言，插一条分隔线说明。
        //    ⚠ 启动自检（index.html 内嵌脚本）会来回切一次语言做验证，
        //    那两次不写日志 —— 否则玩家每次打开都会看到两行"语言已切换"。
        if (!APL.__silentLangSet) {
          logLine('sys', '── ' + L('语言已切换为中文（上方历史条目保留原语言）',
            'Language switched to English (earlier entries keep their original language)')
            + ' ──');
        }
      } catch (e) { /* ignore */ }
    });
    // 自动载入第一个内置 AGC 示例，让 DSKY 一打开就有内容
    try {
      if (APL.PROGRAM_LIST && APL.PROGRAM_LIST.length) {
        $('agcSrc').value = APL.PROGRAMS[APL.PROGRAM_LIST[0]];
        assembleSource();
      }
    } catch (e) { /* 忽略 */ }
    runSelfTest();
    // 教程绝不自动播放：只在玩家点击【新手教程】时启动。
    // 首次运行只在顶部给一个可忽略的提示条，点了才开始。
    try {
      if (!localStorage.getItem('apollo11.hintDismissed')) {
        var hint = document.getElementById('firstRunHint');
        if (hint) hint.classList.add('show');
      }
    } catch (e) {}
  };

  function dismissHint() {
    var hint = document.getElementById('firstRunHint');
    if (hint) hint.classList.remove('show');
    try { localStorage.setItem('apollo11.hintDismissed', '1'); } catch (e) {}
  }

})(typeof window !== 'undefined' ? window : globalThis);
