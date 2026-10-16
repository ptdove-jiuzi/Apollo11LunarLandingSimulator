/* =========================================================================
 *  12-replay.js  —  离线轨迹回放
 *
 *  自动演示 = 固定回放：轨迹由离线生成器（tools/make_replay_probe.js +
 *  tools/save_replay.js）用**真实物理 + 真实参数 + 禁用一切演示兜底**跑出来，
 *  存成固定样本（apollo11/webdata/traj/<M>.json）。播放时**只做插值 + 渲染**：
 *    · 不调用 World.advance / 任何制导 / 兰伯特 / 推进剂消耗
 *    · 倍率只改变样本时间的推进速度，不重新模拟
 *    · 进度拖动 = 直接跳到对应样本时间（不允许从当前状态重新积分）
 *  手动飞行不受本模块影响：手动模式仍走实时物理（见 07-app.js 的 live 分支）。
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var V = APL.V, P = APL.Physics;

  function app() { return global.APLApp; }

  var RP = {
    active: false, mission: null, data: null, t: 0, playing: false,
    speed: 100, idx: 0, span: 0, evIdx: 0, wlogIdx: 0,
    lastApplied: null, errors: []
  };

  var SPEEDS = [1, 10, 100, 1000, 10000, 100000];

  // ------------------------------------------------------------ 工具
  function lerp(a, b, f) { return a + (b - a) * f; }
  function lerp3(a, b, f) { return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; }

  function findIdx(t) {                    // 二分：样本时间数组
    var S = RP.data.samples, lo = 0, hi = S.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (S[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ------------------------------------------------------------ 世界准备
  // 回放需要一个"世界"来给渲染器画（月球/太阳位置、crafts 列表）。
  // startMission 建好初始世界后，我们从样本里**写**状态进去。
  function ensureCraft(cs) {
    var w = app().world;
    for (var i = 0; i < w.crafts.length; i++) if (w.crafts[i].id === cs.id) return w.crafts[i];
    // 轨迹里出现的"新"飞行器（分离出来的登月舱、被抛弃的级……）
    var all = P.buildSaturnVStack();
    var mods = [];
    for (var k = 0; k < cs.mo.length; k++) {
      for (var j = 0; j < all.length; j++) {
        if (all[j].id === cs.mo[k][0]) { mods.push(JSON.parse(JSON.stringify(all[j]))); break; }
      }
    }
    var c = new P.Craft({ id: cs.id, r: cs.r.slice(), v: cs.v.slice(), modules: mods, mode: 'prograde' });
    c.flags.isLM = !!cs.lm;
    w.addCraft(c);
    return c;
  }

  // 模块定义表（按 id 取一份干净副本；回放要按样本重建模块表）
  var MODREG = null;
  function freshModules(ids) {
    if (!MODREG) {
      MODREG = {};
      var all = P.buildSaturnVStack();
      for (var i = 0; i < all.length; i++) MODREG[all[i].id] = all[i];
    }
    var out = [];
    for (var k = 0; k < ids.length; k++) {
      var m = MODREG[ids[k]];
      if (m) out.push(JSON.parse(JSON.stringify(m)));
    }
    return out;
  }

  // 把样本状态写进世界（**唯一**改变飞行器状态的入口；全部来自固定样本）
  RP.apply = function () {
    var w = app().world;
    if (!w || !RP.data) return;
    var S = RP.data.samples;
    var i = RP.idx, j = Math.min(i + 1, S.length - 1);
    var a = S[i], b = S[j];
    var f = (b.t > a.t) ? (RP.t - a.t) / (b.t - a.t) : 0;
    if (f < 0) f = 0; if (f > 1) f = 1;

    w.t = RP.t;
    for (var n = 0; n < a.c.length; n++) {
      var cs = a.c[n], cb = (b.c[n] && b.c[n].id === cs.id) ? b.c[n] : cs;
      var c = ensureCraft(cs);
      c.r = lerp3(cs.r, cb.r, f);
      c.v = lerp3(cs.v, cb.v, f);
      c.primary = cs.pr;
      c.landed = !!cs.ld;
      c.crashed = !!cs.cr;
      c.throttle = cs.th; c.throttleCmd = cs.th;
      c.stageIndex = cs.st;
      c.flags.isLM = !!cs.lm;
      if (cs.at) c.attitude.vec = cs.at.slice();
      c.attitude.mode = cs.th > 0.001 ? 'replay' : 'prograde';
      // 模块表按样本重建（已抛弃的级必须真正消失），推进剂按样本插值
      c.modules = freshModules(cs.mo.map(function (x) { return x[0]; }));
      for (var k2 = 0; k2 < cs.mo.length; k2++) {
        var id2 = cs.mo[k2][0];
        var cbv = cb.mo.filter(function (x) { return x[0] === id2; })[0] || cs.mo[k2];
        for (var m2 = 0; m2 < c.modules.length; m2++) {
          if (c.modules[m2].id === id2) c.modules[m2].prop = lerp(cs.mo[k2][1], cbv[1], f);
        }
      }
      c._rpMass = lerp(a.c[n].m, cb.m, f);
    }
    // 主角（面板/HUD 用）
    var hi = (a.hv !== undefined && a.hv >= 0 && a.hv < w.crafts.length) ? a.hv : 0;
    if (w.crafts[hi]) app().craft = w.crafts[hi];
    // 拖尾：用已播放过的样本位置（不重新积分）
    if (RP.trail && RP.trail.length > 0) w.history = RP.trail;
    w.predTraj = null;                       // 回放不做预测
  };

  // ------------------------------------------------------------ 播放控制
  RP.load = function (missionId, data) {
    RP.mission = missionId;
    RP.data = data;
    RP.span = data.samples[data.samples.length - 1].t;
    RP.t0 = data.samples[0].t;               // 轨迹时间基（M4 从 362 000 s 起）
    RP.t = RP.t0; RP.idx = 0; RP.evIdx = 0; RP.wlogIdx = 0;
    RP.trail = [];
    RP.active = true;
    RP.playing = false;
    RP.speed = 100;
    app().mode = 'replay';
    app().driverExternal = true;             // 主循环不再自己推进/驱动制导
    app().paused = true;
    RP.apply();
    RP.log('ok', '回放模式：离线轨迹（固定样本）· ' + missionId +
      ' · 总时长 T+' + fmt(RP.span) + '（播放在此模式下不做任何实时物理计算）');
    RP.ui();
    return true;
  };

  RP.start = function (missionId, done) {
    var url = 'traj/' + missionId + '.json';
    if (global.fetch) {
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        RP.load(missionId, d);
        RP.play();
        if (done) done(true);
      }).catch(function (e) {
        RP.log('bad', '回放数据加载失败（' + url + '）：' + (e && e.message ? e.message : e) +
          ' —— 该任务尚未生成合格轨迹，自动演示不可用（手动飞行不受影响）');
        RP.errors.push(String(e));
        if (done) done(false);
      });
    }
  };

  RP.play = function () { if (RP.active) { RP.playing = true; RP.ui(); } };
  RP.pause = function () { RP.playing = false; RP.ui(); };
  RP.stop = function () { RP.playing = false; RP.seek(RP.span); RP.ui(); };
  RP.replay = function () { RP.seek(RP.t0 || 0); RP.play(); };
  RP.cycleSpeed = function (dir) {
    var i = SPEEDS.indexOf(RP.speed);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + (dir || 1)));
    RP.speed = SPEEDS[i];
    RP.ui();
  };
  RP.setSpeed = function (v) { RP.speed = v; RP.ui(); };
  RP.seek = function (t) {                    // 拖动 = 直接跳样本时间
    RP.t = Math.max(RP.t0 || 0, Math.min(RP.span, t));
    RP.idx = findIdx(RP.t);
    RP.rebuildTrail();
    RP.apply();
    RP.ui();
  };

  RP.rebuildTrail = function () {
    var S = RP.data.samples, out = [];
    var step = Math.max(1, Math.floor(RP.idx / 900));       // 最多 900 个点
    for (var i = 0; i <= RP.idx; i += step) {
      out.push({ t: S[i].t, r: S[i].c[0] ? S[i].c[0].r.slice() : [0, 0, 0], p: S[i].c[0] ? S[i].c[0].pr : 'EARTH' });
    }
    RP.trail = out;
  };

  // 每帧调用（由主循环在 replay 模式下驱动）；dtWall = 真实秒
  RP.tick = function (dtWall) {
    if (!RP.active) return;
    if (!RP.playing) return;
    RP.t = Math.min(RP.span, RP.t + dtWall * RP.speed);
    var ni = findIdx(RP.t);
    if (ni !== RP.idx) {
      var S = RP.data.samples, step = Math.max(1, Math.floor(ni / 900));
      for (var i = RP.idx + 1; i <= ni; i++) {
        if (i % step === 0) RP.trail.push({ t: S[i].t, r: S[i].c[0] ? S[i].c[0].r.slice() : [0, 0, 0], p: S[i].c[0] ? S[i].c[0].pr : 'EARTH' });
      }
      if (RP.trail.length > 1000) RP.trail.splice(0, RP.trail.length - 1000);
      RP.idx = ni;
      RP.fireEvents();
    }
    RP.apply();
    RP.ui();
    if (RP.t >= RP.span) { RP.playing = false; RP.finish(); }
  };

  RP.fireEvents = function () {
    var t = RP.t, i;
    var wl = RP.data.wlog || [];
    for (i = RP.wlogIdx; i < wl.length && wl[i].t <= t; i++) {
      var e = wl[i];
      RP.log(e.tag === 'CRASH' ? 'bad' : 'ok', 'T+' + fmt(e.t) + '  ' + e.text);
      RP.wlogIdx = i + 1;
    }
    var ev = RP.data.events || [];
    for (i = RP.evIdx; i < ev.length && ev[i].t <= t; i++) {
      RP.log('sys', '【' + (ev[i].i + 1) + '/' + (RP.data.events.length) + '】' + ev[i].zh);
      RP.evIdx = i + 1;
    }
  };

  RP.finish = function () {
    var c = app().craft;
    RP.log(c && c.landed ? 'ok' : 'sys',
      '回放结束：' + RP.mission + '（轨迹为离线生成，播放期间未做实时计算）');
    RP.ui();
  };

  // 退出回放 → 回到实时模拟（新开同一任务）
  RP.exit = function () {
    if (!RP.active) return;
    var m = RP.mission;
    RP.active = false; RP.playing = false; RP.data = null;
    app().mode = 'live';
    app().driverExternal = false;
    if (m && app().startMission) app().startMission(m);
    RP.log('sys', '已退出回放，回到实时模拟（手动飞行走真实物理）');
    RP.ui();
  };

  RP.log = function (kind, text) { app().logLine && app().logLine(kind, text); };

  function fmt(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m2 = Math.floor((s % 3600) / 60), q = s % 60;
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return h + ':' + p2(m2) + ':' + p2(q);
  }

  // ------------------------------------------------------------ UI
  RP.ui = function () {
    var bar = document.getElementById('replayBar');
    if (bar) {
      if (RP.active) bar.classList.add('show'); else bar.classList.remove('show');
    }
    var badge = document.getElementById('modeBadge');
    if (badge) {
      var k = RP.active ? 'rp.modeReplay' : 'rp.modeLive';
      badge.dataset.i18n = k;
      badge.textContent = APL.t ? APL.t(k) : k;
      badge.classList.toggle('replay', !!RP.active);
    }
    var tp = document.getElementById('rpTime');
    if (tp) tp.textContent = 'T+' + fmt(RP.t - (RP.t0 || 0)) + ' / ' +
      fmt(RP.span - (RP.t0 || 0));
    var seek = document.getElementById('rpSeek');
    if (seek && RP.span > (RP.t0 || 0) && document.activeElement !== seek) {
      seek.value = String(Math.round((RP.t - (RP.t0 || 0)) / (RP.span - (RP.t0 || 0)) * 1000));
    }
    var sp = document.getElementById('rpSpeedTxt');
    if (sp) sp.textContent = '×' + RP.speed;
    var pb = document.getElementById('rpPlay');
    if (pb) pb.textContent = RP.playing ? '⏸' : '▶';
  };

  // ------------------------------------------------------------ 轨迹清单
  // 启动时拉一次 traj/manifest.json：让任务卡片的【自动演示】按钮知道
  // 哪些任务还没有合格轨迹（没拉到就"放行"，不阻塞任何东西）。
  RP.available = null;
  RP.isAvailable = function (id) {
    if (!RP.available) return true;              // 清单未就绪 → 按可用处理
    return RP.available.indexOf(id) >= 0;
  };
  (function loadManifest() {
    if (!global.fetch) return;
    fetch('traj/manifest.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (m) {
      RP.available = (m && m.available) ? m.available : null;
      // 选择器已经画好且正开着 → 重画一次，把"暂无轨迹"的任务按钮置灰
      try {
        var ml = document.getElementById('missionList');
        if (ml && ml.offsetParent !== null && global.APLApp && APLApp.showMissionPicker) {
          APLApp.showMissionPicker();
        }
      } catch (eR) {}
    }).catch(function () { RP.available = null; });
  })();

  RP.state = RP;
  RP.SPEEDS = SPEEDS;
  APL.Replay = RP;
  global.APLReplay = RP;

})(typeof window !== 'undefined' ? window : globalThis);
