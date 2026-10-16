# -*- coding: utf-8 -*-
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# 1) bughunt：运行时动态创建的 id（el.id = 'xxx'）不算缺失
patch('tools/bughunt.js', [
 ("""  var missing = Object.keys(ids).filter(function (id) { return !document.getElementById(id); });""",
  """  // 运行期动态创建的 id（代码里有 createElement 后 .id='xxx' 的）不算缺失
  var dyn = {};
  (window.__APOLLO_SRC__ || []).forEach(function (src) {
    var m2, re2 = /\\\\.id\\\\s*=\\\\s*'([A-Za-z0-9_\\\\-]+)'/g;
    while ((m2 = re2.exec(src))) dyn[m2[1]] = true;
  });
  var missing = Object.keys(ids).filter(function (id) {
    return !dyn[id] && !document.getElementById(id);
  });"""),
])

# 2) 12-replay：轨迹时间基可能不从 0 开始（M4 从 362000 s 起）
patch('apollo11/webdata/js/12-replay.js', [
 ("""    RP.span = data.samples[data.samples.length - 1].t;
    RP.t = 0; RP.idx = 0; RP.evIdx = 0; RP.wlogIdx = 0;""",
  """    RP.span = data.samples[data.samples.length - 1].t;
    RP.t0 = data.samples[0].t;               // 轨迹时间基（M4 从 362 000 s 起）
    RP.t = RP.t0; RP.idx = 0; RP.evIdx = 0; RP.wlogIdx = 0;"""),
 ("""  RP.replay = function () { RP.seek(0); RP.play(); };""",
  """  RP.replay = function () { RP.seek(RP.t0 || 0); RP.play(); };"""),
 ("""  RP.seek = function (t) {                    // 拖动 = 直接跳样本时间
    RP.t = Math.max(0, Math.min(RP.span, t));""",
  """  RP.seek = function (t) {                    // 拖动 = 直接跳样本时间
    RP.t = Math.max(RP.t0 || 0, Math.min(RP.span, t));"""),
 ("""    if (seek && RP.span > 0 && document.activeElement !== seek) {
      seek.value = String(Math.round(RP.t / RP.span * 1000));
    }""",
  """    if (seek && RP.span > (RP.t0 || 0) && document.activeElement !== seek) {
      seek.value = String(Math.round((RP.t - (RP.t0 || 0)) / (RP.span - (RP.t0 || 0)) * 1000));
    }"""),
 ("""    var tp = document.getElementById('rpTime');
    if (tp) tp.textContent = 'T+' + fmt(RP.t) + ' / ' + fmt(RP.span);""",
  """    var tp = document.getElementById('rpTime');
    if (tp) tp.textContent = 'T+' + fmt(RP.t - (RP.t0 || 0)) + ' / ' +
      fmt(RP.span - (RP.t0 || 0));"""),
])

# 3) 07-app 的 seek 映射同样按 t0 归一
patch('apollo11/webdata/js/07-app.js', [
 ("""      if (st.data) APL.Replay.seek(parseFloat(rpSeek.value) / 1000 * st.span);""",
  """      if (st.data) {
        APL.Replay.seek((st.t0 || 0) +
          parseFloat(rpSeek.value) / 1000 * (st.span - (st.t0 || 0)));
      }"""),
])

# 4) 审计探针：对比时要用轨迹内的时间点 + 把插值系数夹到 [0,1]
patch('tools/make_replayaudit_probe.js', [
 ("""      RP.seek(100);
      var s1 = heroState();
      RP.seek(20);
      RP.seek(100);
      var s2 = heroState();
      RP.seek(500); RP.seek(30);
      RP.seek(100);
      var s3 = heroState();""",
  """      var S0 = RP.state.data.samples;
      var TQ = S0[Math.floor(S0.length / 2)].t;   // 用轨迹**内部**的时间点
      RP.seek(TQ);
      var s1 = heroState();
      RP.seek(S0[0].t);
      RP.seek(TQ);
      var s2 = heroState();
      RP.seek(S0[Math.floor(S0.length * 0.8)].t);
      RP.seek(RP.state.t0);
      RP.seek(TQ);
      var s3 = heroState();"""),
 ("""      var S = RP.state.data.samples;
      var i = 0; while (i + 1 < S.length && S[i + 1].t <= 100) i++;
      var a = S[i], b = S[i + 1];
      var f = (100 - a.t) / Math.max(1e-9, b.t - a.t);""",
  """      var S = RP.state.data.samples;
      var i = 0; while (i + 1 < S.length && S[i + 1].t <= TQ) i++;
      var a = S[i], b = S[i + 1] || S[i];
      var f = (TQ - a.t) / Math.max(1e-9, b.t - a.t);
      f = Math.max(0, Math.min(1, f));"""),
 ("""      rep('C-SAMPLE', 't=100 状态=' + s1.slice(0, 46) + '…');""",
  """      rep('C-SAMPLE', 't=' + TQ.toFixed(0) + ' 状态=' + s1.slice(0, 46) + '…');"""),
])
