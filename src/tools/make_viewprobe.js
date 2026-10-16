// 视角探针：验证「4 个目标视图 × 3D/2D 模式」矩阵
//   3D → 拖拽能转（yaw/tilt 生效），且不能残留 2D 的自定义基向量
//   2D → 基向量锁定「当前轨道面」（dot(ez, 轨道法向) ≈ 1），拖拽=平移（不转）
// 另外验证：2D 里转不动，但切回 3D 后原来 yaw/tilt 还在（模式是叠加的）
// 用法：node tools/make_viewprobe.js <项目根> → _viewprobe.html
//   ?m=M4&end=<view>  可让收尾停在某个视图（截图用）
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
  var endView = q('end', '');
  var el = document.createElement('pre');
  el.id = 'probeout'; el.style.display = 'none';
  document.body.appendChild(el);
  function rep(k, v) { el.textContent += '\\n[' + k + '] ' + v; }
  function fmt(v) { return v ? v.map(function (x) { return x.toFixed(3); }).join(',') : '?'; }

  var STEPS = [
    { v: 'system', m: '3d', want: '3D 可转' },
    { v: 'system', m: '2d', want: '2D 锁轨道面' },
    { v: 'earth',  m: '2d', want: '2D 锁轨道面' },
    { v: 'earth',  m: '3d', want: '3D 可转' },
    { v: 'moon',   m: '2d', want: '2D 锁轨道面' },
    { v: 'craft',  m: '2d', want: '2D 锁轨道面' },
    { v: 'craft',  m: '3d', want: '3D 可转' },
    { v: 'system', m: '3d', want: '3D 可转' }
  ];
  var idx = -1, frames = 0, started = false, yawAt2d = null;

  function clickView(v) {
    var b = document.querySelector('.vtab[data-view="' + v + '"]');
    if (b) b.click();
  }
  function clickMode(m) {
    var b = document.getElementById(m === '2d' ? 'btnMode2d' : 'btnMode3d');
    if (b) b.click();
  }
  function runStep() {
    var st = STEPS[idx];
    clickView(st.v); clickMode(st.m);
    // 画一帧：相机基向量是在 renderer.draw() → updateCamera() 里设的
    try { APLApp.renderer.draw(APLApp.world, APLApp.craft); }
    catch (e) { rep('DRAW-ERR', st.v + '/' + st.m + ': ' + ((e && e.stack) || String(e))); return; }
    var r = APLApp.renderer, cam = r.cam, b = cam.basis();
    // yaw 拧 0.6 rad 看基向量动不动
    var y0 = cam.yaw, t0 = cam.tilt;
    cam.yaw = y0 + 0.6; cam.tilt = t0 + 0.3;
    var b2 = cam.basis();
    var turned = Math.hypot(b2.ex[0]-b.ex[0], b2.ex[1]-b.ex[1], b2.ex[2]-b.ex[2]) > 1e-6;
    cam.yaw = y0; cam.tilt = t0;
    // 2D 时检查基向量是不是真的垂直于"当前轨道面"
    var align = '—';
    var c = APLApp.craft, w = APLApp.world;
    if (st.m === '2d' && c) {
      var mst = APL.Astro.moonState(w.t);
      var pc = c.primary === 'MOON' ? mst.r : [0, 0, 0];
      var pv = c.primary === 'MOON' ? mst.v : [0, 0, 0];
      var rel = APL.V.sub(c.r, pc), vrel = APL.V.sub(c.v, pv);
      var n = APL.V.unit(APL.V.cross(rel, vrel));
      var d = b.ez[0]*n[0] + b.ez[1]*n[1] + b.ez[2]*n[2];
      align = 'dot(ez,轨道法向)=' + d.toFixed(6) + ' → 偏离 ' +
        (Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI).toFixed(3) + '°';
    }
    var b3 = document.getElementById('btnMode3d'), b2d = document.getElementById('btnMode2d');
    var okTurn = (st.m === '3d') ? turned : !turned;
    rep('#' + (idx + 1) + ' ' + st.v + '/' + st.m, '期望=' + st.want +
      ' | customBasis=' + (cam.customBasis ? '有' : '无') + ' 可转=' + (turned ? '能' : '不能') +
      ' → ' + (okTurn ? 'OK ✓' : '**不符 ✗**') +
      ' | 按钮 on: 3D=' + b3.classList.contains('on') + ' 2D=' + b2d.classList.contains('on') +
      ' | ' + align);
    if (st.m === '2d') yawAt2d = { v: st.v, yaw: cam.yaw, tilt: cam.tilt };
  }

  var timer = setInterval(function () {
    frames++;
    if (!started) {
      if (!window.APLApp || !APLApp.renderer) return;
      started = true;
      APL.setLang('zh');
      APLApp.startMission(id);
      APLApp.paused = true;
      rep('SETUP', '任务=' + id + ' 缺按钮=' +
        ['btnMode3d', 'btnMode2d'].filter(function (x) { return !document.getElementById(x); }).join(',') );
      return;
    }
    if (frames % 20 === 0) {
      if (idx + 1 < STEPS.length) { idx++; runStep(); }
      else {
        if (endView) { clickView(endView); try { APLApp.renderer.draw(APLApp.world, APLApp.craft); } catch (e) {} }
        rep('PROBE-DONE', '矩阵 ' + STEPS.length + ' 项跑完；' +
          (yawAt2d ? ('2D 时 yaw=' + yawAt2d.yaw.toFixed(3) + '（切回 3D 应保持不变）') : ''));
        clearInterval(timer);
      }
    }
  }, 8);
})();
<\/script>
`;

html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_viewprobe.html'), html);
console.log('wrote', path.join(webdata, '_viewprobe.html'));
