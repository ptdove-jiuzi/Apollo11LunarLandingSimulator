# -*- coding: utf-8 -*-
# A：无轨迹任务的【自动演示】按钮置灰 + 双语词条 + 播放器可用性接口
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# 1) 12-replay.js：加载 manifest + isAvailable()
patch('apollo11/webdata/js/12-replay.js', [
 ("""  RP.state = RP;
  RP.SPEEDS = SPEEDS;""",
  """  // ------------------------------------------------------------ 轨迹清单
  // 启动时拉一次 traj/manifest.json：让任务卡片的【自动演示】按钮知道
  // 哪些任务还没有合格轨迹（没拉到就"放行"，不阻塞任何东西）。
  RP.available = null;
  RP.isAvailable = function (id) {
    if (!RP.available) return true;              // 清单未就绪 → 按可用处理
    return RP.available.indexOf(id) >= 0;
  };
  (function loadManifest() {
    if (!global.fetch) return;
    fetch('traj/manifest.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (m) {
      RP.available = (m && m.available) ? m.available : null;
    }).catch(function () { RP.available = null; });
  })();

  RP.state = RP;
  RP.SPEEDS = SPEEDS;"""),
])

# 2) 09-i18n.js：词条（中英各加 2 条）
patch('apollo11/webdata/js/09-i18n.js', [
 ("""      'rp.modeReplay': '回放模式·固定样本',""",
  """      'rp.modeReplay': '回放模式·固定样本',
      'mis.demoNA': '自动演示（暂无轨迹）',
      'mis.demoNATip': '该任务的离线轨迹还没生成，自动演示暂不可用；手动飞行不受影响',"""),
 ("""      'rp.modeReplay': 'REPLAY - fixed samples',""",
  """      'rp.modeReplay': 'REPLAY - fixed samples',
      'mis.demoNA': 'Auto-demo (no trajectory yet)',
      'mis.demoNATip': 'This mission has no offline trajectory yet, so the auto-demo is unavailable. Manual flight is unaffected.',"""),
])
