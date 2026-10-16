# -*- coding: utf-8 -*-
# ★ TEI 根因修复（用户报"M5 演示里飞船没回地球，被弹射回宇宙"）。
# 旧代码把 Δv 加在**月球系顺行切向**上：vGoal = pre.v + tHat·dv。
#   在该点火点，月球系顺行 ≈ 月球公转的反方向 → 顺行加速 = 地心速度反向加大
#   → 实测目标地心速度 1.638 km/s（当前仅 0.943），远拱 580 万 km、e=0.87 的
#   倒退双曲线 —— 就是"弹射回宇宙"。
# 正确物理（真实 TEI）：目标是**返回椭圆的地心速度**（大小 √(μ·sRet)，
#   方向沿月球公转方向，即转移椭圆在月球距离处的切向），把地心速度从 ~0.93
#   降到 ~0.18 km/s；Δv ≈ 1.0 km/s（真实任务 929~1000 m/s ✓）。
# 求解器里 sRet/vGeo 本来就算对了，只是没被用作目标。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = """    if (!(dv > 0.02) || !isFinite(dv)) return { failed: true, reason: 'no-root' };
    if (c.burn && c.burn.active) return { burning: true, tof: 66 * 3600 };
    if (!world.affordable(c, dv)) {
      return { dv: dv, failed: true, noPropellant: true, tof: 66 * 3600 };
    }
    var vGoal = V.add(pre.v, V.mul(tHat, dv));
    var cut = world.centerBurn(c, c.r, c.v, dv, function () { return vGoal; });"""
new = """    if (!(dv > 0.02) || !isFinite(dv)) return { failed: true, reason: 'no-root' };
    // ★ 目标 = 返回椭圆的**地心**速度，不是"月球系顺行加速"：
    //   sRet/vGeo 在种子段已经算对（vGeo ≈ 0.18 km/s = 把地心速度从当前 ~0.93
    //   降到返回椭圆的速度），方向取月球公转方向（转移椭圆在该点的切向）。
    //   旧写法 vGoal = pre.v + tHat·dv 相当于在月球系里顺行加速，会把飞船
    //   打成倒退双曲线（实测远拱 580 万 km）—— 见 tools/test_tei_unit.js。
    var T2 = estimateBurnSecs(c, dv), pre2 = numericPropagateGeocentric(world, c.r, c.v, T2 / 2, world.t);
    if (pre2 && isFinite(pre2.r[0])) {
      pre = pre2;
      rGeoP = V.mag(pre.r);
      var aRet2 = (rGeoP + tgtPeri) / 2, sRet2 = 2 / rGeoP - 1 / aRet2;
      if (sRet2 > 0) vGeo = Math.sqrt(B.EARTH.mu * sRet2);
    }
    if (!(vGeo > 0.02)) return { failed: true, reason: 'geom' };
    var vGoal = V.mul(V.unit(A.moonState(pre.t).v), vGeo);   // 沿月球公转方向
    var dvTrue = V.mag(V.sub(vGoal, pre.v));
    if (!(dvTrue > 0.02) || !isFinite(dvTrue)) return { failed: true, reason: 'no-root' };
    if (c.burn && c.burn.active) return { burning: true, tof: 66 * 3600 };
    if (!world.affordable(c, dvTrue)) {
      return { dv: dvTrue, failed: true, noPropellant: true, tof: 66 * 3600 };
    }
    var cut = world.centerBurn(c, c.r, c.v, dvTrue, function () { return vGoal; });"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = """    return { dv: dv, burning: true, tof: 66 * 3600 };"""
new2 = """    return { dv: dvTrue, burning: true, tof: 66 * 3600 };"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
