// 探针：自动演示进行中「按 + / − 改倍率」会发生什么？
// 1) 记录 Demo.stop 的调用来源（打 stack）；2) 让玩家在演示中途真的点 #btnWarpUp；
// 3) 观察 isActive / world.warp / App.warpIndex / userWarp / 限幅提示 / 横幅状态。
// 用法：node tools/make_warpprobe.js <项目根>  → 生成 _warpprobe.html
// 无头 Edge：--headless=new --virtual-time-budget=... --dump-dom file:///.../_warpprobe.html?m=M4
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
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
  var maxFrames = Number(q('n', '200000'));
  var pressAt = q('press', '');
  var pressList = pressAt ? pressAt.split(',').map(Number) : [];
  var pressDir = q('dir', 'up');
  var el = document.createElement('pre');
  el.id = 'probeout'; el.style.display = 'none';
  document.body.appendChild(el);
  function rep(k, v) { el.textContent += '\\n[' + k + '] ' + v; }
  var frames = 0, started = false, lastStepIdx = -1, lastActive = true, lastNote = '';
  var STEP = 1 / 60, pressDone = {};

  window.addEventListener('error', function (e) {
    rep('WINERR', (e && e.message) + ' @' + (e && e.filename) + ':' + (e && e.lineno));
  });

  function boot() {
    if (!window.APLApp || !window.APL || !APL.Demo) { rep('FAIL', '引导未完成'); return; }
    try {
      APL.setLang('zh');
      APLApp.startMission(id);
      APLApp.paused = true;                 // 由探针自己推进物理
      APL.Demo.start(id);
      var realStop = APL.Demo.stop;
      APL.Demo.stop = function (reason) {
        var st = APL.Demo.state;
        var stack = (new Error().stack || '').split('\\n').slice(1, 5).join(' <- ');
        rep('STOPPED', 'reason=' + reason + ' 步骤=' + st.index + '/' + st.script.length +
          ' t=' + (APLApp.world ? APLApp.world.t.toFixed(0) : '?') +
          ' warp=' + (APLApp.world ? APLApp.world.warp : '?') +
          ' warpIndex=' + APLApp.warpIndex + ' paused=' + APLApp.paused);
        rep('STACK', stack);
        return realStop.apply(this, arguments);
      };
      started = true;
      rep('DEMO-START', id + ' 步骤=' + APL.Demo.state.script.length +
        ' 初始 warp=' + APLApp.world.warp + ' warpIndex=' + APLApp.warpIndex);
    } catch (e) { rep('FATAL', (e && e.stack) || String(e)); }
  }

  function bannerState() {
    var b = document.getElementById('demoBar');
    var t = document.getElementById('demoText');
    var no = document.getElementById('demoNote');
    var ds = document.getElementById('demoStop');
    return 'class="' + (b ? b.className : '?') + '" 步骤文本="' + (t ? t.textContent : '') +
      '" 提示="' + (no ? no.textContent : '') + '" 按钮="' + (ds ? ds.textContent : '') + '"';
  }

  var timer = setInterval(function () {
    frames++;
    if (!started) { boot(); return; }
    var w = APLApp.world, st = APL.Demo.state;

    pressList.forEach(function (f, i) {
      if (frames === f + 10 && !pressDone[i]) {
        pressDone[i] = 1;
        var bid = pressDir === 'up' ? 'btnWarpUp' : 'btnWarpDown';
        var btn = document.getElementById(bid);
        var bw = w ? w.warp : 0;
        if (btn) btn.click();
        rep('PRESS', '帧' + frames + ' [' + bid + '] warp ' + bw + '→' + (w ? w.warp : 0) +
          ' (warpIndex=' + APLApp.warpIndex + ') 演示中=' + APL.Demo.isActive() +
          ' userWarp=' + st.userWarp);
      }
    });

    try {
      if (w && w.running) {
        var before = w.t;
        w.advance(STEP);
        var simDt = w.t - before;
        if (APL.Demo.isActive()) APL.Demo.tick(simDt > 0 ? simDt : STEP);
      }
    } catch (e) { rep('TICK-ERR', (e && e.stack) || String(e)); clearInterval(timer); return; }

    var act = APL.Demo.isActive();
    if (act !== lastActive) {
      rep('ACTIVE-CHG', '帧' + frames + ' 演示 ' + lastActive + '→' + act +
        ' warp=' + (w ? w.warp : '?') + ' | ' + bannerState());
      lastActive = act;
    }
    var noteNow = st.stepNote ? st.stepNote.zh : '';
    if (noteNow !== lastNote) {
      lastNote = noteNow;
      rep('NOTE', '帧' + frames + ' 「' + noteNow + '」');
    }

    if (st.index !== lastStepIdx) {
      lastStepIdx = st.index;
      var sc = st.script[st.index];
      rep('STEP', '#' + st.index + ' t=' + (w ? w.t.toFixed(0) : '?') + ' warp=' + (w ? w.warp : '?') +
        ' | ' + (sc ? sc.text.zh : '(结束)'));
    }

    if (!APL.Demo.isActive() || frames > maxFrames) {
      rep('PROBE-DONE', 'frames=' + frames + ' 最终步骤=' + st.index + '/' + st.script.length +
        ' warp=' + (w ? w.warp : '?'));
      rep('BANNER', bannerState());
      var c = APLApp.craft;
      if (c) {
        rep('CRAFT', 'landed=' + c.landed + ' crashed=' + c.crashed +
          ' 模块=' + c.modules.map(function (m) { return m.id + ':' + Math.round(m.prop); }).join(' '));
        if (w) {
          try {
            var sp = APL.Astro.moonSurfacePoint(w.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
            rep('MISS', '与静海基地距离 ' + (APL.V.dist(c.r, sp.r) * 1000).toFixed(0) + ' m');
          } catch (e) {}
        }
      }
      try {
        (APLApp.logs || []).slice(-26).forEach(function (L2) {
          rep('LOG', 'T+' + Math.round(L2.t) + ' ' + L2.kind + ' ' + L2.text);
        });
      } catch (e) {}
      clearInterval(timer);
    }
  }, 4);
})();
<\/script>
`;

html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_warpprobe.html'), html);
console.log('wrote', path.join(webdata, '_warpprobe.html'));
