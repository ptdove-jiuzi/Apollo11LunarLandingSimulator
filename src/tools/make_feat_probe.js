// 生成 _feat_probe.html：验证「北极俯视」+「轨道预演」两个新功能
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');
const probe = `
<pre id="featout" style="display:none"></pre>
<script>
(function () {
  function rep(k, v) { document.getElementById('featout').textContent += '\\n[' + k + '] ' + v; }
  var frames = 0;
  var timer = setInterval(function () {
    frames++;
    if (frames === 3) {
      try {
        // 1) 先开任务（有 world 才能开预演）
        APLApp.startMission('M2');
        APLApp.paused = false;
        APLApp.world.warp = 50;
        // 2) 极视切换
        document.getElementById('btnMode2d').click();
        rep('POLAR-BTN', 'clicked, renderer.view=' + APLApp.renderer.view);
        // 3) 预演开关
        document.getElementById('btnPredict').click();
        document.getElementById('btnPredict').click();
        document.getElementById('btnPredict').click();
        rep('PREDICT-BTN', 'showPrediction=' + APLApp.world.showPrediction +
          ' 文案="' + document.getElementById('btnPredict').textContent + '"');
        var cam = APLApp.renderer.cam;
        rep('POLAR-CAM', 'yaw=' + (cam.yaw*180/Math.PI).toFixed(1) + '° tilt=' + (cam.tilt*180/Math.PI).toFixed(1) + '° scale=' + cam.scale.toExponential(2));
      } catch (e) { rep('FATAL', (e && e.stack) || String(e)); }
    }
    // 无头下 rAF 几乎不跑：自己推进物理 + 预演（和真实主循环等价）
    if (APLApp.world && APLApp.world.running && frames > 3) {
      try {
        APLApp.world.advance(1 / 60);
        APLApp.updatePrediction();
        APLApp.renderer.draw(APLApp.world, APLApp.craft);
      } catch (e) { rep('TICK-ERR', (e && e.stack) || String(e)); clearInterval(timer); }
    }
    if (APLApp.world && APLApp.world.showPrediction && frames > 40) {
      var tr = APLApp.world.predTraj;
      if (tr && tr.pts && tr.pts.length > 300) {
        var n = tr.pts.length;
        rep('PRED-TRAJ', 'pts=' + n + ' dt=' + tr.dt.toFixed(1) + 's 跨度=' +
          ((tr.pts[n-1].t - tr.t0) / 60).toFixed(1) + 'min');
        rep('PRED-SPAN', '首点距地心=' + APL.V.mag(tr.pts[0].r).toFixed(0) +
          'km 末点距地心=' + APL.V.mag(tr.pts[n-1].r).toFixed(0) + 'km');
        // 4) 验证预演物理：对比 RK4 外推和实际 advance 的偏差（应该很小）
        var err = APL.V.dist(tr.pts[0].r, APLApp.craft.r);
        rep('PRED-ERR0', '预演首点与当前位置偏差=' + err.toFixed(4) + ' km');
        clearInterval(timer);
        rep('DONE', 'frames=' + frames);
        return;
      }
    }
    if (frames > 900) { rep('TIMEOUT', 'frames=' + frames); clearInterval(timer); }
  }, 4);
})();
<\/script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_feat_probe.html'), html);
console.log('wrote _feat_probe.html');
