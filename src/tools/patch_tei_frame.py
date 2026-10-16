# -*- coding: utf-8 -*-
# TEI 参照系修正（终版）：
#   旧：vGoal = pre.v + tHat·dv  —— 把**月心系**的 Δv 加到**地心**速度上
#        （两处：bisection 的 periAt 与最终目标）。后果：
#         · 实测目标地心速度 1.638 km/s（当前 0.943）→ 倒退双曲线、远拱 580 万 km
#           （用户报"弹射回宇宙"）；
#   曾试：把目标直接设成返回椭圆的地心速度 0.18 km/s —— 又"修反"：月心系速度
#         只剩 0.83 km/s < 逃逸速度 2.30，飞船根本离不开月球。
#   正确：目标地心速度 = 月球公转速度 + 月心系目标速度
#         vGoal = msP.v + (vrelP + tHat·dv)
#         （dv 由 bisection 针对"地心近地点落入走廊"解出；月心系速度
#           sqrt(v∞²+2μ_m/r) ≈ 2.45 km/s > 逃逸速度 ✓，逃逸渐近线把地心速度
#           降到返回椭圆的速度 ✓）
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()
old = """      var periAt = function (d) {
        var st = integrateSim(world, pre.r, V.add(pre.v, V.mul(tHat, d)), pre.t, tEndP, {});"""
new = """      var periAt = function (d) {
        // ★ 参照系：Δv 在**月心系**，目标地心速度 = 月球公转 + 月心目标
        var vGeoGoal = V.add(V.add(msP.v, vrelP), V.mul(tHat, d));
        var st = integrateSim(world, pre.r, vGeoGoal, pre.t, tEndP, {});"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = """    if (!(vGeo > 0.02)) return { failed: true, reason: 'geom' };
    var vGoal = V.mul(V.unit(A.moonState(pre.t).v), vGeo);   // 沿月球公转方向
    var dvTrue = V.mag(V.sub(vGoal, pre.v));
    if (!(dvTrue > 0.02) || !isFinite(dvTrue)) return { failed: true, reason: 'no-root' };
    if (c.burn && c.burn.active) return { burning: true, tof: 66 * 3600 };
    if (!world.affordable(c, dvTrue)) {
      return { dv: dvTrue, failed: true, noPropellant: true, tof: 66 * 3600 };
    }
    var cut = world.centerBurn(c, c.r, c.v, dvTrue, function () { return vGoal; });"""
new2 = """    // ★ 目标地心速度 = 月球公转速度 + 月心系目标速度（vrelP + tHat·dv）。
    //   月心系速度 ≈ sqrt(v∞² + 2μ_m/r) ≈ 2.45 km/s > 111 km 处逃逸速度
    //   2.30 km/s → 能逃逸；逃逸渐近线把地心速度降到返回椭圆的速度 → 回地球。
    //   （第一版把 Δv 直接加到地心速度上：目标 1.638 km/s → 倒退双曲线；
    //     第二版把目标设成返回椭圆的地心速度 0.18 km/s：月心系 0.83 < 逃逸
    //     速度，离不开月球。两处都实测过，见 tools/test_tei_unit.js。）
    var vGoal = V.add(V.add(msP.v, vrelP), V.mul(tHat, dv));
    var dvTrue = dv;
    if (c.burn && c.burn.active) return { burning: true, tof: 66 * 3600 };
    if (!world.affordable(c, dvTrue)) {
      return { dv: dvTrue, failed: true, noPropellant: true, tof: 66 * 3600 };
    }
    var cut = world.centerBurn(c, c.r, c.v, dvTrue, function () { return vGoal; });"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
