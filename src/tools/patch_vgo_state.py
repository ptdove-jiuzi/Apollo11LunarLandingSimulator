# -*- coding: utf-8 -*-
# 地球入轨制导改成"瞄准目标轨道状态"：切向目标 = 目标高度的圆速度，
# 径向目标 = 把剩余爬升高度在 tau 秒内消化掉。这样关机点必然落在目标高度附近，
# 而不是"速度够了就关"（关机半径就是近地点 → 实测近地点永远 177 km）。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()

# 1) 插入共用目标函数
anchor = "  function vgoGuidance(world, c, f, nrm) {"
helper = """  // 地球入轨的目标状态（vgoGuidance 与 vgoResidual 必须用同一套，否则
  // 关机判据会在还没爬到目标高度时就归零）：
  //   切向目标 = 目标高度的圆速度 √(μ/r_t)
  //   径向目标 = (r_t − r)/40，限幅在 [−0.05, +0.25] km/s
  // 物理含义：不是"速度够了就关机"，而是"把飞船导到目标轨道状态" ——
  // 真实土星五号的 S-IVB 入轨制导也是这个思路。旧写法（只比切向圆速度）
  // 在 177 km 就满足残差判据，而关机半径就是近地点 → 近地点永远压不上去。
  function vgoEarthTarget(world, c, f) {
    var r = V.mag(f.rel);
    if (r < 1) return null;
    var rt = B.EARTH.radius + (world.targetAlt || 184.55);
    var up = V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    var hz = V.mag(h) > 1e-9 ? V.unit(h) : [0, 0, 1];
    var tand = V.unit(V.cross(hz, up));
    var vTang = Math.sqrt(B.EARTH.mu / rt);
    var vRad = (rt - r) / 40;
    if (vRad > 0.25) vRad = 0.25;
    if (vRad < -0.05) vRad = -0.05;
    return { vDes: V.add(V.mul(tand, vTang), V.mul(up, vRad)), rt: rt, r: r };
  }

"""
assert s.count(anchor) == 1
s = s.replace(anchor, helper + anchor)

# 2) vgoGuidance 用新目标
old1 = """    // 地球入轨：**直接瞄准目标停泊轨道**（固定半长轴 a = R⊕ + 目标平均高度），
    // 目标速度 = 该椭圆在当前半径上的切向速度 √(μ(2/r − 1/a))。
    //   · 旧写法（当前半径的圆速度）飞到哪就在哪圆化 → 实测 172×177 km；
    //   · 中间的"远地点到位"写法把近地点绑在点火半径上 → 实测 177×185；
    //   · 固定半长轴才是"瞄准 183.2×185.9"的正确表述：飞到目标高度时目标
    //     速度恰为圆速度，残差归零自动关机。
    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 184.55);
      var sE = 2 / r - 1 / rtE;
      if (sE > 0) {
        var vDesE = V.mul(tang, Math.sqrt(B.EARTH.mu * sE));
        var dvE = V.sub(vDesE, f.vrel);
        if (V.mag(dvE) < 1e-6) return c.attitude.vec;
        return V.unit(dvE);
      }
    }"""
new1 = """    // 地球入轨：瞄准目标轨道状态（见 vgoEarthTarget）
    if (c.primary !== 'MOON') {
      var tgE = vgoEarthTarget(world, c, f);
      if (tgE) {
        var dvE = V.sub(tgE.vDes, f.vrel);
        if (V.mag(dvE) < 1e-6) return c.attitude.vec;
        return V.unit(dvE);
      }
    }"""
assert s.count(old1) == 1
s = s.replace(old1, new1)

# 3) vgoResidual 用同一目标
old2 = """    // 与 vgoGuidance 保持同一套目标（否则关机判据会在还没抬到目标高度时就归零）
    if (c.primary !== 'MOON') {
      var rtE = B.EARTH.radius + (world.targetAlt || 184.55);
      var sE = 2 / r - 1 / rtE;      // 与 vgoGuidance 同一目标（固定半长轴）
      if (sE > 0) return V.mag(V.sub(V.mul(tang, Math.sqrt(B.EARTH.mu * sE)), f.vrel)) * 1000;
    }"""
new2 = """    // 与 vgoGuidance 同一套目标（切向圆速度 + 径向爬升项）
    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) return V.mag(V.sub(tgR.vDes, f.vrel)) * 1000;
    }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)

io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
