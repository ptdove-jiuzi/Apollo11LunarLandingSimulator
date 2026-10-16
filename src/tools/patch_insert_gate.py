# -*- coding: utf-8 -*-
# 入轨关机判据：先看"现在关机轨道合格吗"（用密切轨道根数对照停泊轨道窗口）。
# 动机（实测，tools/probe_insert_elem.js）：
#   T+682 起切向速度已到位，但"瞬时半径误差"判据继续驱动径向推力去追
#   椭圆轨道上 ±6.5 km 的 r 振荡 —— T+682→T+780 烧掉 825 m/s，只换来
#   a +0.52 km、e 1.0e-3→6.4e-5（≈8 m/s 的活）⇒ 99% 冲量被浪费、S-IVB 多耗 21.5 t。
#   改成"轨道根数进窗口即关机"后：T+690 的密切轨道已是 178.8×189.4 km
#   （|Δperi|=4.4 ≤5、|Δapo|=3.5 ≤5，闸门合格）→ 关机、省下 21.5 t，
#   直接决定 M5 的 S-IVB 是否够 TLI（缺 871 m/s 的缺口有一大块在这里）。
import io
p = 'apollo11/webdata/js/03-physics.js'
s = io.open(p, encoding='utf-8').read()

old1 = "  var INS_T = 12, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;"
new1 = ("  var INS_T = 12, INS_KD = 2.0, INS_VR = 0.30, INS_H = 0.05;\n"
        "  // 入轨窗口判据：密切轨道的近/远地点与停泊轨道目标之差都 ≤ 该值即关机\n"
        "  //（工具：APL.SITE.parkingPerigee/parkingApogee = 183.2/185.9，闸门 ±5 km）\n"
        "  var INS_GATE = 4.9;")
assert s.count(old1) == 1
s = s.replace(old1, new1)

old2 = """    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) {
        var vrR = V.dot(f.vrel, up);"""
new2 = """    if (c.primary !== 'MOON') {
      var tgR = vgoEarthTarget(world, c, f);
      if (tgR) {
        // ★ 先看"现在关机，轨道合格吗"：用**密切轨道根数**对照停泊轨道窗口，
        //   合格就返回 0（立即关机）。绝不能再用瞬时半径做判据 —— 椭圆轨道上
        //   r 每圈振荡几公里，瞬时量会让制导用径向推力追振荡、白烧 ~99% 冲量。
        var elG = null;
        try { elG = M.elements(B.EARTH.mu, f.rel, f.vrel); } catch (eG) { elG = null; }
        if (elG && isFinite(elG.periapsis) && isFinite(elG.apoapsis)) {
          var periG = elG.periapsis - B.EARTH.radius;
          var apoG = elG.apoapsis - B.EARTH.radius;
          var gateKm = insCfg(world, 'insertGateKm', INS_GATE);
          var tgtP = APL.SITE.parkingPerigee, tgtA = APL.SITE.parkingApogee;
          if (Math.abs(periG - tgtP) <= gateKm && Math.abs(apoG - tgtA) <= gateKm) {
            return 0;
          }
        }
        var vrR = V.dot(f.vrel, up);"""
assert s.count(old2) == 1
s = s.replace(old2, new2)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
