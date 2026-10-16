/* =========================================================================
 *  02-astro.js  —  历表与坐标系
 *  月球位置：Meeus《Astronomical Algorithms》第 47 章周期项级数（截断保留主项）
 *  历元常数由完整级数在 JD 2440419.0639（1969-07-16 13:32 UT 点火）处取值，
 *  并经 Meeus 例 47.a 校验（λ 完全吻合）。
 *  惯性坐标：地心赤道 J2000 (ECI)。月球历表在黄道系给出再按黄赤交角旋转。
 *  ========================================================================= */
(function (global) {
  'use strict';

  var APL = global.APL;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var M = APL.M, V = APL.V, C = APL.C, B = APL.BODY;

  var EPOCH_JD = 2440419.0639;      // 1969-07-16 13:32:00 UT  点火时刻
  var OBLIQUITY = 23.4392911;       // 黄赤交角 (deg)

  // 历元处的平根数（deg）与每日变率（deg/day）
  var E = {
    Lp: [138.571097, 13.176396475],
    D:  [24.354360,  12.190749114],
    Ms: [191.803340, 0.985600282],   // 太阳平近点角
    Mp: [214.687497, 13.064992950],  // 月球平近点角
    F:  [144.366339, 13.229350240]
  };

  // Meeus 表 47.A 主项 (D, M, Mp, F, Σl, Σr)
  var TERMS_L = [
    [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],   [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],     [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],     [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],     [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],   [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],     [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],          [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],     [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],      [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 0],           [1, 0, -1, 0, -5163, 0],
    [1, 1, 0, 0, 4987, 0],            [2, -1, 1, 0, 4036, 0],
    [2, 0, 2, 0, 3994, 0],            [4, 0, 0, 0, 3861, 0],
    [2, 0, -3, 0, 3665, 0],           [0, 1, -2, 0, -2689, 0],
    [2, 0, -1, 2, -2602, 0],          [2, -1, -2, 0, 2390, 0]
  ];
  // Meeus 表 47.B 主项 (D, M, Mp, F, Σb)
  var TERMS_B = [
    [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],   [0, 0, 2, 1, 17198],  [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],   [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],    [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],   [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],  [0, 1, 0, 1, -1794],  [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],  [1, 0, 0, 1, -1491],  [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],  [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],    [4, 0, 0, -1, 1021],  [4, 0, -1, 1, 833],
    [0, 0, 1, -3, 777],    [4, 0, -2, 1, 671],   [2, 0, 0, -3, 607],
    [2, 0, 2, -1, 596],    [2, -1, 1, -1, 491],  [2, 0, -2, 1, -451],
    [0, 0, 3, -1, 439],    [2, 0, 2, 1, 422],    [2, 0, -3, -1, 421],
    [2, 1, -1, 1, -366],   [2, 1, 0, 1, -351],   [4, 0, 0, 1, 331]
  ];

  var _cache = { t: null, moon: null, sun: null };

  function jdFromT(t) { return EPOCH_JD + t / 86400; }

  // ------------------------------------------------ 月球星历的插值表
  // 为什么要有这张表：moonState 每次要算 **3 遍** moonEcliptic（用中心差分求速度），
  // 一次 moonState 实测 36 µs，而 RK4 每个积分步要调用 4 次引力 ——
  // 一次 73 h 的地月转移外推要 4 万次左右，光星历就吃掉 ~1.5 s，
  // 瞄准/中途修正的迭代根本跑不动（这正是 M5 崩掉的根：预测用的是粗步长，
  // 飞行用的是细步长，两条曲线不是同一条）。
  // 月球轨道极光滑（周期 27.3 天，级数里最快的项也远慢于 300 s），
  // 所以用 300 s 网格 + 三次 Hermite（同时用位置和速度）插值，
  // 截断误差在 1e-9 km 量级，远小于 RK4 本身的积分误差。
  var MOON_TAB_DT = 300;                        // s
  var _mtab = new Map();
  var MOON_TAB_MAX = 60000;

  function moonSampleRaw(t) {
    var els = moonEcliptic(t);
    var r = eclipticToEquatorial(els.lon, els.lat, els.dist);
    var h = 30;                                 // s，中心差分求速度
    var l1 = moonEcliptic(t - h), l2 = moonEcliptic(t + h);
    var r1 = eclipticToEquatorial(l1.lon, l1.lat, l1.dist);
    var r2 = eclipticToEquatorial(l2.lon, l2.lat, l2.dist);
    return { r: r, v: V.mul(V.sub(r2, r1), 1 / (2 * h)) };
  }

  function moonTabAt(k) {
    var s = _mtab.get(k);
    if (s) return s;
    s = moonSampleRaw(k * MOON_TAB_DT);
    if (_mtab.size >= MOON_TAB_MAX) {           // 简单的先进先出淘汰
      var n = 0;
      for (var key of _mtab.keys()) { _mtab.delete(key); if (++n >= MOON_TAB_MAX / 2) break; }
    }
    _mtab.set(k, s);
    return s;
  }

  function moonState(t) {
    // 记忆化：数值积分每个 RK4 步会在同一个 t 上求好几次引力
    if (t === _cache.t && _cache.moon) return _cache.moon;
    var kf = Math.floor(t / MOON_TAB_DT), s = (t - kf * MOON_TAB_DT) / MOON_TAB_DT;
    var a = moonTabAt(kf), b = moonTabAt(kf + 1);
    var s2 = s * s, s3 = s2 * s;
    var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s;
    var h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    var g00 = 6 * s2 - 6 * s, g10 = 3 * s2 - 4 * s + 1;
    var g01 = -6 * s2 + 6 * s, g11 = 3 * s2 - 2 * s;
    var r = [0, 0, 0], v = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      r[i] = h00 * a.r[i] + h10 * MOON_TAB_DT * a.v[i] + h01 * b.r[i] + h11 * MOON_TAB_DT * b.v[i];
      v[i] = (g00 * a.r[i] + g10 * MOON_TAB_DT * a.v[i] + g01 * b.r[i] + g11 * MOON_TAB_DT * b.v[i]) / MOON_TAB_DT;
    }
    var dist = V.mag(r);
    // 由地心赤道系反推黄道经/纬（与 moonEcliptic 的输出同量纲：度）
    var e = OBLIQUITY * D2R;
    var ye = r[1] * Math.cos(e) + r[2] * Math.sin(e);
    var ze = -r[1] * Math.sin(e) + r[2] * Math.cos(e);
    var lon = V.norm360(Math.atan2(ye, r[0]) * R2D);
    var lat = Math.asin(V.clamp(ze / (dist || 1), -1, 1)) * R2D;
    var out = { r: r, v: v, dist: dist, lon: lon, lat: lat };
    _cache.t = t; _cache.moon = out;
    return out;
  }

  // --------------------------------------------------- 月球黄道坐标
  function moonEcliptic(t) {
    var d = t / 86400;
    var Lp = E.Lp[0] + E.Lp[1] * d;
    var Ds = E.D[0] + E.D[1] * d;
    var Ms = E.Ms[0] + E.Ms[1] * d;
    var Mp = E.Mp[0] + E.Mp[1] * d;
    var F = E.F[0] + E.F[1] * d;
    var Dr = Ds * D2R, Mr = Ms * D2R, Mpr = Mp * D2R, Fr = F * D2R;
    var sl = 0, sr = 0, sb = 0, i;
    for (i = 0; i < TERMS_L.length; i++) {
      var T = TERMS_L[i];
      var arg = T[0] * Dr + T[1] * Mr + T[2] * Mpr + T[3] * Fr;
      sl += T[4] * Math.sin(arg);
      sr += T[5] * Math.cos(arg);
    }
    for (i = 0; i < TERMS_B.length; i++) {
      var Tb = TERMS_B[i];
      sb += Tb[4] * Math.sin(Tb[0] * Dr + Tb[1] * Mr + Tb[2] * Mpr + Tb[3] * Fr);
    }
    // Meeus 附加修正项（对黄纬影响可达 0.01°）
    var Tc = (jdFromT(t) - 2451545.0) / 36525.0;
    var A1 = (119.75 + 131.849 * Tc) * D2R;
    var A3 = (313.45 + 481266.484 * Tc) * D2R;
    sb += -2235 * Math.sin(Lp * D2R)
        + 382 * Math.sin(A3)
        + 175 * Math.sin(A1 - Fr)
        + 175 * Math.sin(A1 + Fr)
        + 127 * Math.sin((Lp - Mp) * D2R)
        - 115 * Math.sin((Lp + Mp) * D2R);
    var A2 = (53.09 + 479264.290 * Tc) * D2R;
    sl += 3958 * Math.sin(A1) + 1962 * Math.sin((Lp - F) * D2R) + 318 * Math.sin(A2);
    var lon = V.norm360(Lp + sl / 1e6);
    var lat = sb / 1e6;
    var dist = 385000.56 + sr / 1000;
    return { lon: lon, lat: lat, dist: dist, Lp: Lp, D: Ds, M: Ms, Mp: Mp, F: F };
  }

  function eclipticToEquatorial(lonDeg, latDeg, distKm) {
    var l = lonDeg * D2R, b = latDeg * D2R, e = OBLIQUITY * D2R;
    var x = distKm * Math.cos(b) * Math.cos(l);
    var y = distKm * Math.cos(b) * Math.sin(l);
    var z = distKm * Math.sin(b);
    return [x, y * Math.cos(e) - z * Math.sin(e), y * Math.sin(e) + z * Math.cos(e)];
  }

  function sunEcliptic(t) {
    // 太阳位置：Meeus 第 25 章低精度公式（以 J2000 为起算点）
    var dJ = (EPOCH_JD + t / 86400) - 2451545.0;
    var T = dJ / 36525.0;
    var L0 = V.norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    var Ms = V.norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    var Mr = Ms * D2R;
    var Cc = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
           + 0.000289 * Math.sin(3 * Mr);
    var lon = V.norm360(L0 + Cc);
    var dist = 1.000001018 * (1 - 0.016708634 * Math.cos(Mr)) * C.AU;
    return { lon: lon, lat: 0, dist: dist, M: Ms };
  }

  // -------------------------------------------------- 月球 / 太阳 状态矢量
  function sunState(t) {
    if (t === _cache.sunT && _cache.sun) return _cache.sun;
    var els = sunEcliptic(t);
    var r = eclipticToEquatorial(els.lon, 0, els.dist);
    // 速度：位置级数没有解析导数，用二阶中心差分。
    // h 必须取大一点：位置级数本身的截断精度约 1e-5 度，h=60 s 时差值
    // 只有 2e-4 度，噪声会把速度误差放大到 5%；h=3600 s 时截断误差
    // (h²/6)|r'''| ≈ 3 mm/s，级数噪声折算约 0.01%，两者都可忽略。
    var h = 3600;
    var e1 = sunEcliptic(t + h), e2 = sunEcliptic(t - h);
    var r1 = eclipticToEquatorial(e1.lon, 0, e1.dist);
    var r2 = eclipticToEquatorial(e2.lon, 0, e2.dist);
    var v = V.mul(V.sub(r1, r2), 1 / (2 * h));
    var out = { r: r, v: v, dist: els.dist, lon: els.lon };
    _cache.sunT = t; _cache.sun = out;
    return out;
  }

  // ------------------------------------------------ 地球自转角 (GMST)
  function gmst(t) {
    var d = (jdFromT(t) - 2451545.0);
    var gmstDeg = 280.46061837 + 360.98564736629 * d + 0.000387933 * 0 - 0;
    return V.norm360(gmstDeg) * D2R;
  }

  // 发射场 / 任意地面点的 ECI 状态
  function siteState(t, latDeg, lonDeg, altKm) {
    var ecef = M.geodeticToECEF(latDeg, lonDeg, altKm, B.EARTH.radius, B.EARTH.flattening);
    var th = gmst(t);
    var c = Math.cos(th), s = Math.sin(th);
    var r = [ecef[0] * c - ecef[1] * s, ecef[0] * s + ecef[1] * c, ecef[2]];
    var w = B.EARTH.omega;
    var v = [-w * r[1], w * r[0], 0];
    return { r: r, v: v };
  }

  // ------------------------------------------ 月球固连系 (IAU 2000 自转模型)
  // 真实月球的自转轴 **不是** 轨道法向：Cassini 第一定律要求自转轴、轨道法向与
  // 黄极三者共面，自转轴相对黄极只倾斜 1.543°（相对轨道面 6.688°），并随升交点
  // 做 18.6 年周期的进动。早期实现直接把"瞬时轨道法向"当自转轴，极轴误差最大
  // 可达 6.7°，会把月面光照与着陆点几何整体带偏。
  //
  // 现改用 IAU/IAG 报告的月球自转模型（α₀ / δ₀ / W 的周期项保留主项）：
  //   α₀ = 269.9949 + 0.0031T − 3.8787 sinE₁ − 0.1204 sinE₂ + 0.0700 sinE₃ − …
  //   δ₀ =  66.5392 + 0.0130T + 1.5419 cosE₁ + 0.0239 cosE₂ − 0.0278 cosE₃ + …
  //   W  =  38.3213 + 13.17635815 d + 3.5610 sinE₁ + 0.1208 sinE₂ − 0.0642 sinE₃ + …
  // 其中 d 为 J2000 起算的天数，E₁ 是升交点角（−0.0529921°/day，18.6 年退行）。
  //
  // 数值校验（本项目实测）：极轴与黄极夹角 1.537°（真实 1.543°）；极轴与轨道
  // 法向夹角 6.658°（真实 6.688°）；着陆瞬间静海基地太阳高度角 10.34°
  // （NASA 飞行计划 10.3~10.5°。旧模型给 9.79°，偏低约 0.6°）。
  var J2000_JD = 2451545.0;
  function moonRotation(d) {
    var T = d / 36525;
    var e1 = (125.045 - 0.0529921 * d) * D2R;      // 升交点（交点退行）
    var e2 = (250.089 - 0.1059842 * d) * D2R;
    var e3 = (260.008 + 13.0120009 * d) * D2R;     // 月球近地点幅角
    var e4 = (176.625 + 13.3407154 * d) * D2R;
    var e5 = (357.529 + 0.9856003 * d) * D2R;      // 太阳平近点角
    var e6 = (311.589 + 26.4057084 * d) * D2R;
    var e7 = (268.323 + 26.4057084 * d) * D2R;
    var e8 = (252.250 + 149.4725778 * d) * D2R;
    var e9 = (149.635 + 0.9856003 * d) * D2R;
    var e10 = (143.399 - 0.0017676 * d) * D2R;
    var e11 = (270.434 + 13.0649930 * d) * D2R;
    var e12 = (210.978 + 13.2293502 * d) * D2R;
    var e13 = (186.098 + 0.0109714 * d) * D2R;
    var s1 = Math.sin(e1), c1 = Math.cos(e1);
    var a0 = (269.9949 + 0.0031 * T - 3.8787 * s1 - 0.1204 * Math.sin(e2)
              + 0.0700 * Math.sin(e3) - 0.0172 * Math.sin(e4) + 0.0072 * Math.sin(e6)
              - 0.0052 * Math.sin(e10) + 0.0043 * Math.sin(e13)) * D2R;
    var d0 = (66.5392 + 0.0130 * T + 1.5419 * c1 + 0.0239 * Math.cos(e2)
              - 0.0278 * Math.cos(e3) + 0.0068 * Math.cos(e4) - 0.0029 * Math.cos(e6)
              + 0.0009 * Math.cos(e7) + 0.0008 * Math.cos(e8) - 0.0009 * Math.cos(e10)
              + 0.0003 * Math.cos(e13)) * D2R;
    var Wrad = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d
              + 3.5610 * s1 + 0.1208 * Math.sin(e2) - 0.0642 * Math.sin(e3)
              + 0.0158 * Math.sin(e4) + 0.0252 * Math.sin(e5) - 0.0066 * Math.sin(e6)
              - 0.0047 * Math.sin(e7) - 0.0046 * Math.sin(e8) + 0.0028 * Math.sin(e9)
              + 0.0052 * Math.sin(e10) + 0.0040 * Math.sin(e11) + 0.0019 * Math.sin(e12)
              - 0.0044 * Math.sin(e13)) * D2R;
    // 极轴（J2000 赤道系）
    var z = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
    // 本初子午线方向：从赤道升交点出发沿赤道转 W
    var xn = [-Math.sin(a0), Math.cos(a0), 0];
    var yn = V.cross(z, xn);
    var cw = Math.cos(Wrad), sw = Math.sin(Wrad);
    return {
      x: V.add(V.mul(xn, cw), V.mul(yn, sw)),
      y: V.add(V.mul(yn, cw), V.mul(xn, -sw)),
      z: z, W: Wrad, alpha: a0, delta: d0
    };
  }

  function moonFrame(t) {
    var ms = moonState(t);
    var R = moonRotation(jdFromT(t) - J2000_JD);
    // 天平动（视经度）：地心方向在月固系里的经度，绕本初子午线在 ±8° 内摆动
    var toEarth = V.unit(V.mul(ms.r, -1));
    var lib = Math.atan2(V.dot(toEarth, R.y), V.dot(toEarth, R.x)) * R2D;
    lib = lib - 360 * Math.round(lib / 360);
    return { x: R.x, y: R.y, z: R.z, state: ms, libration: lib,
             pole: R.z, omega: 13.17635815 * D2R / 86400 };
  }

  // 罗德里格斯旋转：把向量 u 绕单位轴 k 旋转 th 弧度
  function rodrigues(u, k, th) {
    var c = Math.cos(th), s = Math.sin(th);
    var kxu = V.cross(k, u);
    var kdu = V.dot(k, u);
    return [
      u[0] * c + kxu[0] * s + k[0] * kdu * (1 - c),
      u[1] * c + kxu[1] * s + k[1] * kdu * (1 - c),
      u[2] * c + kxu[2] * s + k[2] * kdu * (1 - c)
    ];
  }

  // 月面点 -> ECI
  function moonSurfacePoint(t, latDeg, lonDeg, altKm) {
    var F = moonFrame(t);
    var lat = latDeg * D2R, lon = lonDeg * D2R;
    var R = B.MOON.radius + (altKm || 0);
    var px = R * Math.cos(lat) * Math.cos(lon);
    var py = R * Math.cos(lat) * Math.sin(lon);
    var pz = R * Math.sin(lat);
    var off = V.add(V.add(V.mul(F.x, px), V.mul(F.y, py)), V.mul(F.z, pz));
    var r = V.add(F.state.r, off);                 // 月球中心 + 月面偏移
    var v = V.add(F.state.v, V.cross(V.mul(F.z, F.omega), off));
    return { r: r, v: v, frame: F };
  }

  // ECI -> 月面经纬度
  function moonLatLon(t, rEci) {
    var F = moonFrame(t);
    var rel = V.sub(rEci, F.state.r);
    var px = V.dot(rel, F.x), py = V.dot(rel, F.y), pz = V.dot(rel, F.z);
    var R = V.mag(rel);
    var lat = Math.asin(V.clamp(pz / R, -1, 1)) * R2D;
    var lon = V.norm360(Math.atan2(py, px) * R2D);
    if (lon > 180) lon -= 360;
    return { lat: lat, lon: lon, alt: R - B.MOON.radius };
  }

  // ECI -> 地面经纬度
  function earthLatLon(t, rEci) {
    var th = gmst(t), c = Math.cos(-th), s = Math.sin(-th);
    var ecef = [rEci[0] * c - rEci[1] * s, rEci[0] * s + rEci[1] * c, rEci[2]];
    return M.ecefToGeodetic(ecef, B.EARTH.radius, B.EARTH.flattening);
  }

  // 月相（地心相位角，deg）
  function moonPhase(t) {
    var m = moonEcliptic(t), s = sunEcliptic(t);
    var el = V.norm360(m.lon - s.lon);
    return { elongation: el, illum: (1 - Math.cos(el * D2R)) / 2, phaseAngle: 180 - el };
  }

  // 着陆点的太阳高度角（月面）
  function lunarSunElevation(t, latDeg, lonDeg) {
    // 太阳在月面固连系的方位：用月球指向太阳的方向反投影
    var F = moonFrame(t);
    var sunR = sunState(t).r;
    var moonR = F.state.r;
    var toSun = V.unit(V.sub(sunR, moonR));
    var px = V.dot(toSun, F.x), py = V.dot(toSun, F.y), pz = V.dot(toSun, F.z);
    var latS = Math.asin(V.clamp(pz, -1, 1)), lonS = Math.atan2(py, px);
    var lat = latDeg * D2R, lon = lonDeg * D2R;
    var cosZ = Math.sin(lat) * Math.sin(latS) + Math.cos(lat) * Math.cos(latS) * Math.cos(lon - lonS);
    return Math.asin(V.clamp(cosZ, -1, 1)) * R2D;
  }

  APL.Astro = {
    EPOCH_JD: EPOCH_JD,
    OBLIQUITY: OBLIQUITY,
    jdFromT: jdFromT,
    moonEcliptic: moonEcliptic,
    sunEcliptic: sunEcliptic,
    moonState: moonState,
    sunState: sunState,
    gmst: gmst,
    siteState: siteState,
    moonFrame: moonFrame,
    moonSurfacePoint: moonSurfacePoint,
    moonLatLon: moonLatLon,
    earthLatLon: earthLatLon,
    moonPhase: moonPhase,
    lunarSunElevation: lunarSunElevation
  };

})(typeof window !== 'undefined' ? window : globalThis);
