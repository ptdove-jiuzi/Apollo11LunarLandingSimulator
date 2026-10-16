# -*- coding: utf-8 -*-
# 地球入轨 VGO 改成"直接瞄准目标停泊轨道"（固定半长轴），而不是
# "远地点到位"的转移椭圆 —— 后者把近地点绑在点火半径上，实测 177×185。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old1 = """    // 地球入轨：目标不是"当前半径的圆速度"，而是「远地点 = targetAlt 的椭圆
    // 在当前半径上的切向速度」。旧写法飞到哪就在哪圆化 —— 恢复真实推力/比冲后
    // 实测入轨停在 172×177 km（真实 183.2×185.9）。换成椭圆目标后，制导会一直
    // 烧到把远地点抬到目标高度，接近目标高度时目标自动退化成圆速度，完成圆化。
    // （与月球上升 vgoMoonTarget 同构，只是 μ 和目标高度不同。）
    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 185.9);
      var aE = (r + rtE) / 2;
      var sE = 2 / r - 1 / aE;"""
new1 = """    // 地球入轨：**直接瞄准目标停泊轨道**（固定半长轴 a = R⊕ + 目标平均高度），
    // 目标速度 = 该椭圆在当前半径上的切向速度 √(μ(2/r − 1/a))。
    //   · 旧写法（当前半径的圆速度）飞到哪就在哪圆化 → 实测 172×177 km；
    //   · 中间的"远地点到位"写法把近地点绑在点火半径上 → 实测 177×185；
    //   · 固定半长轴才是"瞄准 183.2×185.9"的正确表述：飞到目标高度时目标
    //     速度恰为圆速度，残差归零自动关机。
    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 184.55);
      var sE = 2 / r - 1 / rtE;"""
assert s.count(old1) == 1
s = s.replace(old1, new1)
old2 = """    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 185.9);
      var aE = (r + rtE) / 2;
      var sE = 2 / r - 1 / aE;
      if (sE > 0) return V.mag(V.sub(V.mul(tang, Math.sqrt(B.EARTH.mu * sE)), f.vrel)) * 1000;
    }"""
new2 = """    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 184.55);
      var sE = 2 / r - 1 / rtE;      // 与 vgoGuidance 同一目标（固定半长轴）
      if (sE > 0) return V.mag(V.sub(V.mul(tang, Math.sqrt(B.EARTH.mu * sE)), f.vrel)) * 1000;
    }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
old3 = "    this.targetAlt = 185.9;          // 入轨目标高度 km（真实停泊轨道远地点）"
new3 = "    this.targetAlt = 184.55;         // 入轨目标平均高度 km（183.2×185.9 的中值）"
assert s.count(old3) == 1
s = s.replace(old3, new3)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
