# -*- coding: utf-8 -*-
# TEI 返回走廊：把目标近地点改成可迭代（返回走廊对点火误差极敏感，
# 实测 ±30 m/s → 近地点差几千 km，一次性解算永远压不进 [0.9R_E, R_E+800]）。
#   1) transEarthInjection 增加 opts.tgtPeriKm（默认 R_E+300，走廊中部）；
#   2) 导出 returnPeri(world,c)：返回 6 天外推后的地心近地点；
#   3) 演示 TEI 驱动：每次校验不过就按"实测近地点"折中修正目标再解。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/03-physics.js', [
 ("  function transEarthInjection(world, c, dvKmS) {",
  "  function transEarthInjection(world, c, dvKmS, opts) {"),
 ("""    var tgtPeri = B.EARTH.radius + 30;""",
  """    // 目标近地点可外部迭代（演示的 TEI 修正环）：默认取走廊中部 R_E+300 km。
    var tgtPeri = (opts && opts.tgtPeriKm !== undefined) ? opts.tgtPeriKm : B.EARTH.radius + 300;"""),
 ("  integrateSim: integrateSim, returnIsValid: returnIsValid,",
  """  integrateSim: integrateSim, returnIsValid: returnIsValid,
  // 返回走廊迭代用：6 天外推后的地心近地点（km；null = 没到/被月球抓住）
  returnPeri: function (world, c) {
    var st = integrateSim(world, c.r, c.v, world.t, world.t + 6 * 86400, {});
    if (!st || !isFinite(st.r[0])) return null;
    if (V.dist(st.r, A.moonState(st.t).r) < B.MOON.soi) return null;
    var el = M.elements(B.EARTH.mu, st.r, st.v);
    return (el && isFinite(el.periapsis)) ? el.periapsis : null;
  },"""),
])

patch('apollo11/webdata/js/11-demo.js', [
 # 1) 求解调用带上迭代目标
 ("""            var r = P.transEarthInjection(world(), c, 0.997);
            if (r && r.burning) {""",
  """            var r = P.transEarthInjection(world(), c, 0.997,
              { tgtPeriKm: DEMO.teiTgt || (APL.BODY.EARTH.radius + 300) });
            if (r && r.burning) {"""),
 # 2) 修正分支：按实测近地点折中
 ("""            if (!DEMO.teiValid && DEMO.teiFix < 5) {
              DEMO.teiFix++;
              DEMO.teiStarted = false;
              DEMO.teiChecked = 0;
              DEMO.teiEval = -1e9;
              app().logLine && app().logLine('sys', 'TEI 修正 ' + DEMO.teiFix
                + '/5：当前弹道不在返回走廊上，按实飞状态重解一次');
              return false;
            }""",
  """            if (!DEMO.teiValid && DEMO.teiFix < 5) {
              DEMO.teiFix++;
              DEMO.teiStarted = false;
              DEMO.teiChecked = 0;
              DEMO.teiEval = -1e9;
              // 返回走廊对点火误差极敏感（±30 m/s → 近地点差几千 km），
              // 按**实测**近地点向目标折中，再重解一次。
              if (DEMO.teiTgt === undefined) DEMO.teiTgt = APL.BODY.EARTH.radius + 300;
              var periNow = P.returnPeri(world(), c);
              if (periNow !== null && isFinite(periNow)) {
                DEMO.teiTgt = periNow + (DEMO.teiTgt - periNow) * 0.5;
              }
              app().logLine && app().logLine('sys', 'TEI 修正 ' + DEMO.teiFix
                + '/5：当前弹道不在返回走廊上（实测近地点 '
                + (periNow !== null ? (periNow / 1000).toFixed(0) + ' km' : '?')
                + '）→ 目标改为 ' + (DEMO.teiTgt / 1000).toFixed(0) + ' km 后重解');
              return false;
            }"""),
])
