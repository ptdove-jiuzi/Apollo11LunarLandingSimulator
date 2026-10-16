// 生成一个「自动演示」探针页：把 index.html 复制一份，追加一段脚本，
// 自动开启某个任务的自动演示并跑到结束，把结果写进 #diagout。
// 用无头 Edge 配合 --virtual-time-budget 跑，然后 --dump-dom 抓结果。
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');

const probe = `
<script>
(function () {
  function q(k, d) {
    var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : d;
  }
  var id = q('m', 'M4');
  var maxFrames = Number(q('n', '300000'));
  var lang = q('lang', 'zh');
  var el = document.createElement('pre');
  el.id = 'probeout'; el.style.display = 'none';
  document.body.appendChild(el);
  function rep(k, v) { el.textContent += '\\n[' + k + '] ' + v; }
  var frames = 0, started = false, lastStepIdx = -1;
  var STEP = 1 / 60;

  function boot() {
    if (!window.APLApp || !window.APL || !APL.Demo) { rep('FAIL', '引导未完成'); return; }
    try {
      APL.setLang(lang);
      APLApp.startMission(id);
      APLApp.paused = true;                 // 由探针自己推进物理
      APL.Demo.start(id);
      started = true;
      rep('DEMO-START', id + ' 步骤=' + APL.Demo.state.script.length + ' 语言=' + lang);
    } catch (e) { rep('FATAL', (e && e.stack) || String(e)); }
  }

  var timer = setInterval(function () {
    frames++;
    if (!started) { boot(); return; }
    var w = APLApp.world, st = APL.Demo.state;
    try {
      if (w && w.running) {
        var before = w.t;
        w.advance(STEP);
        var simDt = w.t - before;
        if (APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : STEP);
      }
    } catch (e) { rep('TICK-ERR', (e && e.stack) || String(e)); clearInterval(timer); return; }

    // 降落段：每 25 仿真秒打一行轨迹，便于定位问题
    try {
      var cc = APLApp.craft, ww = APLApp.world;
      if (cc && ww && ww.t - (window.__lastTrk || 0) >= 25) {
        var altK = APL.V.dist(cc.r, APL.Astro.moonState(ww.t).r) - APL.BODY.MOON.radius;
        if (altK < 40) {
          window.__lastTrk = ww.t;
          var spp = APL.Astro.moonSurfacePoint(ww.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0).r;
          var vrel = APL.V.sub(cc.v, APL.Astro.moonState(ww.t).v);
          var up = APL.V.unit(APL.V.sub(cc.r, APL.Astro.moonState(ww.t).r));
          var vv2 = APL.V.dot(vrel, up) * 1000;
          var vh2 = APL.V.mag(APL.V.sub(vrel, APL.V.mul(up, APL.V.dot(vrel, up)))) * 1000;
          rep('TRK', 't=' + ww.t.toFixed(0) + ' alt=' + altK.toFixed(2) + 'km s=' +
            ((APL.V.dist(cc.r, spp) - 0) * 1000).toFixed(0) + 'm vh=' + vh2.toFixed(0) +
            ' vv=' + vv2.toFixed(1) + ' thr=' + (cc.throttleCmd || 0).toFixed(2) + ' land=' + (APL.Demo.state.landing ? 1 : 0) + ' pri=' + cc.primary + ' mode=' + cc.attitude.mode +
            ' prop=' + Math.round((cc.modules[0] || {}).prop || 0));
        }
      }
    } catch (e) {}
    if (st.index !== lastStepIdx) {
      lastStepIdx = st.index;
      var sc = st.script[st.index];
      rep('STEP', '#' + st.index + ' t=' + (w ? w.t.toFixed(0) : '?') + ' warp=' + (w ? w.warp : '?') +
        ' | ' + (sc ? sc.text.zh : '(结束)'));
    }
    if (!APL.Demo.isActive()) {
      var c = APLApp.craft;
      rep('DEMO-END', '完成步骤 ' + st.index + '/' + st.script.length +
        ' | t=' + (w ? w.t.toFixed(0) : '?') +
        ' | landed=' + (c ? c.landed : '?') + ' crashed=' + (c ? c.crashed : '?'));
      if (c) rep('MODULES', c.modules.map(function (m) { return m.id + ':' + Math.round(m.prop); }).join(' '));
      if (c && w) {
        try {
          var sp = APL.Astro.moonSurfacePoint(w.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
          rep('MISS', '落点偏差 ' + (APL.V.dist(c.r, sp.r) * 1000).toFixed(0) + ' m');
        } catch (e) {}
      }
      (window.__APOLLO_DIAG_LINES__ || []).forEach(function (l) {
        if (/ERROR|FATAL|REJECT/.test(l)) rep('ERR', l);
      });
      try {
        var logs = (APLApp.logs || []).slice(-46);
        logs.forEach(function (L2) { rep('LOG', 'T+' + Math.round(L2.t) + ' ' + L2.kind + ' ' + L2.text); });
      } catch (e) { rep('LOG-ERR', String(e)); }
      rep('PROBE-DONE', 'frames=' + frames);
      clearInterval(timer);
      return;
    }
    if (frames > maxFrames) {
      rep('PROBE-TIMEOUT', 'frames=' + frames + ' 停在第' + st.index + '步');
      clearInterval(timer);
    }
  }, 4);
})();
<\/script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_demo_probe.html'), html);
console.log('wrote', path.join(webdata, '_demo_probe.html'));
