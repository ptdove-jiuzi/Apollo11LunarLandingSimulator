# -*- coding: utf-8 -*-
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = """        // 高度闸门：还没爬到目标高度附近就不许判"残差归零"（否则关机半径
        // 直接变成近地点，近地点永远差着几公里）
        if (Math.abs(f.r ? 0 : 0) === 0 && Math.abs(tgR.r - tgR.rt) > 3000) {
          return Math.max(res, 25);
        }"""
new = """        // 高度闸门：还没爬到目标高度附近就不许判"残差归零"（否则关机半径
        // 直接变成近地点，近地点永远差着几公里）。单位是 km（0.1_km 级别的
        // 量纲错误会让闸门形同虚设 —— 第一版就写成了 3000）。
        if (Math.abs(tgR.r - tgR.rt) > 3) {
          return Math.max(res, 25);
        }"""
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
