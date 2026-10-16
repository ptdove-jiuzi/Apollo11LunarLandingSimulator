// 回放验收探针：
//   A. 回放模式标识（徽标文案 / 控制条可见）
//   B. 播放期间 **零积分**：World.advance 调用数必须为 0，推进剂只来自样本
//   C. 逐值一致：同一 t 反复 seek → 状态必须完全相同（连播两次一致）
//   D. 拖动/倍率/退出：seek 跳样本、倍率只改时间推进、退出回到 live
// 用法：node tools/make_replayaudit_probe.js . → _replayaudit.html
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');

const probe = `
<pre id="rpa" style="display:none"></pre>
<script>
(function () {
  function q(k, d) {
    var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : d;
  }
  var M = q('m', 'M1');
  var el = document.getElementById('rpa');
  function rep(k, v) { el.textContent += '\\n[' + k + '] ' + v; }
  var frames = 0, started = false, advCalls = 0, advSim = 0, results = [];

  function boot() {
    if (!window.APLApp || !APL || !APL.Replay) { rep('FAIL', '引导未完成（12-replay.js 没加载？）'); return; }
    var P = APL.Physics;
    var origAdvance = P.World.prototype.advance;
    var stackLogged = 0;
    // 只统计**回放世界**的积分调用：页面启动自检会在它自己的私有世界 w2 上
    // 跑 700 步烟测，如果按原型统计会把那些也算进来（第一版就误报了）。
    P.World.prototype.advance = function (dt) {
      if (this !== window.__rw) return origAdvance.call(this, dt);
      advCalls++; advSim += dt;
      if (stackLogged < 2 && started) {
        stackLogged++;
        rep('ADV-STACK' + stackLogged, ((new Error()).stack || '').split('\\n').slice(1, 6).join(' <- '));
      }
      return origAdvance.call(this, dt);
    };
    APL.setLang('zh');
    APLApp.startMission(M);
    APL.Replay.start(M, function (ok) {
      started = true;
      window.__rw = APLApp.world;
      rep('LOAD', '轨迹加载=' + ok + (ok ? (' · 样本=' + APL.Replay.state.data.samples.length +
        ' · 时长=' + APL.Replay.state.span.toFixed(0) + ' s') : ''));
      if (!ok) { rep('ABORT', '轨迹缺失，后续检查跳过'); clearInterval(timer); }
    });
  }

  function heroState() {
    var c = APLApp.craft;
    return c ? (c.r.map(function (x) { return x.toFixed(6); }).join(',') + '|' +
      c.v.map(function (x) { return x.toFixed(6); }).join(',') + '|' +
      c.mass().toFixed(3) + '|' + (c.modules[0] ? c.modules[0].prop.toFixed(3) : '')) : 'no-craft';
  }

  var timer = setInterval(function () {
    frames++;
    if (!started) { if (frames === 3) boot(); return; }
    var RP = APL.Replay;

    if (frames === 30) {
      // A. 模式标识
      var bar = document.getElementById('replayBar');
      var badge = document.getElementById('modeBadge');
      rep('A-MODE', '控制条可见=' + (bar && bar.classList.contains('show')) +
        ' 徽标="' + (badge ? badge.textContent : '?') + '"' +
        ' App.mode=' + APLApp.mode + ' driverExternal=' + APLApp.driverExternal);
      rep('A-CTRL', '按钮存在：play=' + !!document.getElementById('rpPlay') +
        ' stop=' + !!document.getElementById('rpStop') + ' replay=' + !!document.getElementById('rpReplay') +
        ' speed±=' + (!!document.getElementById('rpSpeedUp') && !!document.getElementById('rpSpeedDown')) +
        ' seek=' + !!document.getElementById('rpSeek') + ' exit=' + !!document.getElementById('rpExit'));
      var adv0 = advCalls;
      window.__adv0 = adv0;
    }

    if (frames === 200) {
      // B. 播放期间的积分调用数（回放分支不许调 advance）
      rep('B-NOINTEGRATE', '播放 170 帧内 World.advance 调用 = ' + (advCalls - window.__adv0) +
        '（必须为 0）');
      // C. 逐值一致：同一 t 三次 seek
      var S0 = RP.state.data.samples;
      var TQ = S0[Math.floor(S0.length / 2)].t;   // 用轨迹**内部**的时间点
      RP.seek(TQ);
      var s1 = heroState();
      RP.seek(S0[0].t);
      RP.seek(TQ);
      var s2 = heroState();
      RP.seek(S0[Math.floor(S0.length * 0.8)].t);
      RP.seek(RP.state.t0);
      RP.seek(TQ);
      var s3 = heroState();
      rep('C-IDEMPOTENT', (s1 === s2 && s2 === s3) ? '同一 t 三次取状态完全一致 ✓' : '** 不一致 ✗**');
      rep('C-SAMPLE', 't=' + TQ.toFixed(0) + ' 状态=' + s1.slice(0, 46) + '…');
      // 与 JSON 直接插值对照
      var S = RP.state.data.samples;
      var i = 0; while (i + 1 < S.length && S[i + 1].t <= TQ) i++;
      var a = S[i], b = S[i + 1] || S[i];
      var f = (TQ - a.t) / Math.max(1e-9, b.t - a.t);
      f = Math.max(0, Math.min(1, f));
      var want = (a.c[0].r[0] + (b.c[0].r[0] - a.c[0].r[0]) * f).toFixed(6);
      var got = s1.split(',')[0];
      rep('C-VS-JSON', '与样本线性插值对照：样本=' + want + ' 回放=' + got +
        ' → ' + (want === got ? '一致 ✓' : '** 不一致 ✗**'));
    }

    if (frames === 260) {
      // D. 倍率 & 拖动 & 退出
      var sp0 = RP.state.speed;
      RP.cycleSpeed(1); RP.cycleSpeed(1); RP.cycleSpeed(-1);
      rep('D-SPEED', '倍率 ' + sp0 + ' →' + RP.state.speed + '（只改样本时间推进速度）');
      var before = RP.state.t;
      RP.seek(RP.state.span * 0.75);
      rep('D-SEEK', '拖动：t ' + before.toFixed(0) + ' → ' + RP.state.t.toFixed(0) +
        '（直接跳样本时间）');
      var adv1 = advCalls;
      RP.exit();
      var badge2 = document.getElementById('modeBadge');
      rep('D-EXIT', '退出后 App.mode=' + APLApp.mode + ' 徽标="' + (badge2 ? badge2.textContent : '?') +
        '" 控制条隐藏=' + !document.getElementById('replayBar').classList.contains('show'));
      rep('B-TOTAL', '全程 World.advance 调用总数 = ' + advCalls + '（回放自身 0 次；退出时新开任务可能有 0 次）');
      rep('PROBE-DONE', 'frames=' + frames);
      clearInterval(timer);
    }
  }, 8);
})();
<\/script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_replayaudit.html'), html);
console.log('wrote', path.join(webdata, '_replayaudit.html'));
