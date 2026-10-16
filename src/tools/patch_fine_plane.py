# -*- coding: utf-8 -*-
# 细相位扫描的排序键加入"到达面代价代理"。
# 现状：score = 两体Δv + |v∞−0.87|，**不含面约束代价** —— 于是复核预算（24 个）
# 全花在"两体最省"的窗口上，而它们的到达面往往差 0.5~1.6°（实测日志），
# 真正省油的"面天然含着陆点"的窗口根本进不了复核名单。
# 代理（两体即可算，代价≈0）：
#   面法向 n = unit(r_moon × v2_lambert)，站点方向 s = unit(site − moon)
#   面偏差角 = asin(|n·s|)（站点落在转移面内 → 0）
#   代价代理 ≈ 0.165 km/s per deg（实测 0.65° ↔ 108 m/s）
# 再把复核预算 24 → 36（每次 lunarAimPoint 10~20 s，离线可接受）。
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()

old1 = """          var fdv = V.mag(V.sub(fLb.v1, fst.v));
          var fvInfE = V.mag(V.sub(fLb.v2, ftg.v));
          fineList.push({ tof: ftof, wait: fwait, k: -1, dv: fdv, vInfE: fvInfE,
                          score: fdv + Math.abs(fvInfE - tgtVInf) });"""
new1 = """          var fdv = V.mag(V.sub(fLb.v1, fst.v));
          var fvInfE = V.mag(V.sub(fLb.v2, ftg.v));
          // 到达面代价代理：站点是否落在转移面内（0 = 完全在面内）
          var planeErrDeg = 90;
          try {
            var nT = V.unit(V.cross(ftg.r, fLb.v2));
            var spA = A.moonSurfacePoint(w.t + fwait + ftof,
              APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
            var sHat = V.unit(V.sub(spA.r, ftg.r));
            planeErrDeg = Math.asin(Math.min(1, Math.abs(V.dot(nT, sHat)))) * 180 / Math.PI;
          } catch (eP) { planeErrDeg = 90; }
          fineList.push({ tof: ftof, wait: fwait, k: -1, dv: fdv, vInfE: fvInfE,
                          planeErrDeg: planeErrDeg,
                          score: fdv + Math.abs(fvInfE - tgtVInf) + 0.165 * planeErrDeg });"""
assert s.count(old1) == 1
s = s.replace(old1, new1)

old2 = """      fineList.sort(function (a, b) { return a.score - b.score; });
      var FINE_TRY = 24, fineBest = null;"""
new2 = """      fineList.sort(function (a, b) { return a.score - b.score; });
      if (app().logLine) {
        for (var fq = 0; fq < Math.min(6, fineList.length); fq++) {
          app().logLine('sys', '[FINE] tof=' + (fineList[fq].tof / 3600) + 'h wait='
            + fineList[fq].wait.toFixed(0) + 's dv=' + (fineList[fq].dv * 1000).toFixed(0)
            + 'm/s vInfE=' + fineList[fq].vInfE.toFixed(3) + ' 面偏差='
            + fineList[fq].planeErrDeg.toFixed(2) + '° score=' + fineList[fq].score.toFixed(4));
        }
      }
      var FINE_TRY = 36, fineBest = null;"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
