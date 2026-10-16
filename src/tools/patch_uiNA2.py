# -*- coding: utf-8 -*-
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# 07-app.js：无轨迹 → 按钮置灰 + 说明；点击也再兜一层（理论上 disabled 后点不到）
patch('apollo11/webdata/js/07-app.js', [
 ("""      var btnD = el('button', 'demo', TT('mis.demo'));
      btnD.onclick = function () {
        startMission(m.id);
        // 自动演示 = 离线轨迹回放（固定样本；不实时求解制导）
        if (APL.Replay) APL.Replay.start(m.id);
        else if (APL.Demo) APL.Demo.start(m.id);
      };""",
  """      var btnD = el('button', 'demo', TT('mis.demo'));
      // 轨迹清单（traj/manifest.json）里没有这个任务 → 直接置灰并写明原因：
      // 免得玩家点了才在飞行日志里看到一行红色 404。手动飞行仍然可用。
      var trajReady = !(APL.Replay && APL.Replay.isAvailable && !APL.Replay.isAvailable(m.id));
      if (!trajReady) {
        btnD.disabled = true;
        btnD.textContent = TT('mis.demoNA');
        btnD.title = TT('mis.demoNATip');
      }
      btnD.onclick = function () {
        if (!trajReady) {
          logLine('sys', TT('mis.demoNATip'));
          return;
        }
        startMission(m.id);
        // 自动演示 = 离线轨迹回放（固定样本；不实时求解制导）
        if (APL.Replay) APL.Replay.start(m.id);
        else if (APL.Demo) APL.Demo.start(m.id);
      };"""),
])

# 12-replay.js：清单就绪后，若选择器正开着就重画一次
patch('apollo11/webdata/js/12-replay.js', [
 ("""    }).then(function (m) {
      RP.available = (m && m.available) ? m.available : null;
    }).catch(function () { RP.available = null; });""",
  """    }).then(function (m) {
      RP.available = (m && m.available) ? m.available : null;
      // 选择器已经画好且正开着 → 重画一次，把"暂无轨迹"的任务按钮置灰
      try {
        var ml = document.getElementById('missionList');
        if (ml && ml.offsetParent !== null && global.APLApp && APLApp.showMissionPicker) {
          APLApp.showMissionPicker();
        }
      } catch (eR) {}
    }).catch(function () { RP.available = null; });"""),
])
