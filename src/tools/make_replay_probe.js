// 离线轨迹生成探针：跑某任务的自动演示（**禁用全部演示兜底**），以固定步长
// 驱动真实物理，按需采样并输出 JSON（时间/位置/速度/质量/油门/姿态/级/模块
// 推进剂/事件/飞行日志）。输出写进 <pre id="trajout">。
//
// 用法：
//   node tools/make_replay_probe.js .
//   msedge --headless=old ... --virtual-time-budget=... --dump-dom \
//     "file:///.../webdata/_replay_probe.html?m=M1&n=400000" > dump.html
//   node tools/save_replay.js dump.html M1        # 提取 JSON + 生成偏差报告
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');

const probe = `
<pre id="trajout" style="display:none"></pre>
<script>
(function () {
  function q(k, d) {
    var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : d;
  }
  var id = q('m', 'M1');
  var maxFrames = Number(q('n', '400000'));
  var STEP = 1 / 60;
  var out = document.getElementById('trajout');
  var meta = document.createElement('pre');
  meta.id = 'metainfo'; meta.style.display = 'none';
  document.body.appendChild(meta);
  function rep(k, v) { meta.textContent += '\\n[' + k + '] ' + v; }

  var samples = [], events = [], evlog = [], frames = 0, started = false, lastIdx = -1;
  var r3 = function (x) { return Math.round(x * 1000) / 1000; };       // km，1 m
  var r6 = function (x) { return Math.round(x * 1e6) / 1e6; };         // km/s，mm/s
  var r4 = function (x) { return Math.round(x * 1e4) / 1e4; };

  function snapshot() {
    var w = APLApp.world, cs = [];
    for (var j = 0; j < w.crafts.length; j++) {
      var c = w.crafts[j];
      cs.push({
        id: c.id,
        r: [r3(c.r[0]), r3(c.r[1]), r3(c.r[2])],
        v: [r6(c.v[0]), r6(c.v[1]), r6(c.v[2])],
        m: Math.round(c.mass() * 10) / 10,
        th: Math.round((c.throttle || 0) * 1000) / 1000,
        st: c.stageIndex,
        pr: c.primary,
        at: c.attitude.vec ? [r4(c.attitude.vec[0]), r4(c.attitude.vec[1]), r4(c.attitude.vec[2])] : null,
        mo: c.modules.map(function (m) { return [m.id, Math.round(m.prop)]; }),
        lm: (c.flags && c.flags.isLM) ? 1 : 0,
        ld: c.landed ? 1 : 0, cr: c.crashed ? 1 : 0
      });
    }
    return cs;
  }

  function record(force) {
    var w = APLApp.world;
    var burning = false;
    for (var i = 0; i < w.crafts.length; i++) {
      if ((w.crafts[i].throttle || 0) > 0.001) { burning = true; break; }
    }
    var want = burning ? 1 : 60;               // 点火段 1 s，滑行段 60 s
    var last = samples.length ? samples[samples.length - 1].t : -1e9;
    if (!force && w.t - last < want) return;
    var smp = { t: Math.round(w.t * 100) / 100, c: snapshot() };
    try {
      var hc = APLApp.craft;
      smp.ta = w.targetAlt;
      smp.res = Math.round(APL.Physics.vgoResidual(w, hc) * 10) / 10;
      smp.alt = Math.round((Math.hypot(hc.r[0], hc.r[1], hc.r[2]) - APL.BODY.EARTH.radius) * 1000) / 1000;
    } catch (e) { smp.err = String(e && e.message); }
    samples.push(smp);
  }

  function boot() {
    if (!window.APLApp || !window.APL || !APL.Demo) { rep('FAIL', '引导未完成'); return; }
    try {
      APL.setLang('zh');
      // assist=1 时允许演示兜底（交会归一/收拢、返回兜底、再入摆位）——
      // 用于 M5 全流程演示：前半程（TLI/LOI/着陆/上升）仍是真实物理，
      // 只有演示脚本里那 7 处兜底被放行。默认仍禁用（闸门口径）。
      APL.Demo.state.noAssist = (q('assist', '0') !== '1');   // assist=1 → 放行演示兜底
      APLApp.startMission(id);
      APL.Demo.start(id);
      APL.Demo.state.noAssist = (q('assist', '0') !== '1');   // assist=1 → 放行演示兜底
      APLApp.driverExternal = true;            // 唯一驱动者 = 本探针（固定步长）
      APLApp.paused = true;
      record(true);
      rep('GEN-START', id + ' 步数=' + APL.Demo.state.script.length + ' noAssist=' +
        APL.Demo.state.noAssist);
      started = true;
    } catch (e) { rep('FATAL', (e && e.stack) || String(e)); }
  }

  var timer = setInterval(function () {
    frames++;
    if (!started) { boot(); return; }
    var w = APLApp.world, st = APL.Demo.state;
    try {
      var before = w.t;
      w.advance(STEP);
      var simDt = w.t - before;
      if (APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : STEP);
      // 采集世界事件（主循环的 checkMilestones 被 driverExternal 关掉了，
      // 这里代它消费；事件同时是回放要显示的任务里程碑）
      if (w.events && w.events.length) {
        for (var ei = 0; ei < w.events.length; ei++) {
          var ev = w.events[ei];
          evlog.push({ t: Math.round(w.t * 100) / 100, tag: ev.tag, text: ev.text });
        }
        w.events.length = 0;
      }
      record(false);
      if (st.index !== lastIdx) {
        lastIdx = st.index;
        var sc = st.script[st.index];
        events.push({ t: Math.round(w.t * 100) / 100, i: st.index,
                      zh: sc ? sc.text.zh : '（结束）' });
      }
    } catch (e) { rep('DRIVE-ERR', (e && e.stack) || String(e)); clearInterval(timer); return; }
    if (!APL.Demo.isActive() || frames > maxFrames) {
      record(true);
      rep('GEN-DONE', 'frames=' + frames + ' 样本=' + samples.length +
        ' 事件=' + events.length + ' 结束 t=' + w.t.toFixed(1) +
        ' landed=' + APLApp.craft.landed + ' crashed=' + APLApp.craft.crashed);
      try {
        (APLApp.logs || []).forEach(function (L2) {
          meta.textContent += '\\n[LOG] T+' + Math.round(L2.t) + ' ' + L2.kind + ' ' + L2.text;
        });
      } catch (e) {}
      out.textContent = JSON.stringify({
        mission: id, step: STEP, samples: samples, events: events, wlog: evlog
      });
      rep('JSON-BYTES', out.textContent.length);
      clearInterval(timer);
    }
  }, 4);
})();
<\/script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_replay_probe.html'), html);
console.log('wrote', path.join(webdata, '_replay_probe.html'));
