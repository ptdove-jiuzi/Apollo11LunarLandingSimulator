# -*- coding: utf-8 -*-
# 入轨径向目标加阻尼（PD）：纯比例项会冲过目标高度（实测 155×209）。
# 同时给关机判据加"高度闸门"：|r−rt|>3 km 时不许关机。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = """    var vTang = Math.sqrt(B.EARTH.mu / rt);
    var vRad = (rt - r) / 40;
    if (vRad > 0.25) vRad = 0.25;
    if (vRad < -0.05) vRad = -0.05;
    return { vDes: V.add(V.mul(tand, vTang), V.mul(up, vRad)), rt: rt, r: r };"""
new = """    var vTang = Math.sqrt(B.EARTH.mu / rt);
    // 径向目标 = 比例项 + 阻尼项（PD）：
    //   纯比例会冲过目标高度（实测 155×209 的椭圆），加 −1.5·v_rad 让爬升在
    //   目标高度前收住 → 关机时 r≈rt、径向速度≈0、切向=圆速度 → 近圆轨道。
    var vrNow = V.dot(f.vrel, up);
    var vRad = (rt - r) / 30 - 1.5 * vrNow;
    if (vRad > 0.30) vRad = 0.30;
    if (vRad < -0.30) vRad = -0.30;
    return { vDes: V.add(V.mul(tand, vTang), V.mul(up, vRad)), rt: rt, r: r };"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = """    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) return V.mag(V.sub(tgR.vDes, f.vrel)) * 1000;
    }"""
new2 = """    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) {
        var res = V.mag(V.sub(tgR.vDes, f.vrel)) * 1000;
        // 高度闸门：还没爬到目标高度附近就不许判"残差归零"（否则关机半径
        // 直接变成近地点，近地点永远差着几公里）
        if (Math.abs(f.r ? 0 : 0) === 0 && Math.abs(tgR.r - tgR.rt) > 3000) {
          return Math.max(res, 25);
        }
        return res;
      }
    }"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
