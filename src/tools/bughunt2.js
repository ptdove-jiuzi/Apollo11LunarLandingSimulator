/* bughunt2.js —— 边界/状态泄漏自检（注入 index.html 运行）
 * 覆盖 make_bughunt_probe 没测的路径：
 *   回放主角、拖尾归属、并发加载竞态、加载中退出、seek 空数据、
 *   2D/3D 反复切换、窗口极小、极端倍率、教程全流程、AGC 随机按键、
 *   回放中切语言、任务反复切换的资源泄漏、面板 NaN。
 * 结果写到 window.__APOLLO_BUGHUNT2__
 */
(function () {
  var out = [], fails = [];
  function rec(tag, ok, msg) {
    out.push((ok ? '  ✓ ' : '  ✗ ') + tag + (msg ? '  → ' + msg : ''));
    if (!ok) fails.push(tag + (msg ? ' (' + msg + ')' : ''));
  }
  function section(t) { out.push('\n=== ' + t + ' ==='); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function RP() { return APL.Replay.state; }
  function W() { return APLApp && APLApp.world; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function craftFinite(c) {
    if (!c) return false;
    var ok = c.r && c.r.length === 3 && c.v && c.v.length === 3;
    for (var i = 0; i < 3; i++) ok = ok && fin(c.r[i]) && fin(c.v[i]);
    var m = c.mass();
    return ok && fin(m) && m > 0;
  }
  function startRP(id) {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(false); } }, 8000);
      APL.Replay.start(id, function (ok) { if (!done) { done = true; clearTimeout(t); res(ok); } });
    });
  }
  function waitApp() {
    return new Promise(function (res) {
      var n = 0;
      (function poll() {
        // 注意：world 在选任务之前是 null，不能把它当成"已启动"的判据
        if (window.APLApp && APLApp.renderer) return res(true);
        if (++n > 400) return res(false);
        setTimeout(poll, 50);
      })();
    });
  }

  async function main() {
    var ok = await waitApp();
    if (!ok) { window.__APOLLO_BUGHUNT2__ = '启动失败'; return; }
    try { var mb = document.getElementById('modalMissions'); if (mb) mb.classList.remove('show'); } catch (e) {}
    // 先建一个世界（world 要选任务后才有）
    if (!APLApp.world) { APLApp.startMission('M1'); await sleep(200); }

    // ---------------------------------------------------------------- 1 回放主角
    section('1. 回放主角选择（M5 月面段应当跟随 LM）');
    try {
      var loaded = await startRP('M5');
      rec('M5 回放加载', loaded);
      if (loaded) {
        RP().pause();
        // M5 的 LM 在 296531~329137 s 存在；310000 s 处于动力下降/月面段
        RP().seek(310000);
        await sleep(120);
        var hero = APLApp.craft;
        var heroId = hero ? hero.id : '(无)';
        rec('M5 月面段主角=LM', heroId === 'LM', '实际=' + heroId);
        var trail = (W() && W().history) || [];
        if (trail.length && hero) {
          var p = trail[trail.length - 1].r, q = hero.r;
          var d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          rec('拖尾末点=主角当前位置', d < 1, '偏差 ' + d.toFixed(2) + ' km');
        } else rec('拖尾存在', false, 'history 长度 ' + trail.length);
        rec('回放态状态量有限', W().crafts.every(craftFinite));
      }
    } catch (e) { rec('回放主角测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 1b 播放穿越下降段
    section('1b. 连续播放穿越下降/着陆段（tick 驱动）');
    try {
      var l2 = await startRP('M5');
      if (l2) {
        RP().pause();
        RP().seek(304000);
        RP().setSpeed(2000);
        RP().play();
        var seenLM = false, seenLanded = false, seenAscent = false;
        for (var it = 0; it < 400 && RP().t < 308600; it++) {
          RP().tick(1 / 60);
          var hc = APLApp.craft;
          if (hc && hc.id === 'LM') seenLM = true;
          if (hc && hc.id === 'LM' && hc.landed) seenLanded = true;
          if (seenLanded && hc && hc.throttle > 0.5) seenAscent = true;
        }
        rec('播放时镜头切到登月舱', seenLM, 't=' + RP().t.toFixed(0));
        rec('播放时识别到着陆（landed）', seenLanded);
        rec('起飞段推力恢复（上升级点火）', seenAscent);
      }
    } catch (e) { rec('播放穿越测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 2 并发加载竞态
    section('2. 并发加载 / 加载中退出');
    try {
      var p1 = startRP('M1');
      var p2 = startRP('M4');
      await Promise.all([p1, p2]);
      await sleep(200);
      rec('连续点两次演示 → 以最后一次为准', RP().mission === 'M4', '实际=' + RP().mission);
    } catch (e) { rec('并发加载未抛异常', false, e.message); }

    try {
      var p3 = startRP('M5');
      APL.Replay.exit();               // 立刻退出（数据还没回来）
      await p3;
      await sleep(300);
      rec('加载中退出后停在实时模式', APLApp.mode === 'live', '实际=' + APLApp.mode);
      var crashed = false;
      try { APL.Replay.seek(123456); } catch (e2) { crashed = true; }
      rec('退出后 seek 不抛异常', !crashed);
    } catch (e) { rec('加载中退出未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 2b 幽灵飞行器
    section('2b. 回放回退（拖动进度条往回拖）');
    try {
      var lok = await startRP('M5');
      if (lok) {
        RP().pause();
        RP().seek(310000); await sleep(120);
        var nWithLM = W().crafts.length;
        var idsWithLM = W().crafts.map(function (c) { return c.id; }).join(',');
        RP().seek(0); await sleep(120);
        var idsBack = W().crafts.map(function (c) { return c.id; }).join(',');
        rec('回退到起飞段后 LM 不残留', idsBack.indexOf('LM') < 0,
          '月面段=' + idsWithLM + ' → 回退后=' + idsBack + '（' + nWithLM + ' 个）');
      }
    } catch (e) { rec('回退测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 2c 回放中开始新任务
    section('2c. 回放中点【开始任务】');
    try {
      await startRP('M5');
      await sleep(150);
      APLApp.startMission('M1');
      await sleep(400);
      rec('新任务后回到实时模式', APLApp.mode === 'live', '实际=' + APLApp.mode);
      rec('新任务后不再由回放驱动', APLApp.driverExternal !== true, 'driverExternal=' + APLApp.driverExternal);
      rec('回放数据已释放', !RP().data, 'data=' + (RP().data ? RP().mission : 'null'));
      var t0 = W().t;
      W().running = true; APLApp.paused = false; W().warp = 100;
      for (var q2 = 0; q2 < 60; q2++) W().advance(1 / 60);
      rec('新任务时间可推进（物理未被冻住）', W().t > t0 + 30, (W().t - t0).toFixed(1) + ' s');
    } catch (e) { rec('回放中开始任务未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 3 视图切换
    section('3. 2D / 3D 反复切换与相机状态');
    try {
      var cam = APLApp.renderer.cam;
      for (var i = 0; i < 12; i++) {
        APLApp.setViewMode('2d'); APLApp.renderer.draw(W(), APLApp.craft);
        APLApp.setViewMode('3d'); APLApp.renderer.draw(W(), APLApp.craft);
      }
      rec('停在 3D 时 customBasis 已清空', !cam.customBasis, '实际=' + JSON.stringify(cam.customBasis));
      rec('停在 3D 时 polarAxis 已清空', !cam.polarAxis);
    } catch (e) { rec('视图切换未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 4 极小窗口
    section('4. 窗口尺寸（极小 / 奇数）');
    try {
      var cv = document.getElementById('sky');
      var host = cv.parentElement;
      var oldW = host.style.width, oldH = host.style.height;
      host.style.width = '333px'; host.style.height = '177px';
      APLApp.renderer.resize(); APLApp.renderer.draw(W(), APLApp.craft);
      rec('333×177 容器下绘制未抛异常', true, cv.width + '×' + cv.height);
      rec('画布跟上了容器尺寸', Math.abs(cv.width - 333 * (window.devicePixelRatio || 1)) < 3,
        'canvas=' + cv.width + ' 期望≈' + Math.round(333 * (window.devicePixelRatio || 1)));
      host.style.width = '1367px'; host.style.height = '769px';
      APLApp.renderer.resize(); APLApp.renderer.draw(W(), APLApp.craft);
      rec('1367×769 下绘制未抛异常', true, cv.width + '×' + cv.height);
      host.style.width = oldW; host.style.height = oldH;
      APLApp.renderer.resize();
    } catch (e) { rec('窗口尺寸测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 5 极端倍率
    section('5. 实时物理：极端倍率与长跑');
    try {
      APLApp.startMission('M1');
      await sleep(80);
      var w = W();
      w.running = true; w.warp = 100000;
      for (var k = 0; k < 900; k++) w.advance(1 / 60);
      rec('warp=1e5 跑 900 帧状态有限', w.crafts.every(craftFinite),
        't=' + (w.t / 3600).toFixed(1) + ' h');
      rec('warp=1e5 时时间正常推进', fin(w.t) && w.t > 0, 't=' + w.t.toFixed(1));
    } catch (e) { rec('极端倍率未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 6 任务切换泄漏
    section('6. 任务反复切换（资源泄漏）');
    try {
      var counts = [];
      ['M1', 'M2', 'M3', 'M4', 'M5'].forEach(function (id) {
        for (var n = 0; n < 3; n++) { APLApp.startMission(id); counts.push(W().crafts.length); }
      });
      var maxc = Math.max.apply(null, counts);
      rec('反复切任务后飞行器数量不失控', maxc <= 3, '最大 ' + maxc + '（序列 ' + counts.join(',') + '）');
      rec('切任务后状态量有限', W().crafts.every(craftFinite));
    } catch (e) { rec('任务切换未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 7 教程全流程
    section('7. 教程所有课程走到底');
    try {
      var Tut = APL.Tutorial;
      var tracks = ['quick', 'nav', 'mission'];
      var tutBad = [];
      for (var ti = 0; ti < tracks.length; ti++) {
        var id = tracks[ti];
        try {
          Tut.start(id);
          var guard = 0;
          while (Tut.active && guard++ < 200) Tut.go((Tut.index || 0) + 1);
          if (Tut.active) tutBad.push(id + ' 未结束');
        } catch (e3) { tutBad.push(id + ' 抛异常 ' + e3.message); }
      }
      rec('三门课程均可走完', tutBad.length === 0, tutBad.join('; '));
      Tut.stop();
    } catch (e) { rec('教程测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 8 AGC 随机按键
    section('8. AGC/DSKY 随机按键');
    try {
      var keys = ['0','1','2','3','4','5','6','7','8','9','VERB','NOUN','ENTER','CLR','PRO'];
      var agcBad = 0, sample = null;
      var dsky = APLApp.agc && APLApp.agc.dsky;
      rec('DSKY 对象可用', !!dsky);
      for (var a = 0; a < 400 && dsky; a++) {
        var kk = keys[(a * 7 + 3) % keys.length];
        try { dsky.press(kk); } catch (e4) { agcBad++; sample = e4.message; }
      }
      rec('400 次随机按键无异常', agcBad === 0, agcBad ? agcBad + ' 次: ' + sample : '');
      var d = dsky && dsky.display ? dsky.display() : null;
      var dispOk = d && typeof d === 'object';
      if (dispOk) {
        var badVal = Object.keys(d).filter(function (k5) {
          var v = d[k5];
          return typeof v === 'string' && /NaN|Infinity|undefined/.test(v);
        });
        rec('DSKY 显示无 NaN/undefined', badVal.length === 0, badVal.join(','));
      } else rec('DSKY display() 可用', false);
    } catch (e) { rec('AGC 测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 9 回放中切语言
    section('9. 回放中切换语言 + 面板 NaN');
    try {
      await startRP('M2');
      await sleep(200);
      for (var L2 = 0; L2 < 3; L2++) { APL.setLang('en'); await sleep(60); APL.setLang('zh'); await sleep(60); }
      var body = document.body.innerText || '';
      var raw = body.match(/\b(ui|btn|tab|log|hud)\.[a-zA-Z][a-zA-Z0-9_]*\b/g);
      rec('界面无未翻译 key 泄漏', !raw, raw ? raw.slice(0, 5).join(',') : '');
      rec('面板无 NaN/Infinity', !/NaN|Infinity/.test(body));
      var panels = ['tMass', 'tAlt', 'tVel', 'tApo', 'tPeri'];
      var empty = panels.filter(function (id6) {
        var el = document.getElementById(id6);
        return el && (!el.textContent || !el.textContent.trim());
      });
      rec('关键遥测面板非空', empty.length === 0, empty.join(','));
    } catch (e) { rec('切语言测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 10 存档 / 读档
    section('10. 存档 / 读档');
    try {
      // a) 回放中读档 → 必须回到实时，且物理能推进
      await startRP('M5');
      await sleep(200);
      document.getElementById('btnSave').click();
      await sleep(150);
      document.getElementById('btnLoad').click();
      await sleep(600);
      rec('回放中读档后回到实时模式', APLApp.mode === 'live', '实际=' + APLApp.mode);
      rec('读档后回放数据已释放', !RP().data, 'data=' + (RP().data ? RP().mission : 'null'));
      var t1 = W().t, adv2 = false;
      APLApp.paused = false;
      if (!APLApp.driverExternal) {
        for (var k6 = 0; k6 < 60; k6++) W().advance(1 / 60);
        adv2 = W().t > t1 + 0.5;               // 倍率可能被存档恢复成 1×
      }
      rec('读档后物理可推进', adv2, (W().t - t1).toFixed(2) + ' s（倍率 ' + (W().warp || 1) + '×）');
    } catch (e) { rec('回放中读档未抛异常', false, e.message); }

    try {
      // b) 分离后存档 → 读档要恢复"另一台飞行器"的引用
      APLApp.startMission('M3');
      await sleep(150);
      document.getElementById('btnUndock').click();
      await sleep(200);
      var ids2 = W().crafts.map(function (c) { return c.id; });
      rec('M3 分离后有两台飞行器', ids2.length === 2, ids2.join(','));
      W().warp = 1000;
      document.getElementById('btnSave').click();
      await sleep(150);
      document.getElementById('btnLoad').click();
      await sleep(700);
      rec('读档恢复倍率', W().warp === 1000, '实际=' + W().warp + '×');
      rec('读档后 App.lm 已恢复', !!APLApp.lm, 'lm=' + (APLApp.lm ? APLApp.lm.id : 'null'));
      var sw = false;
      try { sw = APLApp.switchCraft(); } catch (e5) { sw = false; }
      rec('读档后【切换飞行器】可用', sw === true);
    } catch (e) { rec('分离存档测试未抛异常', false, e.message); }

    // ---------------------------------------------------------------- 11 收尾
    try { APL.Replay.exit(); } catch (e) {}
    section('汇总');
    out.push(fails.length ? ('✗ ' + fails.length + ' 项失败：' + fails.join(' | ')) : '★ 全部通过');
    window.__APOLLO_BUGHUNT2__ = out.join('\n');
  }

  main();
})();
