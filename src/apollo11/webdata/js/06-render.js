/* =========================================================================
 *  06-render.js  —  Canvas 轨道渲染
 *  三种视图：地月全景 / 近地 / 近月。2D 投影 + 相机（偏航/俯仰/缩放）。
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var V = APL.V, M = APL.M, A = APL.Astro, B = APL.BODY, P = APL.Physics;

  function Camera() {
    this.yaw = 0.6;          // 绕 Z 轴
    this.tilt = 0.55;        // 俯视倾角
    this.scale = 0.02;       // 像素 / km
    this.offset = [0, 0];    // 屏幕中心（像素）
    this.center = [0, 0, 0]; // 观察中心（km）
    this.width = 800; this.height = 500;
  }
  Camera.prototype.basis = function () {
    // 轨道面俯视图（polar）直接给一整组基向量：ex 右、ey 上、ez 指向观察者，
    // 三者右手正交 —— 这样视线方向可以垂直于**任意**轨道面，
    // 而不只是"地球北极"那一个固定方向。
    if (this.customBasis) return this.customBasis;
    // 相机基向量：ex 右, ey 上, ez 指向观察者
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    var ex = [-sy, cy, 0];
    var ey = [-cy * st, -sy * st, ct];
    var ez = [cy * ct, sy * ct, st];
    return { ex: ex, ey: ey, ez: ez };
  };
  Camera.prototype.project = function (p) {
    var b = this.basis();
    var d = V.sub(p, this.center);
    var x = V.dot(d, b.ex) * this.scale + this.width / 2;
    var y = -V.dot(d, b.ey) * this.scale + this.height / 2;
    return [x, y, V.dot(d, b.ez)];
  };
  Camera.prototype.setScaleToFit = function (radiusKm) {
    this.scale = Math.min(this.width, this.height) * 0.45 / Math.max(radiusKm, 1);
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = new Camera();
    this.view = 'system';      // 看哪儿：system / earth / moon / craft
    this.mode = '3d';          // 怎么投影：3d（可旋转）/ 2d（垂直轨道面俯视）
    this.stars = null;
    this.dpr = window.devicePixelRatio || 1;
  }

  Renderer.prototype.resize = function () {
    var c = this.canvas;
    var host = c.parentElement;
    var r = host && host.getBoundingClientRect ? host.getBoundingClientRect()
      : { width: c.clientWidth || 900, height: c.clientHeight || 500 };
    this.dpr = window.devicePixelRatio || 1;
    c.width = Math.max(200, Math.floor(r.width * this.dpr));
    c.height = Math.max(150, Math.floor(r.height * this.dpr));
    this._hostW = r.width; this._hostH = r.height;
    this.cam.width = c.width; this.cam.height = c.height;
  };

  // 每帧轻量检查：布局尺寸变了就重新适配（防止初始 0×0 或窗口拉伸后模糊）
  Renderer.prototype.syncSize = function () {
    var c = this.canvas, host = c.parentElement;
    if (!host || !host.getBoundingClientRect) return;
    var r = host.getBoundingClientRect();
    if (Math.abs(r.width - (this._hostW || 0)) > 1 ||
        Math.abs(r.height - (this._hostH || 0)) > 1) {
      this.resize();
    }
  };

  Renderer.prototype.makeStars = function (n) {
    var out = [];
    var seed = 12345;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < n; i++) {
      out.push({ x: rnd(), y: rnd(), r: rnd() * 1.4 + 0.3, a: 0.25 + rnd() * 0.7 });
    }
    return out;
  };

  Renderer.prototype.updateCamera = function (world, craft) {
    var cam = this.cam;
    var is2d = (this.mode === '2d');
    // 只有 2D 模式才用自定义（平面锁定）基向量。3D 模式必须**每帧清掉**它 ——
    // 否则在 2D 里看过一次之后，切回地球/近月/跟随/地月全景都会继续用那组
    // "锁定在轨道面"的基向量，拖拽彻底失效，看起来就像 3D 视图被换成了 2D。
    if (!is2d) { cam.customBasis = null; cam.polarAxis = null; }
    var moonPos = A.moonState(world.t).r;
    var hero = craft || world.master();
    var heroPos = hero ? hero.r : [0, 0, 0];
    if (this.view === 'system') {
      cam.center = V.mul(V.add(V.mul(moonPos, 0.5), V.mul([0, 0, 0], 0.5)), 1);
      var need = V.mag(moonPos) * 0.62;
      cam.setScaleToFit(need);
    } else if (this.view === 'earth') {
      cam.center = heroPos.slice();
      var dE = V.mag(heroPos);
      cam.setScaleToFit(Math.max(dE * 1.5, 2200));
    } else if (this.view === 'moon') {
      cam.center = V.add(moonPos, V.mul(V.sub(heroPos, moonPos), 0.6));
      var dM = V.dist(heroPos, moonPos);
      cam.setScaleToFit(Math.max(dM * 1.6, 2600));
    } else if (this.view === 'craft') {
      cam.center = heroPos.slice();
      var dC = hero ? V.mag(hero.v) : 1;
      cam.setScaleToFit(Math.max(60, 0.35 * dC * 100));
    }
    // 2D 模式：把相机基向量换成"垂直于当前轨道面"的一组，并覆盖中心/缩放
    if (is2d) this.apply2D(world, hero, heroPos, moonPos);
    // 用户滚轮缩放（原来被每帧 setScaleToFit 覆盖掉了，等于从来没生效过）
    if (cam.userZoom && cam.userZoom !== 1) cam.scale *= cam.userZoom;
  };

  // ---------------------------------------------------- 2D（平面锁定）模式
  // 3D / 2D 是**叠加**关系：视图按钮决定"看哪儿"，模式决定"怎么投影"。
  // 2D 的视线方向 = 当前轨道面法向 n = unit(r × v)，也就是站在轨道水平面
  // 垂直 90° 的正上方往下看 —— 轨道画成正圆/正椭圆，而不是北极俯视的斜投影。
  // 中心按所选视图取：跟随 = 飞行器，近月 = 月球，地月全景/近地 = 所在主天体。
  // 只覆盖基向量，不动 yaw/tilt —— 切回 3D 时原来的观察角度原样恢复。
  Renderer.prototype.apply2D = function (world, hero, heroPos, moonPos) {
    var cam = this.cam;
    var pan = cam.pan || [0, 0, 0];
    var mst = A.moonState(world.t);
    cam.customBasis = null; cam.polarAxis = null;      // 先清：条件不足就退回 3D
    if (!hero) return;
    var primaryC = hero.primary === 'MOON' ? mst.r : [0, 0, 0];
    var primaryV = hero.primary === 'MOON' ? mst.v : [0, 0, 0];
    var rel = V.sub(heroPos, primaryC), vrel = V.sub(hero.v, primaryV);
    if (V.mag(rel) < 1e-6) return;
    var nrm = V.cross(rel, vrel);
    if (V.mag(nrm) < 1e-9) return;                     // 纯径向运动：没有轨道面可看
    var ezP = V.unit(nrm);
    var elP = null;
    try { elP = hero.orbitRelative(hero.primary, world); } catch (e2) { elP = null; }
    // ex 取近拱点方向（轨道椭圆长轴，图面稳定、不随公转打转）；
    // 圆轨道（e≈0）退化为升交点方向，再退化才用当前半径方向。
    var exP = (elP && elP.e > 0.02) ? V.unit(elP.evec) : null;
    var axisKind = exP ? 'apse' : 'node';
    if (!exP) {
      var ndP = V.cross([0, 0, 1], ezP);
      if (V.mag(ndP) > 1e-6) exP = V.unit(ndP);
      else { exP = V.unit(rel); axisKind = null; }
    }
    var eyP = V.cross(ezP, exP);                       // 右手系：ex × ey = ez
    cam.customBasis = { ex: exP, ey: eyP, ez: ezP };
    cam.polarAxis = axisKind;                          // 参考线画标签时要用
    // 平移量解释为「沿 ex / 沿 ey」（都在轨道面内）
    var baseC = (this.view === 'craft') ? heroPos : primaryC;
    cam.center = V.add(baseC, V.add(V.mul(exP, pan[0]), V.mul(eyP, pan[1])));
    // 缩放：至少让飞行器可见，尽量把整条轨道装进来（最多 3 倍当前半径）
    var rNow = V.mag(rel);
    var fit = rNow * 1.15;
    if (elP && isFinite(elP.apoapsis) && elP.apoapsis > 0) {
      fit = Math.min(Math.max(elP.apoapsis * 1.12, rNow * 1.15), rNow * 3.0);
    }
    if (this.view === 'craft') fit = Math.min(fit, rNow * 1.4);
    cam.setScaleToFit(Math.max(fit, 40));
  };

  Renderer.prototype.draw = function (world, craft) {
    this.syncSize();
    var ctx = this.ctx, cam = this.cam;
    var W = this.canvas.width, H = this.canvas.height;
    if (!this.stars) this.stars = this.makeStars(420);
    this.updateCamera(world, craft);

    // 背景
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070f'); g.addColorStop(0.6, '#070a14'); g.addColorStop(1, '#04060c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 星空
    ctx.save();
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r * this.dpr, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();

    var moon = A.moonState(world.t);
    var sun = A.sunState(world.t);
    this.drawSunDir(ctx, cam, sun, craft);
    this.drawBody(ctx, cam, [0, 0, 0], B.EARTH, sun.r, world, 'earth');
    this.drawBody(ctx, cam, moon.r, B.MOON, sun.r, world, 'moon');
    this.drawMoonOrbit(ctx, cam, world);
    this.drawPolarGuides(ctx, cam, world);
    this.drawTrail(ctx, cam, world);
    this.drawPrediction(ctx, cam, world, craft);
    this.drawSites(ctx, cam, world, moon);
    this.drawCraft(ctx, cam, world, craft);
    this.drawLegend(ctx, world, craft);
  };

  Renderer.prototype.drawSunDir = function (ctx, cam, sun, craft) {
    if (!craft) return;
    var dir = V.unit(sun.r);
    var p = cam.project(V.mul(dir, V.mag(craft.r) * 0.9));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,212,121,0.35)';
    ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    var q = cam.project(V.mul(dir, V.mag(craft.r) * 1.45));
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,212,121,0.8)';
    ctx.font = (11 * this.dpr) + 'px system-ui';
    var _sun = (APL.t ? APL.t('rv.sun') : 'Sun');
    ctx.fillText(_sun, q[0] + 6 * this.dpr, q[1] + 4 * this.dpr);
  };

  Renderer.prototype.drawBody = function (ctx, cam, pos, body, sunPos, world, kind) {
    var R = body.radius;
    var px = cam.project(pos);
    var rpx = R * cam.scale;
    if (rpx < 0.4) {
      // 太远：画一个标记
      ctx.fillStyle = body.color;
      ctx.beginPath(); ctx.arc(px[0], px[1], 3 * this.dpr, 0, 6.283); ctx.fill();
      return;
    }
    var toSun = V.unit(V.sub(sunPos, pos));
    // 太阳方向在屏幕上的投影
    var b = cam.basis();
    var sx = V.dot(toSun, b.ex), sy = -V.dot(toSun, b.ey);
    var sl = Math.hypot(sx, sy) || 1;
    sx /= sl; sy /= sl;

    // 星球本体：先铺一层**实色整圆**（边缘就是硬边界），再在圆内叠一层
    // 「朝阳面」亮部。旧做法是「渐变最外圈 = 背景色」，于是整圈边缘都被化进
    // 背景里 —— 看着就是一团虚边光斑（用户反馈"边缘虚化有点大了"）。
    var base = body.color2 || body.color;
    ctx.save();
    ctx.beginPath(); ctx.arc(px[0], px[1], rpx, 0, 6.283);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(px[0] - rpx - 1, px[1] - rpx - 1, rpx * 2 + 2, rpx * 2 + 2);
    var grd = ctx.createRadialGradient(
      px[0] + sx * rpx * 0.42, px[1] + sy * rpx * 0.42, rpx * 0.04,
      px[0], px[1], rpx * 1.02);
    grd.addColorStop(0, body.color);
    grd.addColorStop(0.30, body.color);     // 亮核再收一点：像被太阳照到的球，
    grd.addColorStop(1, 'rgba(0,0,0,0)');   // 而不是一颗自发光的珠子
    ctx.fillStyle = grd; ctx.fill();
    // 临边昏暗：只占 4.5% 半径的一圈暗边，给球一点体积感，但不发虚。
    // 注意 rim 必须夹到 ≤ 25% 半径：星球很小（rpx 0.4~0.5 px）时
    // 「rpx - rim/2」会变成负数，ctx.arc 会抛 IndexSizeError 把主循环打挂。
    var rim = Math.min(Math.max(1, rpx * 0.045), rpx * 0.25);
    var rr = Math.max(0.1, rpx - rim * 0.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = rim;
    ctx.beginPath(); ctx.arc(px[0], px[1], rr, 0, 6.283); ctx.stroke();
    ctx.restore();

    // 大气辉光：紧贴球面的一条细亮环（原来那圈偏大偏虚，和"发虚"叠一起更糊）
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = kind === 'earth' ? 'rgba(120,190,255,0.9)' : 'rgba(205,205,195,0.4)';
    ctx.lineWidth = Math.max(1, rpx * 0.028) * this.dpr;
    ctx.beginPath(); ctx.arc(px[0], px[1], rpx + ctx.lineWidth * 0.35, 0, 6.283); ctx.stroke();
    ctx.restore();

    // 标注
    if (rpx > 10 * this.dpr) {
      ctx.fillStyle = 'rgba(190,210,240,0.85)';
      ctx.font = (11 * this.dpr) + 'px system-ui';
      var bn = (APL.t && kind === 'earth') ? APL.t('body.earth')
        : (APL.t && kind === 'moon') ? APL.t('body.moon') : body.name;
      ctx.fillText(bn, px[0] + rpx * 0.75, px[1] - rpx * 0.8);
    }
    this._bodyScreen = this._bodyScreen || {};
    this._bodyScreen[kind] = { x: px[0], y: px[1], r: rpx };
  };

  Renderer.prototype.drawMoonOrbit = function (ctx, cam, world) {
    var pts = [];
    for (var k = -60; k <= 60; k += 2) {
      var st = A.moonState(world.t + k * 3600 * 12);
      var p = cam.project(st.r);
      pts.push(p);
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(120,150,200,0.28)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawTrail = function (ctx, cam, world) {
    var h = world.history;
    if (!h || h.length < 2) return;
    ctx.save();
    ctx.lineWidth = 1.4 * this.dpr;
    var n = h.length;
    var start = Math.max(0, n - 2600);
    for (var i = start; i < n - 1; i++) {
      var a = cam.project(h[i].r), b2 = cam.project(h[i + 1].r);
      var t = (i - start) / Math.max(1, n - 1 - start);
      ctx.strokeStyle = 'rgba(90,220,180,' + (0.12 + 0.65 * t).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
    }
    ctx.restore();
  };

  // 轨道预演：读 App 分帧算好的缓存（world.predTraj），画虚线 + 时间刻度。
  // 轨迹本身用的是和仿真一致的完整引力（地球 μ+J2、月球 μ+J2、太阳），
  // 所以弯折、月球甩摆这些都会如实出现。
  Renderer.prototype.drawPrediction = function (ctx, cam, world, craft) {
    if (!craft || craft.crashed) return;
    if (!world.showPrediction) return;
    var tr = world.predTraj;
    if (!tr || !tr.pts || tr.pts.length < 2) return;
    var N = tr.pts.length;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,196,96,0.85)';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.setLineDash([6 * this.dpr, 5 * this.dpr]);
    ctx.beginPath();
    for (var i = 0; i < N; i++) {
      var p = cam.project(tr.pts[i].r);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 时间刻度：每 1/4 段一个点 + 标签
    var step = Math.max(1, Math.floor(N / 4));
    ctx.fillStyle = 'rgba(255,216,150,0.95)';
    ctx.font = (10 * this.dpr) + 'px ui-monospace, Consolas, monospace';
    for (var k = step; k < N; k += step) {
      var q = cam.project(tr.pts[k].r);
      ctx.beginPath(); ctx.arc(q[0], q[1], 2.4 * this.dpr, 0, 6.283); ctx.fill();
      ctx.fillText('+' + M.fmtTime(tr.pts[k].t - tr.t0), q[0] + 6 * this.dpr, q[1] - 3 * this.dpr);
    }
    // 终点：小 ×
    var e = cam.project(tr.pts[N - 1].r);
    ctx.strokeStyle = 'rgba(255,196,96,0.95)';
    ctx.lineWidth = 1.7 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(e[0] - 4.5 * this.dpr, e[1] - 4.5 * this.dpr); ctx.lineTo(e[0] + 4.5 * this.dpr, e[1] + 4.5 * this.dpr);
    ctx.moveTo(e[0] + 4.5 * this.dpr, e[1] - 4.5 * this.dpr); ctx.lineTo(e[0] - 4.5 * this.dpr, e[1] + 4.5 * this.dpr);
    ctx.stroke();
    ctx.restore();
  };

  // 2D（平面锁定）模式下的参考线：过主天体中心的轨道面内两条主轴（ex / ey）。
  // 3D 模式不画 —— 那时视线是斜的，画"轨道面内的轴"没有意义。
  Renderer.prototype.drawPolarGuides = function (ctx, cam, world) {
    if (this.mode !== '2d') return;
    var b = cam.basis();
    var T = APL.t || function (k) { return k; };
    var Rk = Math.min(this.canvas.width, this.canvas.height) * 0.47 / cam.scale;
    var o = cam.project(cam.center);
    var axp = cam.project(V.add(cam.center, V.mul(b.ex, Rk)));
    var ayp = cam.project(V.add(cam.center, V.mul(b.ey, Rk)));
    ctx.save();
    ctx.strokeStyle = 'rgba(140,170,210,0.20)';
    ctx.setLineDash([3 * this.dpr, 6 * this.dpr]);
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(2 * o[0] - axp[0], 2 * o[1] - axp[1]); ctx.lineTo(axp[0], axp[1]);
    ctx.moveTo(2 * o[0] - ayp[0], 2 * o[1] - ayp[1]); ctx.lineTo(ayp[0], ayp[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(160,185,215,0.7)';
    ctx.font = (10 * this.dpr) + 'px system-ui';
    if (cam.polarAxis === 'apse') ctx.fillText(T('rv.apseDir'), axp[0] + 4 * this.dpr, axp[1]);
    else if (cam.polarAxis === 'node') ctx.fillText(T('rv.nodeDir'), axp[0] + 4 * this.dpr, axp[1]);
    ctx.fillText(T('rv.planeTop'), ayp[0] + 4 * this.dpr, ayp[1]);
    ctx.restore();
  };

  Renderer.prototype.drawSites = function (ctx, cam, world, moon) {
    // 着陆点
    var ls = A.moonSurfacePoint(world.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
    var p = cam.project(ls.r);
    ctx.save();
    ctx.strokeStyle = '#ff7a7a'; ctx.lineWidth = 1.6 * this.dpr;
    ctx.beginPath(); ctx.arc(p[0], p[1], 6 * this.dpr, 0, 6.283); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p[0] - 9 * this.dpr, p[1]); ctx.lineTo(p[0] + 9 * this.dpr, p[1]);
    ctx.moveTo(p[0], p[1] - 9 * this.dpr); ctx.lineTo(p[0], p[1] + 9 * this.dpr);
    ctx.stroke();
    ctx.fillStyle = '#ffb3b3'; ctx.font = (11 * this.dpr) + 'px system-ui';
    ctx.fillText(APL.t ? APL.t('rv.site') : 'Tranquility Base',
      p[0] + 10 * this.dpr, p[1] + 4 * this.dpr);
    ctx.restore();

    // 发射场
    var site = A.siteState(world.t, APL.SITE.lat, APL.SITE.lon, 0);
    var q = cam.project(site.r);
    ctx.save();
    ctx.fillStyle = '#7fe0a0';
    ctx.beginPath(); ctx.arc(q[0], q[1], 3.2 * this.dpr, 0, 6.283); ctx.fill();
    if (cam.project([0, 0, 0])[2] > 0) {
      ctx.font = (11 * this.dpr) + 'px system-ui';
      ctx.fillText(APL.t ? APL.t('rv.launchSite') : 'LC-39A',
        q[0] + 6 * this.dpr, q[1] + 4 * this.dpr);
    }
    ctx.restore();
  };

  Renderer.prototype.drawCraft = function (ctx, cam, world, craft) {
    var list = world.crafts.filter(function (c) { return !c.crashed; });
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var p = cam.project(c.r);
      // 箭头指向速度方向（比姿态更直观："往哪飞"）。
      // 原来只往前推 1 km，在全景/极视下根本投不出像素，箭头方向是随机的。
      var vdir = V.mag(c.v) > 1e-9 ? c.v : (c.attitude.vec || [1, 0, 0]);
      var cam2 = cam.project(V.add(c.r, V.mul(vdir, 600)));   // 速度方向 600 秒后
      var dx = cam2[0] - p[0], dy = cam2[1] - p[1];
      if (Math.hypot(dx, dy) < 5 * this.dpr) {
        // 屏幕上太短：直接用速度在屏幕上的投影方向画固定长度
        var bb = cam.basis();
        dx = V.dot(vdir, bb.ex); dy = -V.dot(vdir, bb.ey);
      }
      var dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      var sz = (c.flags.isLM ? 9 : 12) * this.dpr;
      ctx.save();
      // 光晕
      var gg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], sz * 2.6);
      gg.addColorStop(0, 'rgba(120,210,255,0.55)');
      gg.addColorStop(1, 'rgba(120,210,255,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(p[0], p[1], sz * 2.6, 0, 6.283); ctx.fill();
      // 箭头
      ctx.translate(p[0], p[1]); ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath();
      ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.7, sz * 0.62);
      ctx.lineTo(-sz * 0.35, 0); ctx.lineTo(-sz * 0.7, -sz * 0.62);
      ctx.closePath();
      ctx.fillStyle = c.flags.isLM ? '#ffd479' : '#8fd8ff';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(220,235,255,0.9)';
      ctx.font = (11 * this.dpr) + 'px system-ui';
      ctx.fillText(c.name, p[0] + sz * 1.2, p[1] - sz * 0.9);
    }
  };

  Renderer.prototype.drawLegend = function (ctx, world, craft) {
    var W = this.canvas.width, H = this.canvas.height;
    ctx.save();
    ctx.font = (11 * this.dpr) + 'px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(150,175,210,0.85)';
    var vk = { system: 'view.system', earth: 'view.earth', moon: 'view.moon',
               craft: 'view.craft' }[this.view];
    var vn = (APL.t && vk) ? APL.t(vk) : this.view;
    if (this.mode === '2d') vn += ' · 2D';
    var s = APL.t
      ? APL.t('rv.legend', { span: fmtSpan(Math.min(W, H) / 2 / this.cam.scale), view: vn })
      : ('FOV ' + fmtSpan(Math.min(W, H) / 2 / this.cam.scale) + ' · ' + vn);
    ctx.fillText(s, 12 * this.dpr, H - 12 * this.dpr);
    ctx.restore();
  };
  function fmtSpan(km) {
    var T = APL.t || function (k) { return k; };
    if (km > 1e6) return (km / 1e6).toFixed(2) + T('rv.millionKm');
    if (km > 1000) return (km / 1000).toFixed(1) + T('rv.thousandKm');
    return km.toFixed(0) + T('rv.km');
  }

  // 未选任务时的引导页（避免一打开就像已经进入游戏）
  Renderer.prototype.drawIdle = function () {
    this.syncSize();
    var ctx = this.ctx;
    var W = this.canvas.width, H = this.canvas.height, d = this.dpr;
    if (!this.stars) this.stars = this.makeStars(420);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070f'); g.addColorStop(0.6, '#070a14'); g.addColorStop(1, '#04060c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      ctx.globalAlpha = s.a * 0.8;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * d, 0, 6.283); ctx.fill();
    }
    ctx.restore();

    var T = APL.t || function (k) { return k; };
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,181,71,0.9)';
    ctx.font = (Math.floor(34 * d)) + 'px system-ui';
    ctx.fillText('◈', W / 2, H * 0.38);
    ctx.fillStyle = 'rgba(232,242,255,0.94)';
    ctx.font = '600 ' + Math.floor(20 * d) + 'px system-ui';
    ctx.fillText(T('rv.idleTitle'), W / 2, H * 0.48);
    ctx.fillStyle = 'rgba(160,185,215,0.9)';
    ctx.font = Math.floor(13 * d) + 'px system-ui';
    ctx.fillText(T('rv.idleHint'), W / 2, H * 0.545);
    ctx.fillStyle = 'rgba(130,155,190,0.85)';
    ctx.font = Math.floor(12 * d) + 'px system-ui';
    var how = String(T('rv.idleHow')).split('\n');
    for (var k = 0; k < how.length; k++) {
      ctx.fillText(how[k], W / 2, H * 0.60 + k * 20 * d);
    }
    ctx.restore();
  };

  APL.Renderer = Renderer;
  APL.Camera = Camera;

})(typeof window !== 'undefined' ? window : globalThis);
