# -*- coding: utf-8 -*-
# B1b：网格回到 1/200（粗网格里 3259 的窗口存在），复核预算 36→120 ——
# 实测"最省合格窗口"藏在复核名单的更深位置（加密网格反而改变了名单排序）。
import io
p = 'apollo11/webdata/js/11-demo.js'
s = io.open(p, encoding='utf-8').read()
old1 = """      var FINE_TOFS = [90, 92, 94, 96, 98, 100, 102, 104].map(function (h) { return h * 3600; });
      var fstep = period / 400, fineList = [];
      for (var fk = 0; fk * fstep <= 4 * 3600; fk++) {"""
new1 = """      var FINE_TOFS = [92 * 3600, 96 * 3600, 100 * 3600, 104 * 3600];
      var fstep = period / 200, fineList = [];
      for (var fk = 0; fk * fstep <= 3 * 3600; fk++) {"""
assert s.count(old1) == 1
s = s.replace(old1, new1)
old2 = "      var FINE_TRY = 60, fineBest = null;"
new2 = ("      // 复核预算 36→120：实测最省合格窗口常排在名单中后段（proxy 分数只是\n"
        "      // 两体近似），把预算开大比把网格加密更有效（后者会改变名单排序）。\n"
        "      var FINE_TRY = 120, fineBest = null;")
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
