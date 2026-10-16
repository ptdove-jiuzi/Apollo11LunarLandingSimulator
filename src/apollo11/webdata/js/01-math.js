/* =========================================================================
 *  01-math.js  —  矢量 / 二体问题 / 开普勒方程 / 兰伯特问题 / 数值积分
 *  算法依据：Vallado《Fundamentals of Astrodynamics and Applications》
 *            通用变量传播 (universal variable formulation) 与经典兰伯特求解。
 *  ========================================================================= */
(function (global) {
  'use strict';

  var APL = global.APL || (global.APL = {});
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ------------------------------------------------------------------ 矢量
  function v(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }
  function mag(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function mag2(a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }
  function dist(a, b) { return mag(sub(a, b)); }
  function unit(a) { var m = mag(a); return m > 1e-15 ? mul(a, 1 / m) : v(0, 0, 0); }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function scaleAdd(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
  function angleBetween(a, b) {
    var c = dot(a, b) / (mag(a) * mag(b));
    return Math.acos(Math.max(-1, Math.min(1, c)));
  }
  function rotX(a, th) {
    var c = Math.cos(th), s = Math.sin(th);
    return [a[0], a[1] * c - a[2] * s, a[1] * s + a[2] * c];
  }
  function rotY(a, th) {
    var c = Math.cos(th), s = Math.sin(th);
    return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
  }
  function rotZ(a, th) {
    var c = Math.cos(th), s = Math.sin(th);
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c, a[2]];
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function norm2pi(x) { x = x % (2 * Math.PI); return x < 0 ? x + 2 * Math.PI : x; }

  // -------------------------------------------------------- Stumpff 函数
  function stumpffC(z) {
    if (z > 1e-6) { var s = Math.sqrt(z); return (1 - Math.cos(s)) / z; }
    if (z < -1e-6) { var t = Math.sqrt(-z); return (Math.cosh(t) - 1) / (-z); }
    return 0.5 - z / 24 + z * z / 720 - z * z * z / 40320;
  }
  function stumpffS(z) {
    if (z > 1e-6) { var s = Math.sqrt(z); return (s - Math.sin(s)) / (z * s); }
    if (z < -1e-6) { var t = Math.sqrt(-z); return (Math.sinh(t) - t) / (t * t * t) * -1 * -1; }
    return 1 / 6 - z / 120 + z * z / 5040 - z * z * z / 362880;
  }
  // 修正负数分支（等价写法，避免符号出错）
  function S(z) {
    if (z > 1e-6) { var s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
    if (z < -1e-6) { var t = Math.sqrt(-z); return (Math.sinh(t) - t) / (t * t * t); }
    return 1 / 6 - z / 120 + z * z / 5040 - z * z * z / 362880;
  }

  // ------------------------------------------------ 开普勒方程 (椭圆/双曲)
  function solveKeplerElliptic(M, e) {
    M = norm2pi(M);
    var E = e < 0.8 ? M : Math.PI;
    for (var i = 0; i < 80; i++) {
      var f = E - e * Math.sin(E) - M;
      var fp = 1 - e * Math.cos(E);
      var d = f / fp;
      E -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    return E;
  }
  function solveKeplerHyperbolic(M, e) {
    var H = Math.log(2 * Math.abs(M) / e + 1.8) * (M < 0 ? -1 : 1);
    if (!isFinite(H)) H = M;
    for (var i = 0; i < 120; i++) {
      var f = e * Math.sinh(H) - H - M;
      var fp = e * Math.cosh(H) - 1;
      var d = f / fp;
      H -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    return H;
  }

  // -------------------------------------------- 状态 -> 轨道根数 (由 mu, r, v)
  function elements(mu, r, vv) {
    var rmag = mag(r), vmag = mag(vv);
    var h = cross(r, vv), hmag = mag(h);
    var n = cross([0, 0, 1], h), nmag = mag(n);
    // 偏心率矢量 e = [ (v^2 - mu/r) r - (r·v) v ] / mu
    var rv = dot(r, vv);
    var evec = mul(sub(mul(r, (vmag * vmag - mu / rmag)), mul(vv, rv)), 1 / mu);
    var e = mag(evec);
    var energy = vmag * vmag / 2 - mu / rmag;
    var a = Math.abs(energy) > 1e-14 ? -mu / (2 * energy) : Infinity;
    var inc = Math.acos(clamp(h[2] / hmag, -1, 1));
    var raan = nmag > 1e-12 ? Math.atan2(n[1], n[0]) : 0;
    var argp = nmag > 1e-12 ? Math.acos(clamp(dot(n, evec) / (nmag * e), -1, 1)) : 0;
    if (evec[2] < 0) argp = 2 * Math.PI - argp;
    var nu = Math.acos(clamp(dot(evec, r) / (e * rmag), -1, 1));
    if (dot(r, vv) < 0) nu = 2 * Math.PI - nu;
    var p = hmag * hmag / mu;
    var perigee = p / (1 + e) - (0);
    var apogee = e < 1 ? p / (1 - e) : Infinity;
    var period = (e < 1) ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;
    return {
      a: a, e: e, i: inc, raan: norm2pi(raan), argp: norm2pi(argp), nu: norm2pi(nu),
      p: p, energy: energy, h: hmag,
      periapsis: a * (1 - e), apoapsis: e < 1 ? a * (1 + e) : Infinity,
      period: period, rmag: rmag, vmag: vmag,
      evec: evec, hvec: h
    };
  }

  // -------------------------------------------- 轨道根数 -> 状态
  function stateFromElements(mu, el) {
    var a = el.a, e = el.e, i = el.i, O = el.raan, w = el.argp, nu = el.nu;
    var p = a * (1 - e * e);
    var r = p / (1 + e * Math.cos(nu));
    var rp = [r * Math.cos(nu), r * Math.sin(nu), 0];
    var vp = [-Math.sqrt(mu / p) * Math.sin(nu), Math.sqrt(mu / p) * (e + Math.cos(nu)), 0];
    var cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w);
    var ci = Math.cos(i), si = Math.sin(i);
    var R = [
      [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
      [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
      [sw * si, cw * si, ci]
    ];
    function apply(m, x) {
      return [m[0][0] * x[0] + m[0][1] * x[1] + m[0][2] * x[2],
              m[1][0] * x[0] + m[1][1] * x[1] + m[1][2] * x[2],
              m[2][0] * x[0] + m[2][1] * x[1] + m[2][2] * x[2]];
    }
    return { r: apply(R, rp), v: apply(R, vp) };
  }

  // --------------------------------- 通用变量二体传播 (适用于椭圆/抛物/双曲)
  function propagate(mu, r0, v0, dt) {
    var r0m = mag(r0), v0m = mag(v0);
    var vr0 = dot(r0, v0) / r0m;
    var alpha = 2 / r0m - v0m * v0m / mu;
    var sqrtMu = Math.sqrt(mu);
    var chi;
    if (alpha > 1e-9) chi = sqrtMu * dt * alpha;      // 椭圆
    else if (alpha < -1e-9) chi = Math.sign(dt) * Math.sqrt(-1 / alpha) *
      Math.log((-2 * mu * alpha * dt) / (dot(r0, v0) + Math.sign(dt) * Math.sqrt(-mu / alpha) * (1 - r0m * alpha)));
    else chi = sqrtMu * dt / r0m;                     // 抛物
    if (!isFinite(chi)) chi = sqrtMu * dt / r0m;

    var C, S_, r, dchi = 1;
    for (var it = 0; it < 200; it++) {
      var z = alpha * chi * chi;
      C = stumpffC(z); S_ = S(z);
      r = chi * chi * C + vr0 / sqrtMu * chi * (1 - z * S_) + r0m * (1 - z * C);
      var F = r0m * vr0 / sqrtMu * chi * chi * C + (1 - alpha * r0m) * chi * chi * chi * S_ + r0m * chi - sqrtMu * dt;
      dchi = F / r;
      chi -= dchi;
      if (Math.abs(dchi) < 1e-9) break;
    }
    var zf = alpha * chi * chi;
    var Cf = stumpffC(zf), Sf = S(zf);
    var f = 1 - chi * chi / r0m * Cf;
    var g = dt - chi * chi * chi / sqrtMu * Sf;
    var rn = add(mul(r0, f), mul(v0, g));
    var rnm = mag(rn);
    var fdot = sqrtMu / (rnm * r0m) * (alpha * chi * chi * chi * Sf - chi);
    var gdot = 1 - chi * chi / rnm * Cf;
    var vn = add(mul(r0, fdot), mul(v0, gdot));
    return { r: rn, v: vn };
  }

  // --------------------------------------------------- 兰伯特问题 (单圈)
  // 给定 r1, r2 与飞行时间 dt，求解两点间转移轨道。prograde=true 走顺行弧。
  function lambert(mu, r1, r2, dt, prograde) {
    var r1m = mag(r1), r2m = mag(r2);
    if (r1m < 1e-6 || r2m < 1e-6 || dt <= 0) return null;
    var cdnu = clamp(dot(r1, r2) / (r1m * r2m), -1, 1);
    var dnu = Math.acos(cdnu);
    var hz = cross(r1, r2)[2];
    if (prograde === false) { if (!(hz < 0)) dnu = 2 * Math.PI - dnu; }
    else { if (hz < 0) dnu = 2 * Math.PI - dnu; }
    if (dnu < 1e-7 || Math.abs(dnu - 2 * Math.PI) < 1e-7) return null;
    var A = Math.sin(dnu) * Math.sqrt(r1m * r2m / (1 - Math.cos(dnu)));
    if (Math.abs(A) < 1e-9) return null;
    var sqrtMu = Math.sqrt(mu);

    function yOf(z) {
      var C = stumpffC(z);
      if (C <= 0) return NaN;
      return r1m + r2m + A * (z * S(z) - 1) / Math.sqrt(C);
    }
    function F(z) {
      var y = yOf(z);
      if (!(y > 0)) return NaN;
      var C = stumpffC(z);
      return Math.pow(y / C, 1.5) * S(z) + A * Math.sqrt(y) - sqrtMu * dt;
    }

    // 数值上 F(z) 在 (-inf, 4π²) 内单调递增：先确定括号 [lo, hi]
    var zMax = 4 * Math.PI * Math.PI * (1 - 1e-6);
    var f0 = F(0);
    if (!isFinite(f0)) return null;
    var lo, hi;
    if (f0 > 0) {                       // 根位于 z<0 段（双曲型转移）
      hi = 0; lo = -4 * Math.PI * Math.PI;
      var g = 0;
      while ((!isFinite(F(lo)) || F(lo) > 0) && g < 200) { lo *= 2; g++; }
      if (!isFinite(F(lo)) || F(lo) > 0) return null;
    } else {                            // 根位于 z>0 段
      lo = 0;
      var fMax = F(zMax);
      if (!isFinite(fMax) || fMax < 0) return null;   // 需多圈，暂不支持
      hi = zMax;
    }
    var z = 0.5 * (lo + hi);
    for (var i = 0; i < 400; i++) {
      z = 0.5 * (lo + hi);
      var fz = F(z);
      if (!isFinite(fz)) { hi = z; }
      else if (fz > 0) hi = z; else lo = z;
      if (Math.abs(hi - lo) < 1e-11 * Math.max(1, Math.abs(hi))) break;
    }
    var y = yOf(z);
    if (!(y > 0)) return null;
    var f = 1 - y / r1m;
    var g = A * Math.sqrt(y / mu);
    if (Math.abs(g) < 1e-12) return null;
    var gdot = 1 - y / r2m;
    var v1 = mul(sub(r2, mul(r1, f)), 1 / g);
    var v2 = mul(sub(mul(r2, gdot), r1), 1 / g);
    return {
      v1: v1, v2: v2, dnu: dnu, z: z, y: y, A: A,
      dv1: null, dv2: null,
      c3: mag2(v1) - 2 * mu / r1m
    };
  }

  // ------------------------------------------------------- 霍曼转移 (估算)
  function hohmann(mu, r1, r2, plane) {
    var at = (r1 + r2) / 2;
    var vp1 = Math.sqrt(mu / r1), va1 = Math.sqrt(mu / r2);
    var vt1 = Math.sqrt(mu * (2 / r1 - 1 / at));
    var vt2 = Math.sqrt(mu * (2 / r2 - 1 / at));
    var dv1 = Math.abs(vt1 - vp1), dv2 = Math.abs(va1 - vt2);
    var tof = Math.PI * Math.sqrt(at * at * at / mu);
    return { dv1: dv1, dv2: dv2, dvTotal: dv1 + dv2, tof: tof, aTransfer: at,
             vPerigee: vt1, vApogee: vt2 };
  }

  // --------------------------------------------------- RK4 数值积分
  // accelFn(t, r, v) -> 加速度矢量
  function rk4Step(accelFn, t, r, vv, h) {
    var k1r = vv, k1v = accelFn(t, r, vv);
    var k2r = add(vv, mul(k1v, h / 2));
    var k2v = accelFn(t + h / 2, add(r, mul(k1r, h / 2)), k2r);
    var k3r = add(vv, mul(k2v, h / 2));
    var k3v = accelFn(t + h / 2, add(r, mul(k2r, h / 2)), k3r);
    var k4r = add(vv, mul(k3v, h));
    var k4v = accelFn(t + h, add(r, mul(k3r, h)), k4r);
    var dr = mul(add(add(k1r, mul(k2r, 2)), add(mul(k3r, 2), k4r)), h / 6);
    var dv = mul(add(add(k1v, mul(k2v, 2)), add(mul(k3v, 2), k4v)), h / 6);
    return { r: add(r, dr), v: add(vv, dv), dr: dr, dv: dv };
  }

  // ----------------------------------------- 地球大气密度 (简化指数模型)
  // 返回 kg/m^3 (SI)。分段标高拟合 US Standard Atmosphere 1976。
  var _ATM_TABLE = [
    [0, 1.225, 7.5], [11, 0.364, 6.5], [20, 0.0889, 6.5], [32, 0.01323, 6.0],
    [47, 1.427e-3, 6.5], [51, 8.616e-4, 8.0], [71, 6.421e-5, 12.0],
    [85, 8.5e-6, 9.0], [100, 5.6e-7, 20.0], [150, 2.1e-9, 40.0],
    [200, 2.5e-10, 55.0], [300, 1.9e-11, 70.0], [400, 3.9e-12, 90.0],
    [500, 1.0e-12, 130.0], [700, 3.0e-14, 200.0]
  ];
  function atmosphere(altKm) {
    if (altKm < 0) altKm = 0;
    if (altKm > 740) return 0;
    var T = _ATM_TABLE;
    for (var i = T.length - 1; i >= 0; i--) {
      if (altKm >= T[i][0]) {
        var base = T[i];
        return base[1] * Math.exp(-(altKm - base[0]) / base[2]);
      }
    }
    return 0;
  }

  // --------------------------------------------- 球面坐标 <-> 直角坐标
  function geodeticToECEF(latDeg, lonDeg, altKm, R, f) {
    var lat = latDeg * D2R, lon = lonDeg * D2R;
    var e2 = f * (2 - f);
    var N = R / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    var x = (N + altKm) * Math.cos(lat) * Math.cos(lon);
    var y = (N + altKm) * Math.cos(lat) * Math.sin(lon);
    var z = (N * (1 - e2) + altKm) * Math.sin(lat);
    return [x, y, z];
  }
  function ecefToGeodetic(p, R, f) {
    var a = R, e2 = f * (2 - f);
    var lon = Math.atan2(p[1], p[0]);
    var r = Math.hypot(p[0], p[1]);
    var lat = Math.atan2(p[2], r * (1 - e2));
    var N = a, alt = 0;
    for (var i = 0; i < 8; i++) {
      var sl = Math.sin(lat);
      N = a / Math.sqrt(1 - e2 * sl * sl);
      lat = Math.atan2(p[2] + e2 * N * sl, r);
    }
    var sl2 = Math.sin(lat);
    N = a / Math.sqrt(1 - e2 * sl2 * sl2);
    alt = r / Math.cos(lat) - N;
    return { lat: lat * R2D, lon: lon * R2D, alt: alt };
  }

  // ---------------------------------------------------------- 数值工具
  function fmt(x, n) {
    if (!isFinite(x)) return '—';
    var a = Math.abs(x);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return x.toExponential(n === undefined ? 3 : n);
    return x.toFixed(n === undefined ? 2 : n);
  }
  function fmtKm(x) {
    if (!isFinite(x)) return '—';
    var a = Math.abs(x);
    if (a >= 1e6) return (x / 1e6).toFixed(3) + ' 万km×10²';
    return x.toFixed(a >= 1000 ? 1 : 2);
  }
  function fmtDist(x) {
    if (!isFinite(x)) return '—';
    var a = Math.abs(x);
    if (a >= 1e6) return (x / 1e6).toFixed(4) + ' Mkm';
    if (a >= 1e3) return (x / 1e3).toFixed(3) + ' Mm';
    return x.toFixed(2) + ' km';
  }
  function fmtTime(s) {
    var sign = s < 0 ? '-' : '';
    s = Math.abs(s);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = Math.floor(s % 60);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return sign + (d > 0 ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
  }
  function fmtMet(s) {
    var sign = s < 0 ? '-' : '+';
    s = Math.abs(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return sign + p(h) + ':' + p(m) + ':' + p(sec);
  }

  APL.V = {
    v: v, add: add, sub: sub, mul: mul, dot: dot, cross: cross, mag: mag, mag2: mag2,
    dist: dist, unit: unit, lerp: lerp, scaleAdd: scaleAdd, angleBetween: angleBetween,
    rotX: rotX, rotY: rotY, rotZ: rotZ, clamp: clamp, norm360: norm360, norm2pi: norm2pi
  };

  // 给定倾角 i 与某个方向 u，求使轨道面包含 u 的升交点赤经 RAAN
  //   轨道面法向 n = (sin i sin Ω, −sin i cos Ω, cos i)
  //   n·u = 0 → sin i (ux sinΩ − uy cosΩ) = −uz cos i
  function raanForInclination(incRad, u) {
    var uu = unit(u);
    var si = Math.sin(incRad), ci = Math.cos(incRad);
    if (Math.abs(si) < 1e-9) return 0;
    var A = uu[0], B = -uu[1], C = -uu[2] * ci / si;
    var R = Math.hypot(A, B);
    if (R < 1e-12) return 0;
    var s = clamp(C / R, -1, 1);
    var phi = Math.atan2(B, A);
    // 两个解里取使轨道「顺行」（法向 z 分量 > 0）的那个
    var best = null;
    for (var k = 0; k < 2; k++) {
      var Om = (k === 0 ? Math.asin(s) : Math.PI - Math.asin(s)) - phi;
      var n = orbitNormal(incRad, Om);
      var err = Math.abs(dot(n, uu));
      if (best === null || err < best.err) best = { Om: Om, err: err };
    }
    return ((best.Om % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }
  // 返回两个候选 RAAN（平面含 u 的解有镜像两个，取哪个要看具体几何）
  function raanCandidates(incRad, u) {
    var uu = unit(u);
    var si = Math.sin(incRad), ci = Math.cos(incRad);
    if (Math.abs(si) < 1e-9) return [0, Math.PI];
    var A = uu[0], B = -uu[1], C = -uu[2] * ci / si;
    var R = Math.hypot(A, B);
    if (R < 1e-12) return [0, Math.PI];
    var s = clamp(C / R, -1, 1);
    var phi = Math.atan2(B, A);
    var out = [];
    for (var k = 0; k < 2; k++) {
      var Om = (k === 0 ? Math.asin(s) : Math.PI - Math.asin(s)) - phi;
      out.push(((Om % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    }
    return out;
  }

  // 由倾角与 RAAN 得到轨道面法向（单位矢量）
  function orbitNormal(incRad, raanRad) {
    return [Math.sin(incRad) * Math.sin(raanRad),
            -Math.sin(incRad) * Math.cos(raanRad),
            Math.cos(incRad)];
  }

  APL.M = {
    D2R: D2R, R2D: R2D,
    stumpffC: stumpffC, stumpffS: S, S: S,
    solveKeplerElliptic: solveKeplerElliptic, solveKeplerHyperbolic: solveKeplerHyperbolic,
    elements: elements, stateFromElements: stateFromElements,
    propagate: propagate, lambert: lambert, hohmann: hohmann, rk4Step: rk4Step,
    raanForInclination: raanForInclination, raanCandidates: raanCandidates, orbitNormal: orbitNormal,
    atmosphere: atmosphere,
    geodeticToECEF: geodeticToECEF, ecefToGeodetic: ecefToGeodetic,
    fmt: fmt, fmtKm: fmtKm, fmtDist: fmtDist, fmtTime: fmtTime, fmtMet: fmtMet
  };

})(typeof window !== 'undefined' ? window : globalThis);
