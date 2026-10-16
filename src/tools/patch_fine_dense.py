# -*- coding: utf-8 -*-
# B1：细相位扫描加密（不动第一遍）：TOF 4→8 个、相位 1/200→1/400 圈、
# 滑行范围 0~3 h→0~4 h、复核预算 36→60。
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()
old1 = """      var FINE_TOFS = [92 * 3600, 96 * 3600, 100 * 3600, 104 * 3600];
      var fstep = period / 200, fineList = [];
      for (var fk = 0; fk * fstep <= 3 * 3600; fk++) {"""
new1 = """      // 网格加密（第 17 轮）：4→8 个 TOF、1/200→1/400 圈、滑行 0~3 h→0~4 h。
      // 动机：M5 的最省合格窗口在粗网格上是 3259 m/s，而两体下限约 3150 ——
      // 中间那段"面代价小、v∞ 又够"的甜点区需要更细的到达时刻采样才扫得到。
      // 只影响第二遍（第一遍原样保留，M2 靠第一遍通过）。
      var FINE_TOFS = [90, 92, 94, 96, 98, 100, 102, 104].map(function (h) { return h * 3600; });
      var fstep = period / 400, fineList = [];
      for (var fk = 0; fk * fstep <= 4 * 3600; fk++) {"""
assert s.count(old1) == 1
s = s.replace(old1, new1)
old2 = "      var FINE_TRY = 36, fineBest = null;"
new2 = "      var FINE_TRY = 60, fineBest = null;"
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
