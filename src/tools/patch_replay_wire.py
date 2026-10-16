# -*- coding: utf-8 -*-
# 把回放接进 07-app.js + 09-i18n.js（一次成文、可审计）
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:60], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# ---------- i18n ----------
patch('apollo11/webdata/js/09-i18n.js', [
 ("""      'demo.stop': '停止演示',""",
  """      'demo.stop': '停止演示',
      'rp.label': '轨迹回放',
      'rp.exit': '退出回放',
      'rp.modeLive': '实时模拟',
      'rp.modeReplay': '回放模式·固定样本',"""),
 ("""      'demo.stop': 'Stop demo',""",
  """      'demo.stop': 'Stop demo',
      'rp.label': 'TRAJECTORY REPLAY',
      'rp.exit': 'Exit replay',
      'rp.modeLive': 'LIVE simulation',
      'rp.modeReplay': 'REPLAY - fixed samples',"""),
])

# ---------- 07-app.js ----------
patch('apollo11/webdata/js/07-app.js', [
 # (0) 状态位
 ("""    warpIndex: 0, paused: true, lastFrame: 0, fps: 0,""",
  """    warpIndex: 0, paused: true, lastFrame: 0, fps: 0,
    mode: 'live',            // 'live' 实时物理 / 'replay' 离线轨迹回放
    driverExternal: false,   // 外部固定步长驱动（生成器/回放）接管主循环"""),
 # (a) 主循环：回放分支
 ("""      if (!App.driverExternal && APL.Demo && APL.Demo.isActive()) {
        APL.Demo.tick(simDt > 0 ? simDt : dt);
      }
      updatePrediction();""",
  """      if (!App.driverExternal && APL.Demo && APL.Demo.isActive()) {
        APL.Demo.tick(simDt > 0 ? simDt : dt);
      }
      // 回放模式：只按样本时间插值（不积分、不制导、不耗推进剂）
      if (App.mode === 'replay' && APL.Replay) APL.Replay.tick(dt);
      if (App.mode !== 'replay') updatePrediction();"""),
 # (b) 任务卡片：【自动演示】= 启动离线回放
 ("""      var btnD = el('button', 'demo', TT('mis.demo'));
      btnD.onclick = function () {
        startMission(m.id);
        if (APL.Demo) APL.Demo.start(m.id);
      };""",
  """      var btnD = el('button', 'demo', TT('mis.demo'));
      btnD.onclick = function () {
        startMission(m.id);
        // 自动演示 = 离线轨迹回放（固定样本；不实时求解制导）
        if (APL.Replay) APL.Replay.start(m.id);
        else if (APL.Demo) APL.Demo.start(m.id);
      };"""),
 # (c) 回放控制条
 ("""    // 轨迹预演开关
    var bp = $('btnPredict');""",
  """    // 回放控制条
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
      if (st.data) APL.Replay.seek(parseFloat(rpSeek.value) / 1000 * st.span);
    };
    var rpExit = document.getElementById('rpExit');
    if (rpExit) rpExit.onclick = function () { APL.Replay.exit(); };

    // 轨迹预演开关
    var bp = $('btnPredict');"""),
 # (d) 语言切换时刷新模式徽标
 ("""    window.addEventListener('apollo-lang-changed', function () {""",
  """    window.addEventListener('apollo-lang-changed', function () {
      if (APL.Replay && APL.Replay.ui) APL.Replay.ui();"""),
])

# ---------- 12-replay.js：徽标走 i18n ----------
patch('apollo11/webdata/js/12-replay.js', [
 ("""    var badge = document.getElementById('modeBadge');
    if (badge) {
      badge.textContent = RP.active
        ? (APL.getLang() === 'en' ? 'REPLAY (fixed samples)' : '回放模式（固定样本）')
        : (APL.getLang() === 'en' ? 'LIVE simulation' : '实时模拟');
      badge.classList.toggle('replay', !!RP.active);
    }""",
  """    var badge = document.getElementById('modeBadge');
    if (badge) {
      var k = RP.active ? 'rp.modeReplay' : 'rp.modeLive';
      badge.dataset.i18n = k;
      badge.textContent = APL.t ? APL.t(k) : k;
      badge.classList.toggle('replay', !!RP.active);
    }"""),
])
