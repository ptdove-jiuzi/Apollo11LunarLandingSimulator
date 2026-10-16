// 渲染探针：验证「轨道面俯视」的新相机基向量 + drawBody 实心球，并抓出渲染路径上的异常。
// 用法：node tools/make_render_probe.js <项目根> → 生成 _render_probe.html
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
  var view = q('view', 'earth');
  var mode = q('mode', '3d');            // 3d | 2d（2D = 垂直轨道面俯视）
  var el = document.createElement('pre');
  el.id = 'probeout'; el.style.display = 'none';
  document.body.appendChild(el);
  function rep(k, v) { el.textContent += '\\n[' + k + '] ' + v; }
  window.addEventListener('error', function (e) {
    rep('WINERR', 'msg=' + (e && e.message) + ' err=' + (e && e.error ? (e.error.stack || e.error.message) : 'null'));
  });
  var frames = 0, rafCount = 0, started = false;
  var _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { rafCount++; return _raf(cb); };

  var timer = setInterval(function () {
    frames++;
    if (!started) {
      if (!window.APLApp || !APLApp.renderer) return;
      started = true;
      try {
        APL.setLang('zh');
        APLApp.startMission(id);
        APLApp.paused = true;
        var vt = document.querySelector('.vtab[data-view="' + view + '"]');
        if (vt) vt.click();
        var mb = document.getElementById(mode === '2d' ? 'btnMode2d' : 'btnMode3d');
        if (mb) mb.click();
        var sk = document.getElementById('frhSkip');     // 关掉首启提示，截图干净点
        if (sk) sk.click();
        rep('SETUP', '任务=' + id + ' 视图=' + APLApp.renderer.view + ' 模式=' +
          APLApp.renderer.mode + ' rAF请求数=' + rafCount);
      } catch (e) { rep('FATAL', (e && e.stack) || String(e)); }
      return;
    }
    try {
      var w = APLApp.world, c = APLApp.craft;
      w.advance(1 / 60);
      var cam = APLApp.renderer.cam;
      APLApp.renderer.draw(w, c);
      if (frames === 20 || frames === 60) {
        rep('RAF', '帧' + frames + ' rAF 请求数=' + rafCount + '（>1 说明无头下 rAF 也在跑）');
        var b = cam.basis();
        var primaryC = c.primary === 'MOON' ? APL.Astro.moonState(w.t).r : [0, 0, 0];
        var primaryV = c.primary === 'MOON' ? APL.Astro.moonState(w.t).v : [0, 0, 0];
        var rel = APL.V.sub(c.r, primaryC), vrel = APL.V.sub(c.v, primaryV);
        var n = APL.V.unit(APL.V.cross(rel, vrel));
        rep('BASIS', 'customBasis=' + (cam.customBasis ? '有' : '无') +
          ' polarAxis=' + cam.polarAxis +
          ' |ez|=1 → ' + b.ez.map(function (x) { return x.toFixed(4); }).join(','));
        rep('NORMAL', 'n(轨道法向)    → ' + n.map(function (x) { return x.toFixed(4); }).join(','));
        var dotN = b.ez[0]*n[0] + b.ez[1]*n[1] + b.ez[2]*n[2];
        rep('ALIGN', 'dot(ez, n) = ' + dotN.toFixed(6) + ' → 视线偏离轨道法向 ' +
          (Math.acos(Math.max(-1, Math.min(1, dotN))) * 180 / Math.PI).toFixed(3) + '°');
        // 轨道面内投影：rel 在 ez 上的分量应≈0（说明"俯视轨道面"，图像是正投影）
        var relDotEz = APL.V.dot(rel, b.ez);
        rep('INPLANE', 'rel·ez = ' + relDotEz.toFixed(3) + ' km (应≈0)  屏幕半径=' +
          (APL.V.mag(rel) * cam.scale).toFixed(1) + 'px  球半径=' +
          (APL.BODY.MOON.radius * cam.scale).toFixed(1) + 'px');
        rep('SCREEN', 'earth=' + JSON.stringify(APLApp.renderer._bodyScreen.earth) +
          ' moon=' + JSON.stringify(APLApp.renderer._bodyScreen.moon));
        // 轨道形状：把 8 个轨道点投到屏幕上，量长短轴比（正投影下应等于 (1+e)/(1-e)）
        var o = c.orbitRelative(c.primary, w);
        var ell = [];
        for (var k = 0; k < 36; k++) {
          var nu = k / 36 * Math.PI * 2;
          var rr = o.p / (1 + o.e * Math.cos(nu));
          var cosO = Math.cos(o.raan), sinO = Math.sin(o.raan);
          var ci = Math.cos(o.i), si = Math.sin(o.i);
          var wA = o.argp + nu;
          var u = [Math.cos(wA), Math.sin(wA), 0];
          // 从轨道平面基转到 ECI（i, RAAN）
          var q1 = [u[0]*cosO - u[1]*sinO*ci, u[0]*sinO + u[1]*cosO*ci, u[1]*si];
          ell.push(APL.V.add(primaryC, APL.V.mul(q1, rr)));
        }
        var px = ell.map(function (p) { return cam.project(p); });
        var cx = px.reduce(function (a, p) { return a + p[0]; }, 0) / px.length;
        var cy = px.reduce(function (a, p) { return a + p[1]; }, 0) / px.length;
        var d = px.map(function (p) { return Math.hypot(p[0]-cx, p[1]-cy); });
        rep('ELLIPSE', '屏幕长短半径比 = ' + (Math.max.apply(null, d) / Math.max(1, Math.min.apply(null, d))).toFixed(4) +
          ' | 理论 (1+e)/(1-e) = ' + ((1 + o.e) / Math.max(1e-9, 1 - o.e)).toFixed(4) + '  (e=' + o.e.toFixed(4) + ')');
      }
    } catch (e) { rep('DRAW-ERR', (e && e.stack) || String(e)); clearInterval(timer); return; }
    if (frames > 90) { rep('DONE', 'frames=' + frames + ' view=' + APLApp.renderer.view); clearInterval(timer); }
  }, 8);
})();
<\/script>
`;

html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_render_probe.html'), html);
console.log('wrote', path.join(webdata, '_render_probe.html'));
