/* =========================================================================
 *  03-physics.js  —  仿真内核
 *  · 多体引力：地球(含 J2) + 月球(含 J2) + 太阳第三体摄动
 *  · RK4 自适应步长积分，深空最高 30 万倍时间加速
 *  · 分级推进：真实推力 / 比冲 / 质量流量，支持分级与抛离
 *  · 制导：发射俯仰程序 + 闭环能量管理、顺/逆/法向/径向保持
 *  单位：距离 km，速度 km/s，质量 kg，时间 s
 *  ========================================================================= */
(function (global) {
  'use strict';

  var APL = global.APL;
  var V = APL.V, M = APL.M, C = APL.C, B = APL.BODY, A = APL.Astro;
  var g0 = C.G0;
  var _e2 = B.EARTH.flattening * (2 - B.EARTH.flattening);

  // 椭球面上一点的地心半径（按地心纬度近似），用于正确的高度读数
  function earthRadiusAt(r) {
    var rm = V.mag(r);
    if (rm < 1) return B.EARTH.radius;
    var s = V.clamp(r[2] / rm, -1, 1);
    var s2 = s * s, c2 = 1 - s2, k = 1 - _e2;
    return B.EARTH.radius * Math.sqrt(c2 + k * k * s2) / Math.sqrt(1 - _e2 * s2);
  }
  function earthAltitude(r) { return V.mag(r) - earthRadiusAt(r); }

  function mod(cfg) {
    return {
      id: cfg.id, name: cfg.name, dry: cfg.dry, prop: cfg.prop, propMax: cfg.prop,
      thrust: cfg.thrust || 0, isp: cfg.isp || 0, throttleMin: cfg.throttleMin || 1,
      thrustSL: cfg.thrustSL || 0, ispSL: cfg.ispSL || 0,
      engines: cfg.engines || 0, hasEngine: !!cfg.thrust,
      jettison: cfg.jettison !== false, group: cfg.group || 'core',
      stage: cfg.stage === undefined ? 99 : cfg.stage
    };
  }

  function buildSaturnVStack() {
    var SV = APL.SATURN_V, csm = APL.CSM, lm = APL.LM;
    var sic = SV.stages[0], sii = SV.stages[1], sivb = SV.stages[2];
    return [
      mod({ id: 'S-IC', name: 'S-IC 第一级', dry: sic.dry, prop: sic.prop,
            thrust: sic.thrustVac, isp: sic.ispVac, thrustSL: sic.thrustSL,
            ispSL: sic.ispSL, engines: 5, throttleMin: 1, stage: 0 }),
      mod({ id: 'S-II', name: 'S-II 第二级', dry: sii.dry, prop: sii.prop,
            thrust: sii.thrustVac, isp: sii.ispVac, engines: 5, throttleMin: 0.4, stage: 1 }),
      mod({ id: 'S-IVB', name: 'S-IVB 第三级', dry: sivb.dry, prop: sivb.prop,
            thrust: sivb.thrustVac, isp: sivb.ispVac, engines: 1, throttleMin: 1, stage: 2 }),
      mod({ id: 'ESA', name: '仪器舱/适配器/逃逸塔', dry: 21677, prop: 0, stage: 0.5 }),
      mod({ id: 'LM_D', name: '登月舱下降级', dry: lm.descentDry, prop: lm.descentProp,
            thrust: lm.descentThrustMax, isp: lm.descentIsp, engines: 1,
            throttleMin: lm.descentThrottleMin, stage: 3, group: 'LM' }),
      mod({ id: 'LM_A', name: '登月舱上升级', dry: lm.ascentDry, prop: lm.ascentProp,
            thrust: lm.ascentThrust, isp: lm.ascentIsp, engines: 1, stage: 4, group: 'LM' }),
      mod({ id: 'SM', name: '服务舱 SPS', dry: csm.dry - 5560, prop: csm.propMass,
            thrust: csm.thrust, isp: csm.isp, engines: 1, throttleMin: 0.1, stage: 5 }),
      mod({ id: 'CM', name: '指令舱 CM', dry: 5560, prop: 0, stage: 6 })
    ];
  }

  // ============================================================== 飞行器
  function Craft(cfg) {
    cfg = cfg || {};
    this.id = cfg.id || ('C' + (Math.random() * 1e6 | 0));
    this.name = cfg.name || 'Apollo';
    this.r = cfg.r ? cfg.r.slice() : [0, 0, 0];
    this.v = cfg.v ? cfg.v.slice() : [0, 0, 0];
    this.modules = cfg.modules || buildSaturnVStack();
    this.stageIndex = cfg.stageIndex || 0;
    this.throttle = 0;
    this.throttleCmd = cfg.throttleCmd || 0;
    this.attitude = {
      mode: cfg.mode || 'prograde',
      vec: cfg.vec ? V.unit(cfg.vec) : [0, 0, 1]
    };
    this.rcsProp = cfg.rcsProp === undefined ? 620 : cfg.rcsProp;
    this.docked = [];
    this.landed = false;
    this.crashed = false;
    this.primary = cfg.primary || 'EARTH';
    this.dvUsed = 0;
    this.thrustAccel = 0;
    this.gLoad = 1;
    this.lastIgnite = -1e9;
    this.flags = cfg.flags || {};
  }

  Craft.prototype.stackList = function () { return [this].concat(this.docked); };

  // 分离登月舱：把指定编组（默认 'LM'）的模块拆成一台独立飞行器返回。
  // 注意：只构造、不入世界，由调用方 addCraft —— 原来 07-app.js 调了这个
  // 根本不存在的方法（c.undock is not a function），所以"分离登月舱"按钮
  // 一直是失效的（只是被静默吞掉了）。
  Craft.prototype.undock = function (groupId) {
    groupId = groupId || 'LM';
    var keep = [], take = [];
    for (var i = 0; i < this.modules.length; i++) {
      var m = this.modules[i];
      if (m.group === groupId) take.push(m); else keep.push(m);
    }
    if (!take.length) return null;
    this.modules = keep;
    var lm = new Craft({
      id: 'LM', name: 'Eagle',
      r: this.r.slice(), v: this.v.slice(), modules: take, mode: 'prograde'
    });
    lm.primary = this.primary;
    lm.stageIndex = take.reduce(function (s2, m2) {
      return Math.min(s2, m2.stage);
    }, 99);
    lm.flags.isLM = true;
    // RCS 推进剂对半分
    var half = (this.rcsProp || 0) / 2;
    lm.rcsProp = half;
    this.rcsProp = (this.rcsProp || 0) - half;
    return lm;
  };

  Craft.prototype.mass = function () {
    var s = 0, list = this.stackList();
    for (var i = 0; i < list.length; i++) {
      var ms = list[i].modules;
      for (var j = 0; j < ms.length; j++) s += ms[j].dry + ms[j].prop;
      s += list[i].rcsProp;
    }
    return s;
  };

  // 当前主级：级号等于 stageIndex 且仍有推进剂的发动机模块；
  // 若已耗尽则退回「级号更高且最近的可用级」。
  Craft.prototype.activeModule = function () {
    var ms = this.modules, best = null;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!m.hasEngine || m.prop <= 1e-9) continue;
      if (Math.abs(m.stage - this.stageIndex) < 1e-9) return { module: m, index: i };
      if (m.stage > this.stageIndex && (best === null || m.stage < best.module.stage)) {
        best = { module: m, index: i };
      }
    }
    return best;
  };

  // 环境压强比 p/p0（仅地球有大气；其余为 0）
  Craft.prototype.ambientRatio = function () {
    return this.ambientP === undefined ? 0 : this.ambientP;
  };

  Craft.prototype.ispNow = function (m) {
    var pr = this.ambientRatio();
    if (!m.ispSL || pr <= 0) return m.isp;
    return m.ispSL + (m.isp - m.ispSL) * (1 - pr);
  };

  Craft.prototype.currentThrust = function () {
    var a = this.activeModule();
    if (!a || this.throttle <= 0) return 0;
    var m = a.module;
    var pr = this.ambientRatio();
    var T = m.thrust;
    if (m.thrustSL && pr > 0) T = m.thrustSL + (m.thrust - m.thrustSL) * (1 - pr);
    var th = this.throttle;
    if (th < m.throttleMin) th = m.throttleMin;
    return T * th * (m.thrustScale || 1);      // thrustScale：S-IC 中央机提前关机
  };

  Craft.prototype.exhaustVelocity = function () {
    var a = this.activeModule();
    return a ? this.ispNow(a.module) * g0 / 1000 : 3.0;    // km/s
  };

  // 点火：使用 throttleCmd（指令油门），throttle 记录实际油门
  Craft.prototype.ignite = function (dt) {
    var cmd = this.throttleCmd || 0;
    if (cmd <= 0) { this.throttle = 0; return 0; }
    var a = this.activeModule();
    if (!a) { this.throttle = 0; return 0; }
    var m = a.module;
    var th = V.clamp(cmd, 0, 1);
    if (th < m.throttleMin) th = m.throttleMin;
    var T = this.currentThrust0(m, th);
    var mdot = T / (this.ispNow(m) * g0);
    var used = Math.min(m.prop, mdot * dt);
    m.prop -= used;
    if (m.prop <= 1e-9) m.prop = 0;
    this.throttle = th;
    return used;
  };

  Craft.prototype.currentThrust0 = function (m, th) {
    var pr = this.ambientRatio();
    var T = m.thrust;
    if (m.thrustSL && pr > 0) T = m.thrustSL + (m.thrust - m.thrustSL) * (1 - pr);
    return T * th * (m.thrustScale || 1);      // thrustScale：S-IC 中央机提前关机
  };

  Craft.prototype.remainingDeltaV = function () {
    var a = this.activeModule();
    if (!a) return 0;
    var m0 = this.mass();
    return a.module.isp * g0 / 1000 * Math.log(m0 / Math.max(m0 - a.module.prop, 1));
  };

  // 分级：抛掉所有 stage 小于下一可用级的模块
  Craft.prototype.stageUp = function () {
    var ms = this.modules, next = null, i;
    for (i = 0; i < ms.length; i++) {
      if (ms[i].hasEngine && ms[i].prop > 1e-9 && ms[i].stage > this.stageIndex + 1e-9) {
        if (next === null || ms[i].stage < next) next = ms[i].stage;
      }
    }
    var dumped = [];
    if (next === null) {
      for (i = ms.length - 1; i >= 0; i--) {
        if (ms[i].jettison && ms[i].prop <= 1e-9 && ms[i].stage <= this.stageIndex + 1e-9) {
          dumped.push(ms.splice(i, 1)[0].id);
        }
      }
      return dumped;
    }
    for (i = ms.length - 1; i >= 0; i--) {
      if (ms[i].stage < next - 1e-9) dumped.push(ms.splice(i, 1)[0].id);
    }
    this.stageIndex = next;
    return dumped;
  };

  Craft.prototype.orbitRelative = function (primaryKey, world) {
    var key = primaryKey || this.primary;
    var body = key === 'MOON' ? B.MOON : B.EARTH;
    var center = key === 'MOON' ? A.moonState(world ? world.t : 0).r : [0, 0, 0];
    var vel = key === 'MOON' ? A.moonState(world ? world.t : 0).v : [0, 0, 0];
    return M.elements(body.mu, V.sub(this.r, center), V.sub(this.v, vel));
  };

  // ============================================================== 世界
  function World() {
    this.t = 0;
    this.crafts = [];
    this.events = [];
    this.running = false;
    this.warpIndex = 0;
    this.warp = APL.WARP[0];
    this.stepsLastFrame = 0;
    this.autoStage = true;
    this.gravityModel = { earthJ2: true, moonJ2: true, sun: true, drag: true };
    this.history = [];
    this.milestones = {};
    this.launchTarget = 185;         // 目标停泊轨道高度 km
    this.guideH = 215;               // 航迹角归零的目标高度 km
    this.flatAlt = 180;              // 超过此高度转入沿速度方向平飞
    this.targetAlt = 184.55;         // 入轨目标平均高度 km（183.2×185.9 的中值）
    this.cdA = 25;                   // m^2 参考阻力面积
    this.site = APL.SITE;
    this.landingSite = APL.LANDING_SITE;
    this.lastEventText = '';
  }

  World.prototype.addCraft = function (c) { this.crafts.push(c); return c; };

  World.prototype.master = function () { return this.crafts[0]; };

  World.prototype.primaryPos = function (key) {
    if (key === 'MOON') return A.moonState(this.t).r;
    if (key === 'SUN') return A.sunState(this.t).r;
    return [0, 0, 0];
  };
  World.prototype.primaryVel = function (key) {
    if (key === 'MOON') return A.moonState(this.t).v;
    return [0, 0, 0];
  };

  // ------------------------------------------------------------ 引力场
  World.prototype.gravity = function (t, r) {
    var muE = B.EARTH.mu, rmag = V.mag(r);
    var f = -muE / (rmag * rmag * rmag);
    var a = [r[0] * f, r[1] * f, r[2] * f];
    if (this.gravityModel.earthJ2) {
      var R2 = B.EARTH.radius * B.EARTH.radius;
      var z2 = r[2] * r[2] / (rmag * rmag);
      var k = -1.5 * B.EARTH.J2 * muE * R2 / Math.pow(rmag, 5);
      a[0] += k * r[0] * (1 - 5 * z2);
      a[1] += k * r[1] * (1 - 5 * z2);
      a[2] += k * r[2] * (3 - 5 * z2);
    }
    var ms = A.moonState(t);
    var dm = V.sub(ms.r, r);                       // 飞船 → 月球
    var dmm = V.mag(dm);
    if (dmm > 1e-3) {
      // 地心（非惯性）系里的月球差分引力 = 直接项 + 间接项：
      //   a = μ_m·(r_m − r)/|r_m − r|³  −  μ_m·r_m/|r_m|³
      // 直接项指向月球（dm 方向，与旧代码同号）；间接项是"月球牵引地球"的
      // 反作用 —— 少了它，地心系里会出现一个 ~3.3e-8 km/s² 的虚假加速度
      //（相当于地球没有被月球拉着走），地月转移/环月段会整体漂移。
      // 自洽性校验：把 r=0（地心）代入必须严格得 0。
      a = V.scaleAdd(a, dm, B.MOON.mu / (dmm * dmm * dmm));
      var rmm = V.mag(ms.r);
      a = V.scaleAdd(a, ms.r, -B.MOON.mu / (rmm * rmm * rmm));
      if (this.gravityModel.moonJ2 && dmm < 80000) {
        // ⚠ J2 用的是**飞船相对月球**的位置矢量 p = r − r_m（与 dm 差一个负号）。
        //   旧代码把 dm 当 p 用，等于整个 J2 项反了号（月球扁球该多吸的地方变成排开）。
        var pv = V.sub(r, ms.r);
        var Fr = A.moonFrame(t);
        var lx = V.dot(pv, Fr.x), ly = V.dot(pv, Fr.y), lz = V.dot(pv, Fr.z);
        var Rm2 = B.MOON.radius * B.MOON.radius;
        var z2m = lz * lz / (dmm * dmm);
        var km = -1.5 * B.MOON.J2 * B.MOON.mu * Rm2 / Math.pow(dmm, 5);
        a = V.scaleAdd(a, Fr.x, km * lx * (1 - 5 * z2m));
        a = V.scaleAdd(a, Fr.y, km * ly * (1 - 5 * z2m));
        a = V.scaleAdd(a, Fr.z, km * lz * (3 - 5 * z2m));
      }
    }
    if (this.gravityModel.sun) {
      var rs = A.sunState(t).r;
      var ds = V.sub(rs, r);
      var dsm = V.mag(ds);
      a = V.scaleAdd(a, ds, B.SUN.mu / (dsm * dsm * dsm));
      a = V.scaleAdd(a, rs, -B.SUN.mu / Math.pow(V.mag(rs), 3));
    }
    return a;
  };

  // 等效阻力面积（m²）：再入末段按真实时序开伞。
  //
  //   指令舱再入体          40 m²（钝头体 Cd·A）
  //   减速伞（7.6 km 开）   +27 m²（两具 5.0 m 锥形伞，真实施放高度 25 000 ft）
  //   三顶主伞（3.0 km 开） +1064 m²（三具 25.4 m 环帆伞、Cd≈0.72，真实 10 000 ft）
  //
  // CdA 由"低空平衡下降速度"反推并校验：
  //   v = √(2mg/(ρ·CdA))，m=5560 kg、ρ(海平面)=1.225 kg/m³、CdA=1104 →
  //   v ≈ 9.0 m/s，正落在真实指令舱溅落速度（约 8~10 m/s）区间，
  //   且低于 checkSurface 的 15 m/s 安全判据。
  //
  // 旧值 2500 m² 大了约 2.3 倍（约等于 6 顶主伞），低空会产生数百 g 的假冲击。
  // 主伞按 400 m 高度带**渐开**：真实主伞充气约 6~8 s，瞬时阶跃 CdA 会在
  // 开伞瞬间造出十几 g 的假峰值。
  World.prototype.effCdA = function (c, altKm) {
    var base = this.cdA;
    if (!c) return base;
    var hasCM = false, hasLM = false;
    for (var i = 0; i < c.modules.length; i++) {
      if (c.modules[i].id === 'CM') hasCM = true;
      if (c.modules[i].id === 'LM_D' || c.modules[i].id === 'LM_A') hasLM = true;
    }
    if (!hasCM) return base;
    if (hasLM) return base;                          // 还挂着登月舱时不放伞
    var cm = Math.max(base, 40);                     // 指令舱再入体
    if (altKm < 3.0) {
      // 主伞充气带：3.0 km 开始、2.6 km 完全张开
      var frac = (3.0 - altKm) / 0.4;
      if (frac > 1) frac = 1;
      if (frac < 0) frac = 0;
      return cm + 27 + 1064 * frac;
    }
    if (altKm < 7.6) return cm + 27;                 // 减速伞
    return cm;
  };

  World.prototype.dragAccel = function (t, r, v, massKg, craft) {
    if (!this.gravityModel.drag) return [0, 0, 0];
    var alt = earthAltitude(r);
    if (alt > 400 || alt < -5) return [0, 0, 0];
    var rho = M.atmosphere(alt);                    // kg/m^3
    if (rho <= 0) return [0, 0, 0];
    var w = B.EARTH.omega;
    var vrel = [v[0] + w * r[1], v[1] - w * r[0], v[2]];   // km/s
    var vms = V.mag(vrel) * 1000;
    if (vms < 0.01) return [0, 0, 0];
    var cdA = this.effCdA(craft, alt);
    var aMs = 0.5 * rho * vms * vms * cdA / massKg;
    var aKm = aMs / 1000;
    return V.mul(vrel, -aKm / V.mag(vrel));
  };

  World.prototype.stepCraft = function (c, h) {
    if (c.crashed) return;
    var self = this;
    var massKg = c.mass();
    // ⚠ 有限点火（闭环 VTBG）期间，推力方向必须**唯一点火对象说了算**。
    //   原来这里统一走 guidanceDirection(c) → case 'hold' → c.attitude.vec，
    //   也就是说推力方向取决于"这一刻 attitude.vec 有没有被别人改过"。
    //   实测 MCC 点火：喷口积分 64.8 m/s（烧掉 983 kg，动量守恒保证速度真变了
    //   64.8 m/s），可是"到目标速度的距离"只从 30.4 缩到 26.9 m/s ——
    //   冲量几乎全打在垂直于目标方向上了。把方向钉在点火对象自己身上，
    //   这个不确定性就没了。
    var dir = (c.burn && c.burn.active && c.burn.dirVec)
      ? c.burn.dirVec
      : APL.Physics.guidanceDirection(this, c);
    if (V.mag(dir) > 1e-9) c.attitude.vec = dir;
    var thrust = c.currentThrust();
    var aT = thrust > 0 ? (thrust / 1000) / massKg : 0;   // km/s^2
    c.thrustAccel = aT * 1000;
    var accel = function (t, r, v) {
      var a = self.gravity(t, r);
      a = V.add(a, self.dragAccel(t, r, v, massKg, c));
      if (aT > 0) a = V.scaleAdd(a, dir, aT);
      return a;
    };
    var st = M.rk4Step(accel, this.t, c.r, c.v, h);
    c.r = st.r; c.v = st.v;
    var gm = V.mag(this.gravity(this.t, c.r)) * 1000;
    var net = Math.sqrt(c.thrustAccel * c.thrustAccel + gm * gm + 0);
    c.gLoad = Math.abs(net / g0);
    for (var i = 0; i < c.docked.length; i++) {
      c.docked[i].r = c.r.slice(); c.docked[i].v = c.v.slice();
      c.docked[i].primary = c.primary;
    }
  };

  World.prototype.updatePrimary = function (c) {
    var ms = A.moonState(this.t);
    var dMoon = V.dist(c.r, ms.r);
    var was = c.primary;
    if (c.primary === 'MOON') {
      if (dMoon > B.MOON.soi * 1.1) c.primary = 'EARTH';
    } else if (dMoon < B.MOON.soi * 0.99) {
      c.primary = 'MOON';
    }
    if (was !== c.primary) {
      this.pushEvent(c.primary === 'MOON' ? 'SOI_MOON' : 'SOI_EARTH',
        c.primary === 'MOON' ? '进入月球引力影响球 (SOI 66 183 km)' : '脱离月球引力影响球');
    }
  };

  World.prototype.pushEvent = function (tag, text, extra) {
    var e = { t: this.t, tag: tag, text: text || tag };
    if (extra) for (var k in extra) e[k] = extra[k];
    this.events.push(e);
    if (this.events.length > 600) this.events.shift();
    this.lastEventText = e.text;
    return e;
  };

  World.prototype.ambientPressure = function (r) {
    if (!this.gravityModel.drag) return 0;
    var alt = earthAltitude(r);
    if (alt > 80) return 0;
    if (alt < 0) alt = 0;
    var rho = M.atmosphere(alt);
    return Math.min(1, rho / 1.225);
  };

  // ---------------------------------------------------------------- 积分步长
  // 高度分档（km）→ 步长（s）。这张表是**仿真与预测共用的唯一来源**。
  //
  // ⚠ 为什么必须共用：历史上 chooseStep 用 2~60 s，而 closestApproach 用 120 s、
  // MCC 的 numericPropagateGeocentric 用 tof/900 ≈ 292 s —— 三条不同的曲线。
  // 于是"预测轨迹"和"实际飞行"根本不是同一条轨道：TLI 瞄准报告近月点 250 km，
  // 真正飞到的是 1 936 km（实测从 TLI 关机状态用 2 s 与 292 s 两种步长外推，
  // 近月点差 864 km）。LOI 在 1 936 km 的捕获要多烧 5 t 推进剂，服务舱见底，
  // M5 后面全部连锁失败。以后**任何预测都必须走这张表**。
  function stepForAlt(alt) {
    if (alt < 3) return 0.02;
    if (alt < 60) return 0.1;
    if (alt < 400) return 0.5;
    if (alt < 3000) return 2;
    if (alt < 30000) return 10;
    if (alt < 200000) return 30;
    return 60;
  }

  // 主天体判定的迟滞（与 World.prototype.updatePrimary 完全一致）
  function nextPrimary(t, r, cur) {
    var dm = V.dist(r, A.moonState(t).r);
    if (cur === 'MOON') return dm > B.MOON.soi * 1.1 ? 'EARTH' : 'MOON';
    return dm < B.MOON.soi * 0.99 ? 'MOON' : 'EARTH';
  }

  // 预测用的"仿真同款"步长
  function simStep(t, r, prim) {
    var dm = V.dist(r, A.moonState(t).r);
    return stepForAlt(prim === 'MOON' ? dm - B.MOON.radius : earthAltitude(r));
  }

  // 用**仿真同款步长**把弹道积分到 tEnd（预测/瞄准的唯一入口）。
  // opts.closest：记录对月球的真正最近接近点（近月点）；
  // opts.stopKm ：到月心距离小于该值就停（用于"滑到某处"）。
  function integrateSim(world, r0, v0, t0, tEnd, opts) {
    opts = opts || {};
    var r = r0.slice(), v = v0.slice(), t = t0;
    var prim = opts.primary || nextPrimary(t0, r0, 'EARTH');
    var stopKm = opts.stopKm || 0;
    var dMin = 1e12, rMin = null, tMin = t0, vMin = null, away = 0;
    var guard = 0, maxSteps = opts.maxSteps || 400000;
    while (t < tEnd - 1e-9 && guard++ < maxSteps) {
      var dm = V.dist(r, A.moonState(t).r);
      if (stopKm && dm <= stopKm) break;
      if (opts.closest) {
        if (dm < dMin) { dMin = dm; rMin = r.slice(); tMin = t; vMin = v.slice(); away = 0; }
        else if (rMin) {
          // 已过近月点：确认真的在远离就收工（否则被"捕获"在环月轨道上要跑满全程）
          away++;
          if (dm - B.MOON.radius > (dMin - B.MOON.radius) * 3 + 2000 && away > 30) break;
        }
      }
      prim = nextPrimary(t, r, prim);
      // opts.fixedH：用固定步长（自检/收敛性验证用）。步长表再合理也只是"猜"，
      // 唯一能证明它够用的办法就是拿一个细得多的固定步长跑同一条弹道做参考解。
      var h = opts.fixedH || stepForAlt(prim === 'MOON' ? dm - B.MOON.radius : earthAltitude(r));
      if (t + h > tEnd) h = tEnd - t;
      var st = M.rk4Step(function (tt, rr) { return world.gravity(tt, rr); }, t, r, v, h);
      r = st.r; v = st.v; t += h;
    }
    if (opts.closest) {
      return rMin ? { alt: dMin - B.MOON.radius, dist: dMin, r: rMin, t: tMin, v: vMin,
        passed: away > 0, exhausted: guard >= maxSteps && t < tEnd - 1e-9 } : null;
    }
    return { r: r, v: v, t: t, exhausted: guard >= maxSteps && t < tEnd - 1e-9 };
  }

  World.prototype.chooseStep = function () {
    var h = 0.05, maxH = 90;
    for (var i = 0; i < this.crafts.length; i++) {
      var c = this.crafts[i];
      if (c.crashed) continue;
      var alt = c.primary === 'MOON'
        ? V.dist(c.r, A.moonState(this.t).r) - B.MOON.radius
        : earthAltitude(c.r);
      var hi = stepForAlt(alt);
      if (hi > h) h = hi;
      if (c.throttle > 0) h = Math.min(h, 0.5);
      if (V.mag(c.v) > 3 && alt < 300) h = Math.min(h, 0.2);
      // 入轨圆化制导（vgo/vgoMoon）期间进一步收步长：有限推力是"整步施加"，
      // 步长 = 每步速度增量 a·h，也就是制导抖振的幅度。步长不压住，制导就在
      // 整步频率上左右翻转（净冲量≈0、推进剂照烧）——见 vgoEarthTarget 注释。
      var md = c.attitude && c.attitude.mode;
      if (md === 'vgo' || md === 'vgoMoon') {
        var hIns = insCfg(this, 'insertH', INS_H);
        if (h > hIns) h = hIns;
      }
    }
    // 有限点火末端要收步长：推力整步施加，步长太大就"一跳跨过目标速度"
    //（S-IVB 满推力 6 m/s² 下 0.5 s 就是 3 m/s，末端必须细算到 tol 量级）
    // ⚠ 有限点火**开始的那一步**也必须在步长表上掐住，不能只看 cb.terminal。
    //   原来只掐 b.terminal，而 b.terminal 是在 updateBurn 里"接近目标速度"时才置位；
    //   点火的第一步之前 c.throttle 还是 0（上面那条 min(0.5) 还没生效），
    //   于是这一步的步长就是滑行段的 30~60 s —— 远大于 maxT（中途修正只有几秒），
    //   updateBurn 一看 b.t > maxT 立刻 endBurn('timeout')，throttleCmd 归零，
    //   紧跟其后的 ignite() 一点都不烧。
    //   实测：末段修正连报 6 次"已启动 19.4 m/s"，飞船质量 47 198 kg 一动不动，
    //   近月点 321 km 六次点火后还是 320 km —— 因为一次都没真的点着。
    //   （滑行段倍率高时 dt*warp 能到 30 s 以上，任何小点火都会被这一步吃掉。）
    for (var k = 0; k < this.crafts.length; k++) {
      var cb = this.crafts[k].burn;
      if (cb && cb.active) {
        h = Math.min(h, 0.5);
        if (cb.terminal) h = Math.min(h, cb.termH || 0.02);
        // 开环**定时短脉冲**（dirFixed + T，交会 CW 脉冲用的就是它）：把步长夹到
        // "剩余点火时间"，让末步精确落在 T 上。否则滑行段一步 0.5~60 s 会直接跨过
        // 整个脉冲（updateBurn 里 b.t 先加 h 再判 T），几十毫秒的脉冲整段丢失。
        // ⚠ 只夹"有 T 且无 speedOrb"的脉冲 —— 有 speedOrb 的大机动（TLI/LOI/TEI）
        //   靠速度判据关机，不受定时约束，这里一律不碰。
        if (cb.openloop && cb.T && !cb.speedOrb) {
          var remT = cb.T - cb.t;
          if (remT > 1e-6 && remT < h) h = remT;
        }
      }
    }
    return Math.min(h, maxH);
  };

  World.prototype.advance = function (dtWall) {
    if (!this.running) return 0;
    var target = dtWall * this.warp;
    if (this._advanceStopAt !== undefined && this._advanceStopAt !== null) {
      var dStop = this._advanceStopAt - this.t;
      // 浮点：target 被夹到 stop 之后，多步累加可能停在 stop 下方约 1e-10 s，
      // 于是脚本判据 `w.t >= stop` 永远为假 —— 演示会死等在这一步（实测 M5
      // 卡在「等待转移窗口」T+15489 不动，120 万帧一帧都没推进）。残差小于
      // 1 ms 时直接吸附到 stop（远小于任何有物理意义的步长）。
      if (dStop > 0 && dStop < 1e-3) { this.t = this._advanceStopAt; dStop = 0; }
      target = Math.max(0, Math.min(target, dStop));
    }
    var remain = target, sim = 0, n = 0;
    // T+135 s：S-IC 中央发动机关机 —— 五台 F-1 里中央那台先关，推力降为 80%
    //（真实时序；其余四台在 T+162 s 左右随一级分离）。用一次性事件而不是
    // 把时间塞进推力函数，保持"推力只依赖模块状态"的架构。
    if (!this._cecDone && this.t >= 135) {
      this._cecDone = true;
      for (var ci = 0; ci < this.crafts.length; ci++) {
        var mds = this.crafts[ci].modules;
        for (var mj = 0; mj < mds.length; mj++) {
          if (mds[mj].id === 'S-IC') mds[mj].thrustScale = 0.8;
        }
      }
      this.pushEvent && this.pushEvent('CECO', 'S-IC 中央发动机关机（推力降为 80%）');
    }
    while (remain > 1e-9 && n < 1400) {
      var h = this.chooseStep();
      if (h > remain) h = remain;
      for (var i = 0; i < this.crafts.length; i++) {
        var c = this.crafts[i];
        if (c.crashed) continue;
        c.ambientP = this.ambientPressure(c.r);
        this.updateBurn(c, h);          // 有限点火：先更新制导/油门，再消耗推进剂
        c.ignite(h);
        this.stepCraft(c, h);
      }
      this.t += h;
      remain -= h; sim += h; n++;
      if (n % 8 === 0) this.recordHistory();
    }
    this.stepsLastFrame = n;
    this.simulated = (this.simulated || 0) + sim;
    if (this.autoStage) {
      for (var s = 0; s < this.crafts.length; s++) this.tryAutoStage(this.crafts[s]);
    }
    // 上升制导在进入 S-IVB 段后自动交班给入轨（圆化）制导，由后者自动关机
    for (var g = 0; g < this.crafts.length; g++) {
      var cg = this.crafts[g];
      if (cg.attitude.mode === 'launch' && cg.stageIndex >= 2 && !cg.crashed) {
        // 月球上升要交给月球专用的入轨制导（vgoMoon）：地球那套是"当前半径圆化"，
        // 在月球上几公里高就把油门收掉（实测上升级停在 22 × 115 km 的椭圆上爬不上去）
        cg.attitude.mode = (cg.primary === 'MOON') ? 'vgoMoon' : 'vgo';
        this.pushEvent('GUID', '上升制导交班：进入入轨圆化制导阶段');
      }
    }
    // 速度增量归零制导的自动关机
    for (var v = 0; v < this.crafts.length; v++) {
      var cc = this.crafts[v];
      if (cc.attitude.mode === 'vgo' && (cc.throttleCmd || 0) > 0) {
        if (vgoResidual(this, cc) < 1.5) {
          cc.throttleCmd = 0; cc.throttle = 0;
          this.pushEvent('CUTOFF', '制导关机：已进入目标轨道');
        }
      }
      // 月球上升入轨：**允许重新点火**（抬远月点 → 到远月点再抬近月点 = 圆化），
      // 只有"高度到位且残差已经很小"才真正关机。地球那套一次性关机在这里
      // 会把飞船留在近月点 5 km 的椭圆上。
      if ((cc.attitude.mode === 'vgoMoon' ||
           (cc.attitude.mode === 'vgo' && cc.primary === 'MOON')) &&
          !cc.crashed && !cc.landed) {
        var altM = V.mag(V.sub(cc.r, A.moonState(this.t).r)) - B.MOON.radius;
        var tgtM = (this.targetAlt || 111);
        // 判据用**轨道根数**而不是"速度残差"：残差判据在接近目标时会没完没了地
        // 抠那几 m/s（实测上升级的 APS 全烧光、近月点还停在 17 km）。
        // 真实的入轨判据也是"近月点/远月点到位"。
        var msA = A.moonState(this.t);
        var relA = V.sub(cc.r, msA.r);
        var elA = M.elements(B.MOON.mu, relA, V.sub(cc.v, msA.v));
        var periA = isFinite(elA.periapsis) ? elA.periapsis - B.MOON.radius : -1e9;
        var apoA = isFinite(elA.apoapsis) ? elA.apoapsis - B.MOON.radius : 1e9;
        var resM = vgoMoonResidual(this, cc);
        var periGate = (this.periGate === undefined) ? 25 : this.periGate;
        // ⚠ 判据必须**同时**给远月点一个上界。原来只有 `apoA > tgtM - 10`
        //   （"够高就关机"）：上升级在头 25 km 是**常开油门**爬升，远月点会先
        //   被抬得很高，而近月点这时候还压在地面附近 —— 于是 apoA 早已 >> tgtM、
        //   periA 还不到 25，关机条件不成立，制导继续在远月点点火抬近月点，
        //   每抬一次远月点也跟着涨。实测最后停在 **137 × 396 km** 的极偏心轨道
        //   （目标是 ~170 km 圆轨道）。带着这条轨道进交会，共椭圆逼近和 TPI
        //   都收不进去 —— 实测卡在 2.5~6.4 km 之间、「_rndzCool」每到期就被
        //   重新武装，状态机在 tpi/chase 之间弹了 60 万秒，永远到不了 150 m。
        //   补上上界之后，远月点偏高时判据不成立，制导继续工作 ——
        //   而 vgoMoonTarget 的回复力正好是"远月点偏高 → 目标速度变小 →
        //   在远月点反向点火" ✓ 会把远月点拉回来。
        var apoHi = tgtM + 150;
        if (periA > periGate && apoA > tgtM - 10 && apoA < apoHi) {
          if ((cc.throttleCmd || 0) > 0) this.pushEvent('CUTOFF', '制导关机：已进入目标环月轨道');
          cc.throttleCmd = 0; cc.throttle = 0;
        } else if (cc.activeModule() && cc.activeModule().module.prop > 1e-9) {
          // 抬近月点要在**远月点**烧最省（"一直开着油门"会在近月点附近白烧，
          // 实测上升级把 2 353 kg APS 全烧光、近月点还停在 17 km）。
          // 头 25 km 是爬升段，油门常开；之后只在远月点附近点火。
          var rNowA = V.mag(relA);
          var nearApo = !isFinite(elA.apoapsis) || rNowA > 0.97 * elA.apoapsis;
          if (altM < 25 || nearApo) cc.throttleCmd = 1;
          else { cc.throttleCmd = 0; cc.throttle = 0; }
        } else {
          cc.throttleCmd = 0; cc.throttle = 0;
        }
      }
    }
    for (var j = 0; j < this.crafts.length; j++) {
      this.updatePrimary(this.crafts[j]);
      this.checkSurface(this.crafts[j]);
    }
    return sim;
  };

  // 当前级推进剂耗尽 -> 自动分级
  World.prototype.tryAutoStage = function (c) {
    if (c.crashed || c.landed) return;
    var ms = c.modules;
    for (var i = 0; i < ms.length; i++) {
      if (Math.abs(ms[i].stage - c.stageIndex) < 1e-9 && ms[i].hasEngine) {
        if (ms[i].prop <= 1e-9 && ms[i].jettison && ms.length > 1) {
          var before = ms.length;
          var dumped = c.stageUp();
          if (dumped.length) {
            this.pushEvent('STAGE', '分级：抛离 ' + dumped.join(' + '));
          }
        }
        return;
      }
    }
  };

  World.prototype.recordHistory = function () {
    var c = this.master();
    if (!c) return;
    var last = this.history[this.history.length - 1];
    if (last && Math.abs(this.t - last.t) < 30) return;
    this.history.push({ t: this.t, r: c.r.slice(), p: c.primary });
    if (this.history.length > 30000) this.history.shift();
  };

  World.prototype.checkSurface = function (c) {
    // 已坠毁的飞行器直接跳过 —— 否则它停在表面附近，每一步都会
    // 重新判定"撞击"并往日志里刷同一条事件（实测一次坠毁刷了 20+ 条）。
    if (c.crashed) return;
    var isMoon = c.primary === 'MOON';
    var center, vcenter, radius, bodyName;
    if (isMoon) {
      var ms = A.moonState(this.t);
      center = ms.r; vcenter = ms.v; radius = B.MOON.radius; bodyName = '月面';
    } else {
      center = [0, 0, 0]; vcenter = [0, 0, 0]; radius = earthRadiusAt(c.r); bodyName = '海面';
    }
    var rel = V.sub(c.r, center);
    var alt = V.mag(rel) - radius;
    var up = V.unit(rel);

    // 地表速度
    var vSurf;
    if (isMoon) {
      var om = V.mul(V.cross(center, vcenter), 1 / V.mag2(center));
      vSurf = V.add(vcenter, V.cross(om, rel));
    } else {
      var w = B.EARTH.omega;
      vSurf = [-w * c.r[1], w * c.r[0], 0];
    }
    var vrel = V.sub(c.v, vSurf);
    var vv = V.mag(vrel) * 1000;                 // m/s
    var vUp = V.dot(vrel, up) * 1000;            // 径向（向外为正）m/s

    // 已经在地面上：保持在原地并随天体自转；推力把它抬起来或高度超过 2 km 才算起飞
    var thrusting = (c.throttle > 0) && c.currentThrust() > 0;
    if (c.landed) {
      if (alt > 2 || (thrusting && vUp > 0.2)) { c.landed = false; return; }
      snapToSurface(this, c, isMoon, vSurf);
      return;
    }
    // 只在真正贴地时才判定（alt 单位 km）。0.5 km 的阈值会让飞行器
    // 在月面上空 500 m 就被判「撞击」，动力下降根本没法落地。
    if (alt > 0.05) return;
    // 关键：正在上升（将要离地/刚离地）时不判定触地，否则起飞瞬间速度会被清空
    if (thrusting && vUp > 0) return;
    if (vUp > 0.2) return;

    // 海面有减速伞兜底（真实溅落约 9 m/s），月面是硬着陆（着陆腿可承受约 3 m/s）
    var tol = isMoon ? 3.0 : 15.0;
    if (vv > tol) {
      c.crashed = true;
      c.throttle = 0;
      c.throttleCmd = 0;
      this.pushEvent('CRASH', bodyName + '撞击，相对速度 ' + vv.toFixed(1) + ' m/s');
      return;
    }
    snapToSurface(this, c, isMoon, vSurf);
    c.landed = true;
    this.pushEvent(isMoon ? 'TOUCHDOWN' : 'SPLASHDOWN',
      isMoon ? '登月舱触月' : '溅落');
  };

  // 贴合地表并随天体自转一起运动（避免停在惯性系里被"甩飞"）
  function snapToSurface(world, c, isMoon, vSurf) {
    if (isMoon) {
      var ll = A.moonLatLon(world.t, c.r);
      var sp = A.moonSurfacePoint(world.t, ll.lat, ll.lon, 0);
      c.r = sp.r; c.v = sp.v;
    } else {
      var ll2 = A.earthLatLon(world.t, c.r);
      var sp2 = A.siteState(world.t, ll2.lat, ll2.lon, Math.max(0, ll2.alt));
      c.r = sp2.r; c.v = sp2.v;
    }
  }

  // ------------------------------------------------------------ 制导
  function localFrame(world, c) {
    var center = world.primaryPos(c.primary);
    var vc = world.primaryVel(c.primary);
    var rel = V.sub(c.r, center);
    var vrel = V.sub(c.v, vc);
    return { rel: rel, vrel: vrel, up: V.unit(rel), center: center };
  }

  function guidanceDirection(world, c) {
    var f = localFrame(world, c);
    var pro = V.mag(f.vrel) > 1e-6 ? V.unit(f.vrel) : V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    var nrm = V.mag(h) > 1e-6 ? V.unit(h) : [0, 0, 1];
    var rad = f.up;
    var d;
    switch (c.attitude.mode) {
      case 'prograde': d = pro; break;
      case 'retrograde': d = V.mul(pro, -1); break;
      case 'normal': d = nrm; break;
      case 'antinormal': d = V.mul(nrm, -1); break;
      case 'radial': d = rad; break;
      case 'antiradial': d = V.mul(rad, -1); break;
      case 'launch': d = launchGuidance(world, c, f, pro, nrm, rad); break;
      case 'vgo': d = vgoGuidance(world, c, f, nrm); break;
      case 'vgoMoon': d = vgoMoonGuidance(world, c, f, nrm); break;
      case 'hold': d = c.attitude.vec; break;
      default: d = pro;
    }
    return V.mag(d) > 1e-9 ? V.unit(d) : [0, 0, 1];
  }

  // 速度增量归零制导（入轨圆化）：把速度矢量推向下一个目标圆轨道速度
  // 地球入轨的目标状态（vgoGuidance 与 vgoResidual 必须用同一套，否则
  // 关机判据会在还没爬到目标高度时就归零）：
  //   切向目标 = 目标高度的圆速度 √(μ/r_t)
  //   径向目标 = (r_t − r)/40，限幅在 [−0.05, +0.25] km/s
  // 物理含义：不是"速度够了就关机"，而是"把飞船导到目标轨道状态" ——
  // 真实土星五号的 S-IVB 入轨制导也是这个思路。旧写法（只比切向圆速度）
  // 在 177 km 就满足残差判据，而关机半径就是近地点 → 近地点永远压不上去。
  // 入轨圆化制导的 PD 整定参数（世界对象可覆盖，便于整定/回归对比）：
  //   INS_T  ：径向位置项时间常数（s）。越大越慢；太小会过冲。
  //   INS_KD ：径向速度阻尼系数。ζ≈1 要求 ≈ 2√(增益)，实测 2.0 收敛平稳。
  //   INS_VR ：径向目标速度限幅（km/s）。
  //   INS_H  ：入轨段最大积分步长（s）。有限推力整步施加，步长就是"抖振幅度"
  //            （a·h，a≈7 m/s²）：h=0.5 → 3.6 m/s 抖振，与真实控制信号同量级，
  //            于是制导在"上/下"之间以整步频率翻转 —— 油门常开却净冲量为零，
  //            S-IVB 在 240 s 里空烧掉 ~57 t 推进剂（入轨 T+941 而非真实 T+629）。
  //   实测整定（M5 真实上升 → 停泊轨道，S-IVB 剩余推进剂 / 关机轨道）：
  //     T=30,KD=1.5,H=0.2（原值）→ 关机 T+941，只剩 12.9 t（TLI 点不着）
  //     T=15,KD=2.0,H=0.05       → 关机 T+829，剩 39.7 t
  //     T=12,KD=2.0,H=0.05       → 关机 T+780，剩 51.6 t，轨道 184.2×184.8 ← 采用
  //     T=8 ,KD=2.0,H=0.05       → 关机 T+677，剩 76.2 t，但**轨道还没圆化**：
  //                                 T+630 时弹道仍是负半长轴（亚轨道），T+664 才刚
  //                                 变成椭圆，关机时 a≈140 km、e≈6.9e-3 ⇒ 95×184.6 km，
  //                                 **过不了停泊轨道闸门**。所以不能为省油提前关机。
  //   ⚠ H 几乎不改变关机时刻（0.05→0.002 只从 T+780 挪到 T+783）：这里的"多烧 100 s"
  //      不是步长抖振，而是**位置项用的是瞬时半径 r**，而 r 在一个椭圆上每圈才穿过目标
  //      半径两次 —— 判据要等到那一刻，制导就继续（很低效地）烧油把轨道往目标半径抬。
  //      T+682→T+780 烧掉 23.6 t、半长轴只抬 0.53 km（约 757 m/s 换 0.3 m/s 的有效 Δv）。
  //      这是本模型 M5 全流程 TLI 缺油的根因（见 AGENT_HANDOFF/09-交接-路线08执行状态.md）。
  //   采用 T=12 是 07 §U7 的原建议（"时间常数降到 12~15 s、阻尼调到 ≈2·v_rad"）。
  //   全部落在停泊轨道闸门内（184.1~184.5 × 184.8~185.2，i=32.552°）。
  // INS_KD 2.0 → 1.2（第 22 轮，恢复真实 SPS 18410 后重新整定）：
  //   轻堆的 S-II 交班状态更低更快，阻尼 2.0 会把爬升压得太狠、入轨多烧 6 t
  //   （实测 KD=2 剩 68.0 t / KD=1.2 剩 74.0 t，停泊轨道都合格）。
  //   74 t 时 TLI 可用 Δv ≈ 3509 m/s > 需求 3277 → M5 的 TLI 从此有富余。
  var INS_T = 8, INS_KD = 1.2, INS_VR = 0.30, INS_H = 0.05;
  // 入轨窗口判据：密切轨道的近/远地点与停泊轨道目标之差都 ≤ 该值即关机
  //（工具：APL.SITE.parkingPerigee/parkingApogee = 183.2/185.9，闸门 ±5 km）
  var INS_GATE = 2.0;
  function insCfg(world, k, dflt) {
    return (world && world[k] !== undefined && world[k] !== null) ? world[k] : dflt;
  }
  function vgoEarthTarget(world, c, f) {
    var r = V.mag(f.rel);
    if (r < 1) return null;
    var rt = B.EARTH.radius + (world.targetAlt || 184.55);
    var up = V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    var hz = V.mag(h) > 1e-9 ? V.unit(h) : [0, 0, 1];
    var tand = V.unit(V.cross(hz, up));
    var vTang = Math.sqrt(B.EARTH.mu / rt);
    // 径向目标 = 比例项 + 阻尼项（PD）：
    //   纯比例会冲过目标高度（实测 155×209 的椭圆），加阻尼项让爬升在
    //   目标高度前收住 → 关机时 r≈rt、径向速度≈0、切向=圆速度 → 近圆轨道。
    var vrNow = V.dot(f.vrel, up);
    var T = insCfg(world, 'insertT', INS_T);
    var KD = insCfg(world, 'insertKD', INS_KD);
    var lim = insCfg(world, 'insertVRad', INS_VR);
    var vRad = (rt - r) / T - KD * vrNow;
    if (vRad > lim) vRad = lim;
    if (vRad < -lim) vRad = -lim;
    return { vDes: V.add(V.mul(tand, vTang), V.mul(up, vRad)), rt: rt, r: r };
  }

  function vgoGuidance(world, c, f, nrm) {
    var r = V.mag(f.rel);
    if (r < 1) return c.attitude.vec;
    var mu = c.primary === 'MOON' ? B.MOON.mu : B.EARTH.mu;
    var up = V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    var hz = V.mag(h) > 1e-9 ? V.unit(h) : nrm;
    var tang = V.unit(V.cross(hz, up));
    // 地球入轨：瞄准目标轨道状态（见 vgoEarthTarget）
    if (c.primary !== 'MOON') {
      var tgE = vgoEarthTarget(world, c, f);
      if (tgE) {
        var dvE = V.sub(tgE.vDes, f.vrel);
        if (V.mag(dvE) < 1e-6) return c.attitude.vec;
        return V.unit(dvE);
      }
    }
    var vDes = V.mul(tang, Math.sqrt(mu / r));
    var dv = V.sub(vDes, f.vrel);
    if (V.mag(dv) < 1e-6) return c.attitude.vec;
    return V.unit(dv);
  }

  // ---------------------------------------------------- 月球上升入轨制导
  // 上升级的任务：从月面起飞 → 抬升到 111 km 环月轨道。
  // ⚠ 不能直接用地球那套 vgoGuidance：它把目标定成"**当前半径**上的圆轨道速度"，
  // 在月球上飞船几公里高时就满足判据、油门被收掉，结果停在一个"近月点 5 km、
  // 远月点 111 km"的椭圆上，一圈就撞回月面（实测 M5 的上升级就是这样摔的）。
  // 这里的目标是「远月点 = targetAlt 的椭圆在当前位置的切向速度」：
  //   v = sqrt(μ(2/r − 1/a))，a = (r + r_target)/2
  // 起飞段它会一直烧到把远月点抬到 111 km；滑到远月点附近时 a ≈ r_target，
  // 目标自动变成圆速度 —— 于是同一条制导律把近月点也抬起来，完成圆化。
  function vgoMoonTarget(world, c) {
    var f = localFrame(world, c);
    var r = V.mag(f.rel);
    if (r < 1) return null;
    var rt = B.MOON.radius + (world.targetAlt || 111);
    var up = V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    var hz = V.mag(h) > 1e-9 ? V.unit(h) : [0, 0, 1];
    var tang = V.unit(V.cross(hz, up));
    var a = (r + rt) / 2;
    var s = 2 / r - 1 / a;
    if (!(s > 0)) return null;
    return { vDes: V.mul(tang, Math.sqrt(B.MOON.mu * s)),
             alt: r - B.MOON.radius, vrel: f.vrel };
  }
  // 月球上升的推力方向：**受控爬升率 + 剩余推力全部给水平加速**。
  // 这是相对"纯速度闭环"和"固定俯仰程序"的关键区别：
  //  · 纯速度闭环会把飞船按在低空贴着月面水平加速（推进剂全耗在抵消重力上）；
  //  · 固定俯仰程序不闭环，低空/高空都不能自适应（实测各种参数都烧光油）。
  // 本式与动力下降的 landingControl 结构相同（那边已验证），只是上下颠倒：
  //   竖直：aV = g + (vv_des − vv)/τ，让爬升率朝期望值收敛
  //   水平：剩下的推力全部给"把水平速度推向目标轨道速度"的那个方向
  function vgoMoonGuidance(world, c, f, nrm) {
    var t = vgoMoonTarget(world, c);
    if (!t) return c.attitude.vec;
    var up = V.unit(f.rel);
    var r = V.mag(f.rel);
    var g = B.MOON.mu / (r * r) * 1000;                  // m/s²
    var act = c.activeModule();
    var aMax = act ? (act.module.thrust / c.mass()) : 3;
    if (!(aMax > 0.05)) aMax = 0.05;
    var vrel = V.mul(f.vrel, 1000);
    var vv = V.dot(vrel, up);
    var vhVec = V.sub(vrel, V.mul(up, vv));
    var vh = V.mag(vhVec);
    var tgtAlt = world.targetAlt || 111;
    // 期望爬升率：到目标高度时收到 0（平方衰减 → 末段几乎水平，最省 Δv）
    var k = 1 - V.clamp(t.alt / Math.max(tgtAlt, 1), 0, 1);
    var vvMax = (world.vvMax === undefined) ? 80 : world.vvMax;
    var vvDes = V.clamp(vvMax * k * k, 0, vvMax);
    var aV = V.clamp(g + (vvDes - vv) / 6.0, 0, aMax);
    var aH = Math.sqrt(Math.max(aMax * aMax - aV * aV, 0.01));
    var dv = V.sub(t.vDes, f.vrel);
    var hd = V.sub(dv, V.mul(up, V.dot(dv, up)));
    if (V.mag(hd) < 1e-9) hd = vh > 1 ? vhVec : V.cross(nrm, up);
    if (V.mag(hd) < 1e-9) hd = V.cross([0, 0, 1], up);
    return V.unit(V.add(V.mul(up, aV), V.mul(V.unit(hd), aH)));
  }
  function vgoMoonResidual(world, c) {
    var t = vgoMoonTarget(world, c);
    if (!t) return 1e9;
    return V.mag(V.sub(t.vDes, t.vrel)) * 1000;
  }

  // 速度增量归零的关机判据（返回剩余 Δv, m/s）
  function vgoResidual(world, c) {
    var f = localFrame(world, c);
    var r = V.mag(f.rel);
    if (r < 1) return 1e9;
    var mu = c.primary === 'MOON' ? B.MOON.mu : B.EARTH.mu;
    var up = V.unit(f.rel);
    var h = V.cross(f.rel, f.vrel);
    if (V.mag(h) < 1e-9) return 1e9;
    var tang = V.unit(V.cross(V.unit(h), up));
    // 地球入轨：关机判据 = "目标轨道状态误差"，不是"速度目标残余"。
    //   高度误差 Δr、径向速度 vr、切向速度误差 Δvt 都要小；位置误差按 INS_T
    //   折算成等效速度误差，量纲与调用方（< 1.5 m/s）一致。折算常数必须与
    //   vgoEarthTarget 的径向比例增益同源，否则"制导觉得到位了、判据还没到"。
    if (c.primary !== 'MOON') {
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
        var vrR = V.dot(f.vrel, up);
        var vtR = V.mag(V.sub(f.vrel, V.mul(up, vrR)));
        var vtDesR = Math.sqrt(B.EARTH.mu / tgR.rt);
        var Tr = insCfg(world, 'insertResT', insCfg(world, 'insertT', INS_T));
        var eqV = Math.sqrt(Math.pow((tgR.r - tgR.rt) / Tr, 2) +
                            Math.pow(vrR, 2) + Math.pow(vtR - vtDesR, 2));
        return eqV * 1000;
      }
    }
    var vDes = V.mul(tang, Math.sqrt(mu / r));
    return V.mag(V.sub(vDes, f.vrel)) * 1000;
  }

  function launchGuidance(world, c, f, pro, nrm, rad) {
    var altKm = earthAltitude(c.r);
    var gs = launchGroundDir(c);
    // 关键：发射方位角是相对地面（随地球自转）定义的，
    // 因此制导必须用「地固相对速度」，否则初始的正东自转速度会污染航向。
    var vrot = c.primary === 'MOON' ? [0, 0, 0]
      : [-B.EARTH.omega * c.r[1], B.EARTH.omega * c.r[0], 0];
    var vrel = V.sub(f.vrel, vrot);
    var vy = V.dot(vrel, rad);
    var vmag = V.mag(vrel);
    var vh = V.sub(vrel, V.mul(rad, vy));
    var hdir = V.mag(vh) > 0.03 ? V.unit(vh) : gs;
    var gamma = Math.atan2(vy, Math.sqrt(Math.max(vmag * vmag - vy * vy, 0)));
    var target = world.launchTarget || 185;
    var pitch;
    if (altKm < 45) {
      pitch = pitchFromTable(world.t, world.pitchScale);
    } else {
      if (!c._guid) c._guid = { h0: altKm, g0: Math.max(gamma, 6 * Math.PI / 180) };
      var frac = (altKm - c._guid.h0) / Math.max(world.guideH - c._guid.h0, 1);
      if (frac < 0) frac = 0;
      var gdes = c._guid.g0 * Math.max(0, 1 - frac);
      var corr = V.clamp((gdes - gamma) * 2.2, -0.42, 0.42);
      pitch = V.clamp(gdes + corr, -0.35, 1.0);
      if (altKm > world.flatAlt) pitch = gamma;
    }
    return V.add(V.mul(hdir, Math.cos(pitch)), V.mul(rad, Math.sin(pitch)));
  }

  function launchGroundDir(c) {
    var r = V.unit(c.r);
    var north = V.unit(V.sub([0, 0, 1], V.mul(r, V.dot([0, 0, 1], r))));
    var east = V.unit(V.cross([0, 0, 1], r));
    var az = (APL.SITE.azimuthGuidance || APL.SITE.azimuth) * Math.PI / 180;
    return V.unit(V.add(V.mul(north, Math.cos(az)), V.mul(east, Math.sin(az))));
  }

  function rotateAbout(u, axis, ang) {
    var co = Math.cos(ang), si = Math.sin(ang);
    var kxu = V.cross(axis, u), kdu = V.dot(axis, u);
    return V.unit([
      u[0] * co + kxu[0] * si + axis[0] * kdu * (1 - co),
      u[1] * co + kxu[1] * si + axis[1] * kdu * (1 - co),
      u[2] * co + kxu[2] * si + axis[2] * kdu * (1 - co)
    ]);
  }

  // 土星五号真实俯仰程序（相对当地地平线的仰角, 单位 deg）
  // 土星五号俯仰程序（推力方向相对当地地平线的仰角, 单位 deg）
  // 数值按 SA-506 飞行剖面对准：S-IC 关机时高度约 67 km、速度约 2.6 km/s。
  var PITCH_TABLE = [
    [0, 90.0], [11, 90.0], [16, 85.6], [22, 79.6], [30, 73.7], [40, 68.5],
    [55, 61.9], [70, 56.7], [90, 51.5], [110, 47.1], [135, 42.6], [160, 38.9],
    [200, 35.2], [260, 31.9], [330, 29.3], [400, 27.4], [460, 26.3],
    [520, 25.5], [570, 25.0], [640, 24.5], [720, 24.2], [820, 23.9],
    [1000, 23.7], [3000, 23.6]
  ];
  function pitchFromTable(t, scale) {
    var T = PITCH_TABLE;
    var deg;
    if (t <= 0) deg = 90;
    else {
      deg = T[T.length - 1][1];
      for (var i = 1; i < T.length; i++) {
        if (t <= T[i][0]) {
          var a = T[i - 1], b = T[i];
          var u = (t - a[0]) / (b[0] - a[0]);
          deg = a[1] + (b[1] - a[1]) * u;
          break;
        }
      }
    }
    if (scale && scale !== 1) deg = 90 - (90 - deg) * scale;
    if (deg > 90) deg = 90; if (deg < -5) deg = -5;
    return deg * Math.PI / 180;
  }

  function apogeeOf(world, c, key) {
    var k = key || c.primary;
    var body = k === 'MOON' ? B.MOON : B.EARTH;
    var center = world.primaryPos(k), vc = world.primaryVel(k);
    var el = M.elements(body.mu, V.sub(c.r, center), V.sub(c.v, vc));
    if (!isFinite(el.apoapsis)) return 1e9;
    return el.apoapsis - body.radius;
  }
  function perigeeOf(world, c, key) {
    var k = key || c.primary;
    var body = k === 'MOON' ? B.MOON : B.EARTH;
    var center = world.primaryPos(k), vc = world.primaryVel(k);
    var el = M.elements(body.mu, V.sub(c.r, center), V.sub(c.v, vc));
    return el.periapsis - body.radius;
  }

  // ==================================================== 自动制导（UI 与演示共用）

  // 动力下降点火窗口（距着陆点的斜距）：真实 Apollo 约 480 km，
  // 这里取 520 km 作为「全推力制动」的起点，兼顾推进剂余量。
  var PDI_RANGE_KM = 520;

  // 月球动力下降制导（高度/速度预算分配法）
  //   ① 竖直：下沉率 = 高度 / 水平制动所需时间，再受终端剖面限幅；
  //      竖直推力分量保证 ≥ 重力补偿，剩下的推力预算全部给水平制动。
  //   ② 水平：朝着陆点并消掉横向速度，用剩余预算限幅。
  //   竖直永远不会被水平制动"吃光预算"，因此不会出现"为了刹车而砸地"。
  function landingControl(world, c) {
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r);
    var rmag = V.mag(rel);
    var alt = rmag - B.MOON.radius;                          // km
    var up = V.unit(rel);
    var g = (B.MOON.mu / (rmag * rmag)) * 1000;              // m/s^2

    var site = A.moonSurfacePoint(world.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
    var vRel = V.mul(V.sub(c.v, ms.v), 1000);                // m/s
    var vv = V.dot(vRel, up);                                // 向上为正
    var vhVec = V.sub(vRel, V.mul(up, vv));
    var vh = V.mag(vhVec);
    var toSite = V.sub(site.r, c.r);
    var dSite = V.mag(toSite);                               // km
    var toSiteH = V.sub(toSite, V.mul(up, V.dot(toSite, up)));
    var dirSite = V.mag(toSiteH) > 1e-9 ? V.unit(toSiteH) : [0, 0, 0];

    var act = c.activeModule();
    var aMax = act ? (act.module.thrust / c.mass()) : 3;
    if (aMax < 0.05) aMax = 0.05;

    // ---- ① 竖直预算 ----
    var aHmax = Math.sqrt(Math.max(aMax * aMax - g * g, 0.05));
    var tBrake = Math.max(vh / aHmax, 25);                   // 水平制动所需时间 (s)
    var sinkBudget = (alt * 1000) / tBrake;
    var sinkCap = alt > 2.5 ? 20 : V.clamp(20 * Math.pow(alt / 2.5, 0.45), 0.4, 20);
    var sinkDes = V.clamp(Math.min(sinkBudget, sinkCap), 0.4, 70);
    var sinkNow = -vv;
    // 符号：下沉率为正（向下）；要让下沉率朝 sinkDes 收敛，竖直推力 = g − (sinkDes − sink)/τ
    var aV = V.clamp(g - (sinkDes - sinkNow) / 3.0, 0, aMax);

    // ---- ② 水平用剩余预算 ----
    var aHB = Math.sqrt(Math.max(aMax * aMax - aV * aV, 0.02));
    // 水平目标速度 = 剩余水平距离 / 剩余下降时间，保证两者同时收敛
    var tGo = (alt * 1000) / Math.max(sinkDes, 0.5);
    var vhTarget = V.clamp((dSite * 1000) / Math.max(tGo, 25), 0, 900);
    var aHvec = V.mul(V.sub(V.mul(dirSite, vhTarget), vhVec), 1 / 6.0);
    var aHmag = V.mag(aHvec);
    if (aHmag > aHB && aHmag > 1e-9) aHvec = V.mul(aHvec, aHB / aHmag);

    var cmd = V.add(V.mul(up, aV), aHvec);
    var mag = V.mag(cmd);
    c.attitude.mode = 'hold';
    if (mag < 1e-9) { c.attitude.vec = up; c.throttleCmd = 0; return null; }
    c.attitude.vec = V.unit(cmd);

    var total = Math.sqrt(vh * vh + vv * vv);
    if (alt < 0.004 && total < 1.2) c.throttleCmd = 0;
    else c.throttleCmd = V.clamp(mag / aMax,
      (act ? (act.module.throttleMin || 0.1) : 0.1), 1);

    return { alt: alt, dSite: dSite, sinkDes: sinkDes, sinkNow: sinkNow,
             vh: vh, vmag: total };
  }

  // 月面起飞制导：垂直上升 → 俯仰程序转弯 → 高度足够后交给入轨制导
  function lunarAscentControl(world, c, targetAltKm, tIgn) {
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r);
    var alt = V.mag(rel) - B.MOON.radius;
    var up = V.unit(rel);
    var vrel = V.sub(c.v, ms.v);
    var vh = V.sub(vrel, V.mul(up, V.dot(vrel, up)));
    var hdir;
    // ★★★ 必须沿**目标（指令舱）的轨道面**飞 ★★★
    // 月球上升不是"随便入一条环月轨道就行"：上升级的轨道面必须和指令舱的
    // 轨道面重合，否则交会时两器有十几度的平面差 —— 相对速度永远是
    // 2v·sin(Δi/2) 量级（实测上升级入的是 **14.28°** 倾角差，距离拉到 35 km
    // 时相对速度仍有 392 m/s），收拢段一路硬顶也收不到 150 m。
    // 真实阿波罗也是这么做的：上升段按"与指令舱共面"的方位角起飞。
    // 指令舱的轨道面本来就是 LOI 用 plane:'site' 定出来的、过着陆点，
    // 所以在着陆点沿"指令舱的水平速度方向"爬升，入的就是同一个面。
    var vhT = null;
    for (var ti = 0; ti < world.crafts.length; ti++) {
      var o = world.crafts[ti];
      if (o === c || o.crashed) continue;
      var orel = V.sub(o.v, ms.v);
      var oh = V.sub(orel, V.mul(up, V.dot(orel, up)));
      if (V.mag(oh) > 1e-6) { vhT = V.unit(oh); break; }
    }
    if (vhT) hdir = vhT;
    else if (V.mag(vh) > 0.004) hdir = V.unit(vh);
    else {
      var east = V.cross(V.unit(ms.r), ms.v);       // 沿月球轨道运动方向
      east = V.mag(east) > 1e-9 ? V.unit(east) : [1, 0, 0];
      var tmp = V.cross(up, east);
      hdir = V.mag(tmp) > 1e-9 ? V.unit(tmp) : east;
    }
    // 俯仰程序：前 6 秒垂直，之后按 0.45°/s 压平
    var pitch = tIgn < 6 ? 90 : V.clamp(90 - (tIgn - 6) * 0.45, 0, 90);
    var pr = pitch * M.D2R;
    var dir = V.unit(V.add(V.mul(hdir, Math.cos(pr)), V.mul(up, Math.sin(pr))));
    c.attitude.mode = 'hold';
    c.attitude.vec = dir;
    c.throttleCmd = 1;
    return { alt: alt, pitch: pitch };
  }

  // 抛掉指定模块（例如再入前抛弃服务舱）
  function jettisonModule(c, id) {
    var ms = c.modules;
    for (var i = ms.length - 1; i >= 0; i--) {
      if (ms[i].id === id) { ms.splice(i, 1); return ms[i]; }
    }
    return null;
  }

  // 把当前环月轨道降到指定近月点高度（相当于真实的「下降轨道修正」DOI/PDC）。
  // 真实量级：111 km 圆轨道 → 15 km 近月点约 22 m/s（阿波罗 11 号实飞 DOI 24.5 m/s，
  // 在近月点对面（远月点）点火）。用闭环有限点火：目标速度 = 「以当前位置为起点、
  // 近月点正好落在 rp」的那条轨道所需的速度，每一步重算。
  function deorbitTo(world, c, periAltKm) {
    var rp = B.MOON.radius + Math.max(1, periAltKm);
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
    var r = V.mag(rel), v = V.mag(vrel);
    if (r <= rp * 1.001 || v < 1e-9) return null;
    var a = (r + rp) / 2;
    var vN = Math.sqrt(B.MOON.mu * (2 / r - 1 / a));
    if (!(v > vN + 1e-7)) return null;
    if (c.burn && c.burn.active) return { burning: true, dv: 0, periAlt: periAltKm };
    // 目标轨道 = 以当前位置为远月点、近月点 = rp 的椭圆（保持当前轨道面）
    var vt0 = V.add(ms.v, V.mul(V.unit(vrel), vN));
    var dv0 = V.mag(V.sub(vt0, c.v));
    var orb = { mu: B.MOON.mu, periR: rp, n: V.unit(V.cross(rel, vrel)), body: 'MOON' };
    var rD = world.startFiniteManeuver(c, orb, {
      label: 'DOI', retro: true, maxT: 900, dir: V.sub(vt0, c.v)
    });
    if (rD.failed || rD.noPropellant) return { burning: false, dv: dv0, periAlt: periAltKm, failed: true };
    return { burning: true, dv: dv0, periAlt: periAltKm };
  }

  // 月球轨道交会：把相对距离与相对速度一起收住（简化比例导引）
  // 环月交会（自动）：**兰伯特迭代制导**，不是"朝目标推一把"。
  // 为什么不能用比例导引：两台飞行器在相差几十公里的环月轨道上，"指向目标的
  // 推力"在旋转参考系里根本不能让两者接近（实测登月舱被推着往月面掉）。
  // 正确的做法（也是现代自动交会的做法）：每帧用**月心兰伯特**解一条从当前位置
  // 到"目标在 t+tof 时刻的位置"的转移，闭环点火打出这个 Δv；烧完再解一次。
  // tof 取 1.35 个目标轨道周期，避开"整数圈退化"并给足调节时间。
  // 环月交会（自动）——两段式：
  //  ① 远距离（> 80 km）：**相位调整**。两器在同一条环月轨道上时，"朝目标推一把"
  //     是没用的（旋转参考系里只会把飞船推离轨道）。真实交会的做法是改变自己的
  //     轨道周期，靠周期差在一两圈里把沿航迹的夹角磨掉：
  //         ΔP = −P·Δθ/(2π·N)，Δa = (2a/3)(ΔP/P)，Δv = (v/2)(Δa/a)
  //  ② 近距离：兰伯特（短 TOF）+ 闭环点火，把位置和速度一起收住。
  // 环月交会（自动）——两段式，在独立的 Node 试验台上验证过（能收到 100 m 级）。
  //
  // ① 远距离（> 150 km）：**轨道匹配 + 相位调整**
  //    · 匹配：以**目标轨道的半长轴 aT**为基准，在近/远月点点火把自己的
  //      另一端调到 aT（用"瞬时半径"当基准是错的 —— 目标自己在偏心轨道上，
  //      高度会越修越偏，实测把登月舱从 17×136 修成 167×329）；
  //    · 相位：两器共轨之后周期相同、相位差永远不变，必须**故意**把自己送到
  //      一条周期不同的"相位轨道"上去等相位扫过。⚠ 方向只能**往上**
  //      （aT + 400 km）：往下会被月面卡住（从 1 922 km 圆轨道往下，
  //      近月点下限只能到 ~1 850 km，一圈才磨 30 s，根本来不及）。
  //      往上永远安全，周期差 ~1.5×400/1922 = 31%，相位扫一圈只要 ~7.5 h。
  // ② 近距离（≤ 150 km）：**相对速度闭环**（比例导引的滑降形式）：
  //      期望接近率 vClose = 0.004·d（0.2 ~ 50 m/s），把相对速度拉向它。
  //    近距离绝不能用兰伯特：两点几乎重合时兰伯特是退化的（实测不但收不拢，
  //    还会把飞船推进逃逸轨道）。
  // 环月交会（自动）——三段式状态机，在独立 Node 试验台上逐步验证。
  //
  // ① match：把自己的轨道改成"半长轴 = aT、尽量圆"。
  //    在离 aT 更远的那一端点火（近月点差得多就在近月点点火改远月点，反之亦然）。
  //    ⚠ 两端都要修：只改一端会留下很扁的椭圆，判据永远不满足，制导就会一直
  //      点火把推进剂烧光（实测 8 200 kg 全烧完）。
  //    ⚠ 点火用**闭环矢量目标**（精度 0.2 m/s）。开环"速率判据"在这种几十 m/s
  //      的小点火上会过冲，修一次偏一次，同样把油烧光。
  // ② phasing：两器共轨后周期相同、相位差永远不变，必须故意把自己送到一条
  //    周期不同的"相位轨道"上等相位扫过。方向只能**往上**（aT + 400 km）：
  //    往下会被月面卡住（从 1 922 km 圆轨道往下，近月点下限 ~1 850 km，
  //    一圈只磨 30 s，来不及）；往上永远安全，周期差 ~31%，7~8 h 内必然对上。
  // ③ 近距离（≤ 150 km）：**相对速度闭环**（比例导引的滑降形式）：
  //    期望接近率 vClose = 0.004·d（0.2 ~ 50 m/s）。近距离绝不能用兰伯特 ——
  //    两点几乎重合时兰伯特是退化的。
  // =====================================================================
  // 环月交会终端：Clohessy–Wiltshire（CW）旋转参考系闭环制导
  //
  // 参考系以目标航天器为原点、随目标轨道角速度 n 旋转：
  //   x = V-bar，沿目标轨道切向（速度方向）
  //   y = 目标轨道法向
  //   z = R-bar，径向向外
  // ⚠ 相对速度必须扣掉参考系自转项：v_rot = (v_c − v_t) − ω × r_rel，ω = n·ŷ。
  //    漏掉这一项时，两器同轨相对静止却会被算成"有几十 m/s 的相对速度"，
  //    任何闭环都会对着一个假误差猛烧。
  // CW 线性化相对运动（无推力）：
  //   ẍ = −2n·ż
  //   ÿ = −n²·y
  //   z̈ =  2n·ẋ + 3n²·z
  // 要产生期望的相对加速度 a_des，所需推力加速度 a_thrust = a_des − aCW，
  // 其中 aCW = [−2n ż, −n² y, 2n ẋ + 3n² z]。这就是"固定 PD + 前馈"的前馈项：
  // 它把旋转系自转、引力梯度和三轴耦合一次性抵消，PD 只需处理误差。
  //
  // 四个**单向**阶段（不再有 match/phasing/chase/tpi/close 互相竞争）：
  //   1 coplanar   共面：轨道面夹角 < 0.1° 且法向相对速度 < 1 m/s
  //   2 coelliptic 共椭圆：半长轴差 < 1 km，近/远月点都在目标 ±5 km
  //   3 phase      相位等待：真正位于目标后方 20~40 km（V-bar）
  //   4 terminal   终端接近：只用 CW PD 前馈收到 ≤150 m、rv ≤1 m/s，
  //                并连续保持 300 s 才算 done
  //
  // ⚠ 真实 APS 不可节流（throttleMin = 1），不能用"持续小油门"——min 会把小
  //   油门放大成满推力。每个控制周期把期望加速度折算成**短脉冲 Δv**，交给
  //   world.finiteBurn 的 dirFixed + dvIdeal + T 开环定时模式执行（满推力、按时关机）。
  // ⚠ 终端绝不用兰伯特，也不直接赋值 r/v。

  // 目标参考系下的相对状态（CW 分量，km / km·s⁻¹）
  function cwRelativeState(c, target, ms, mu) {
    var rt = V.sub(target.r, ms.r), vt = V.sub(target.v, ms.v);
    var rtm = V.mag(rt);
    if (!(rtm > 1) || V.mag(vt) < 1e-9) return null;
    var yHat = V.unit(V.cross(rt, vt));            // 轨道法向
    var zHat = V.unit(rt);                          // 径向向外（R-bar）
    var xHat = V.cross(yHat, zHat);                 // 沿迹向（V-bar）
    if (V.mag(xHat) < 1e-9) return null;
    xHat = V.unit(xHat);
    var n = Math.sqrt(mu / (rtm * rtm * rtm));      // 目标轨道平均运动
    var rel = V.sub(c.r, target.r);
    var vrel = V.sub(c.v, target.v);
    var vRot = V.sub(vrel, V.mul(V.cross(yHat, rel), n));   // 扣掉 ω×r
    return {
      n: n, xHat: xHat, yHat: yHat, zHat: zHat, rtm: rtm,
      x: V.dot(rel, xHat), y: V.dot(rel, yHat), z: V.dot(rel, zHat),
      vx: V.dot(vRot, xHat), vy: V.dot(vRot, yHat), vz: V.dot(vRot, zHat),
      d: V.mag(rel), rv: V.mag(vRot), rel: rel, vRot: vRot
    };
  }

  // CW 自然相对加速度（km/s²）
  function cwNaturalAccel(s) {
    var n = s.n;
    return [-2 * n * s.vz, -n * n * s.y, 2 * n * s.vx + 3 * n * n * s.z];
  }

  // CW 坐标系分量 → 惯性矢量
  function cwAccelDir(s, a) {
    return V.add(V.add(V.mul(s.xHat, a[0]), V.mul(s.yHat, a[1])),
                 V.mul(s.zHat, a[2]));
  }

  // 固定 PD + 前馈：a_thrust = [kp(r_des − r) + kv(v_des − v)] − aCW
  function cwPdAccel(s, rDes, vDes, kp, kv) {
    var aCW = cwNaturalAccel(s);
    return [
      kp * (rDes[0] - s.x) + kv * (vDes[0] - s.vx) - aCW[0],
      kp * (rDes[1] - s.y) + kv * (vDes[1] - s.vy) - aCW[1],
      kp * (rDes[2] - s.z) + kv * (vDes[2] - s.vz) - aCW[2]
    ];
  }

  // 接近律：沿 V-bar 以受控接近率收向保持点 xHold（< 0 = 目标后方），
  // 同时把法向 / 径向的位置与速度误差归零。x 用速度跟踪（一阶指数逼近，不过冲）。
  function cwApproachAccel(s, xHold, kClose, vMin, vMax, kp, kv, kvx) {
    var eX = xHold - s.x;                           // > 0：还在后方，需要沿 +x 靠近
    var vClose = (eX > 0) ? V.clamp(kClose * eX, vMin, vMax)
                          : V.clamp(kClose * eX, -vMax, 0);
    var aCW = cwNaturalAccel(s);
    return [
      kvx * (vClose - s.vx) - aCW[0],
      kp * (0 - s.y) + kv * (0 - s.vy) - aCW[1],
      kp * (0 - s.z) + kv * (0 - s.vz) - aCW[2]
    ];
  }

  // 共面 / 共椭圆：只消法向（y, vy），共椭圆时再加径向（z, vz）；不动沿迹向
  function cwNullAccel(s, withRadial, kp, kv) {
    var aCW = cwNaturalAccel(s);
    return [
      0,
      kp * (0 - s.y) + kv * (0 - s.vy) - aCW[1],
      withRadial ? (kp * (0 - s.z) + kv * (0 - s.vz) - aCW[2]) : 0
    ];
  }

  // 把 CW 坐标系的期望推力加速度折成"短脉冲"并交给有限推力模型执行。
  // 期望 Δv 逐拍累加，攒够一个最小冲量（满推力 Tmin）才点火 —— 既不会因为
  // 单拍 Δv 太小被 min 放大成过量推力，也不会漏掉缓慢的小修正。
  function cwPulse(world, c, s, aCmd, period) {
    var act = c.activeModule();
    if (!act || !(act.module.thrust > 0)) return false;
    var aMax = act.module.thrust / c.mass() / 1000;         // km/s²
    var am = V.mag(aCmd);
    if (am > aMax) aCmd = V.mul(aCmd, aMax / am);           // 加速度饱和
    if (!c._rndzAcc) c._rndzAcc = [0, 0, 0];
    c._rndzAcc = V.add(c._rndzAcc, V.mul(aCmd, period));     // 累加本拍期望 Δv
    var accMag = V.mag(c._rndzAcc);
    var Tmin = 0.004;                                        // 最小脉冲 4 ms
    if (accMag < aMax * Tmin) return false;                  // 还没攒够一个最小冲量
    var Tmax = 30;
    if (accMag > aMax * Tmax) {                              // 上限，防病态几何一步甩太远
      c._rndzAcc = V.mul(V.unit(c._rndzAcc), aMax * Tmax);
      accMag = aMax * Tmax;
    }
    var dir = cwAccelDir(s, c._rndzAcc);
    if (V.mag(dir) < 1e-9) return false;
    var bb = world.finiteBurn(c, {
      label: 'CW', dirFixed: dir, dvIdeal: accMag, T: accMag / aMax,
      maxT: accMag / aMax + 2, throttle: 1
    });
    if (bb) c._rndzAcc = [0, 0, 0];                          // 冲量已下达
    return !!bb;
  }

  // 是否已共椭圆（半长轴差 < 1 km，近/远月点都在目标 ±5 km）
  function cwCoellipticOK(elC, elT) {
    return isFinite(elC.a) && isFinite(elT.a) &&
           Math.abs(elC.a - elT.a) < 1.0 &&
           Math.abs(elC.periapsis - elT.periapsis) < 5.0 &&
           Math.abs(elC.apoapsis - elT.apoapsis) < 5.0;
  }

  function rendezvousControl(world, c, target, dt) {
    if (!target || target.crashed) return null;
    var mu = B.MOON.mu;
    var ms = A.moonState(world.t);
    var s = cwRelativeState(c, target, ms, mu);
    if (!s) return null;
    var d = s.d, rv = V.mag(V.sub(c.v, target.v));
    var out = { d: d * 1000, rv: rv * 1000, rotatingRv: s.rv * 1000 };
    // 诊断用：把交会状态机当前看到的关键量挂到飞行器上（无头测试直接读）
    c._rndzD = d * 1000; c._rndzRv = rv * 1000; c._rndzLog = '';
    // ⚠ 第一件事就是清掉上一次的油门命令，必须在所有提前 return 之前
    //   （真正的点火由 world.updateBurn 每一步重设油门，所以在这里清零是安全的）。
    c.throttleCmd = 0; c.throttle = 0;

    // 失败 / 完成状态：直接返回，明确给出原因，绝不"预算耗尽后永久干等"
    if (c._rndzPhase === 'failed') {
      out.failed = true; out.reason = c._rndzFailReason || 'failed';
      c._rndzLog = 'FAILED:' + out.reason; return out;
    }
    if (c._rndzPhase === 'done') { out.done = true; out.phase = 'done'; return out; }
    if (!c._rndzPhase) c._rndzPhase = 'coplanar';
    if (c._rndzPhaseT === undefined) c._rndzPhaseT = world.t;

    // 完成判据：d ≤ 150 m 且 rv ≤ 1 m/s，连续保持 300 s
    if (c._rndzPhase === 'terminal') {
      if (d <= 0.15 && rv <= 0.001) {
        if (!(c._rndzHoldStart >= 0)) c._rndzHoldStart = world.t;
        if (world.t - c._rndzHoldStart >= 300) {
          c._rndzPhase = 'done'; c._rndzHoldStart = -1;
          out.done = true; out.phase = 'done'; c._rndzLog = 'done';
          c.throttleCmd = 0; c.throttle = 0; return out;
        }
      } else {
        c._rndzHoldStart = -1;
      }
    }

    if (c.primary !== 'MOON') { c._rndzLog = 'not-moon'; out.waiting = true; return out; }
    if (c.burn && c.burn.active) { out.burning = true; out.phase = c._rndzPhase; return out; }

    // 控制周期：同一 t 不重复脉冲。period 取"上一次下发指令到现在"的真实间隔
    // （夹到 [0.5, 30] s），cwPulse 用它把期望加速度折成 duty-cycle 短脉冲——这样
    // 每个周期平均推力精确等于指令加速度，无论帧长 2 s 还是 30 s（高 warp）都成立。
    // 若把上限压到 10 s，dt=30 时累加器只按 10 s 计，平均推力偏小 3 倍 → 收敛慢、
    // 径向欠力、燃料超支。下限 0.5 s 只是防止同一时刻附近重复积分。
    var now = world.t;
    if (c._rndzCmdT === now) { out.phase = c._rndzPhase; out.waiting = true; return out; }
    var elapsed = (c._rndzCmdT === undefined) ? 5 : (now - c._rndzCmdT);
    var period = V.clamp(elapsed, 0.5, 30);
    c._rndzCmdT = now;

    var elC = M.elements(mu, V.sub(c.r, ms.r), V.sub(c.v, ms.v));
    var elT = M.elements(mu, V.sub(target.r, ms.r), V.sub(target.v, ms.v));
    if (!isFinite(elC.a) || !isFinite(elT.a)) { c._rndzLog = 'bad-elements'; out.waiting = true; return out; }

    // 轨道面夹角
    var hC = V.cross(V.sub(c.r, ms.r), V.sub(c.v, ms.v));
    var hT = V.cross(V.sub(target.r, ms.r), V.sub(target.v, ms.v));
    var planeDeg = 180;
    if (V.mag(hC) > 1e-9 && V.mag(hT) > 1e-9) {
      planeDeg = Math.acos(V.clamp(V.dot(V.unit(hC), V.unit(hT)), -1, 1)) * M.R2D;
    }
    out.plane = planeDeg;

    // 固定增益：ω ≈ 0.003 rad/s 的临界阻尼（kp = ω²、kv = 2ω）
    var KP = 9e-6, KV = 6e-3, KVX = 6e-3;

    function failR(reason) {
      c._rndzPhase = 'failed'; c._rndzFailReason = reason;
      c.throttleCmd = 0; c.throttle = 0;
      out.failed = true; out.reason = reason; c._rndzLog = 'FAILED:' + reason;
    }
    function advanceTo(ph) { c._rndzPhase = ph; c._rndzPhaseT = now; }
    var phaseTimeout = { coplanar: 60000, coelliptic: 120000, phase: 300000, terminal: 300000 };
    if (phaseTimeout[c._rndzPhase] && now - c._rndzPhaseT > phaseTimeout[c._rndzPhase]) {
      failR(c._rndzPhase + '-timeout'); return out;
    }

    // ---------------------------------------------------------- 1 共面
    if (c._rndzPhase === 'coplanar') {
      out.phase = 'coplanar';
      if (planeDeg < 0.1 && Math.abs(s.vy) < 0.001) {
        advanceTo('coelliptic'); out.waiting = true; return out;
      }
      cwPulse(world, c, s, cwNullAccel(s, false, KP, KV), period);
      out.burning = !!(c.burn && c.burn.active);
      return out;
    }

    // ---------------------------------------------------------- 2 共椭圆
    if (c._rndzPhase === 'coelliptic') {
      out.phase = 'coelliptic';
      if (cwCoellipticOK(elC, elT) && Math.abs(s.vy) < 0.001) {
        advanceTo('phase'); out.waiting = true; return out;
      }
      cwPulse(world, c, s, cwNullAccel(s, true, KP, KV), period);
      out.burning = !!(c.burn && c.burn.active);
      return out;
    }

    // ---------------------------------------------------------- 3 相位等待
    if (c._rndzPhase === 'phase') {
      out.phase = 'phase';
      // 真正位于目标后方（V-bar，x ≤ 0）且不超过 40 km 且已共椭圆 → 进入终端。
      // 名义窗口是 20~40 km，但已经更近（甚至只差百米）时**不该把它推回 30 km** ——
      // 越近 CW 线性化越准、越省油，直接进终端即可。
      var closeStart = s.d < 1 && s.rv < 0.001;
      var behindWindow = s.d <= 40 && s.x <= 0 && s.x >= -40 && s.vx >= -0.0001;
      if ((closeStart || behindWindow) && cwCoellipticOK(elC, elT) &&
          Math.abs(s.vy) < 0.001 && Math.abs(s.vz) < 0.002) {
        advanceTo('terminal');
        c._rndzAcc = [0, 0, 0];
        var actT = c.activeModule();
        c._rndzTermP0 = actT ? actT.module.prop : null;    // 终端推进剂预算起点
        out.waiting = true; return out;
      }
      // 有限推力轨道调整：把自己送到"目标后方 30 km"的 V-bar 保持点
      var aP = cwApproachAccel(s, -30, 0.0008, 0.0002, 0.005, KP, KV, KVX);
      cwPulse(world, c, s, aP, period);
      out.burning = !!(c.burn && c.burn.active);
      return out;
    }

    // ---------------------------------------------------------- 4 终端接近
    if (c._rndzPhase === 'terminal') {
      out.phase = 'terminal';
      var actN = c.activeModule();
      if (!actN || actN.module.prop <= 1e-9) { failR('terminal-no-propellant'); return out; }
      // 终端推进剂预算 ≤ 150 kg
      if (c._rndzTermP0 !== null && c._rndzTermP0 !== undefined &&
          (c._rndzTermP0 - actN.module.prop) > 150) { failR('terminal-fuel'); return out; }
      // 接近率剖面：30 km 处 ~2 m/s，1 km 处 ~0.3 m/s，末端 ~0.05 m/s
      var aT2 = cwApproachAccel(s, -0.08, 0.0006, 0.00005, 0.002, KP, KV, KVX);
      cwPulse(world, c, s, aT2, period);
      out.burning = !!(c.burn && c.burn.active);
      out.close = -s.vx * 1000;
      return out;
    }

    // 未知相位（旧存档 / 中途接管）：不猜，直接等待
    out.phase = c._rndzPhase;
    out.waiting = true; return out;
  }

  // 把飞船的轨道改成"一端 = wantA、另一端保持不变"的椭圆 → 反复调用即收敛成
  // 半径 wantA 的圆轨道。
  //
  // ⚠ 关键：**目标是在当前位置的完整速度矢量（含径向分量）**，所以点火位置
  // 完全不受限。早先的写法是"必须在拱点点火、只给切向速度"，问题是：
  //   · 拱点窗口极窄（径向速度要 < 8 m/s 才算"在拱点上"），演示倍率下一帧就
  //     跨 480 km，根本命中不了 → 一直认为"还没到拱点"，一步都不烧；
  //   · 就算命中了，把速度强拧成切向也会顺手干掉径向分量，轨道被改得完全
  //     不是想改的样子。
  // 现在用 vis-viva 算出目标轨道的速率 vN，再按 h = √(μa(1−e²)) 分解成
  // 切向 vT = h/r 与径向 vR = √(vN²−vT²)（径向符号跟随当前径向速度），
  // 合成一个固定的 ECI 速度矢量交给闭环制导。
  // 目标的**实际圆锥**（近/远月点半径）。末端配合必须对着它，不能对着"半径 aT 的
  // 圆轨道"：指令舱的轨道本身就是一条 1 946×1 982 km 的椭圆，把追踪器做成
  // 半径 1 957 的正圆，两者的相对运动会一直有几十 m/s 的周期性偏差 ——
  // 收拢律只能一路顶着它烧（实测烧掉 0.30 km/s 才从 120 km 收到 11.6 km，
  // 然后预算见底）。
  // dA 是共椭圆逼近的"整条圆锥下移量"。
  function tgtConic(elT, dA, nT) {
    var rp = elT.periapsis, ra = elT.apoapsis;
    if (!isFinite(rp) || !isFinite(ra)) return null;
    if (dA) { rp -= dA; ra -= dA; }
    return { rp: rp, ra: ra, n: nT || null };
  }

  // fixed: 可选 {rp, ra} —— 把目标钉成**一条固定的圆锥**而不是"当前半径 + wantA"。
  // 末端下降必须用它：闭合式的"另一端 = 当前半径"在下降途中会把远月点一路压低
  //（滑到一半时它想把远月点从 2 254 收到 2 100），转移椭圆越走越扁、半周期越算
  // 越短，冷却也跟着失效 —— 实测到达点的相位差 1.5° 设计值变成了 13.6°。
  function rndzDrive(world, c, ms, cr, cv, wantA, strict, fixed, tolKm) {
    var mu = B.MOON.mu;
    var el = M.elements(mu, cr, cv);
    if (!isFinite(el.a)) return 'wait';
    var rp = el.periapsis, ra = el.apoapsis, rC = V.mag(cr);
    // 收敛容差（km）。60 是「轨道匹配」级别的；末端共椭圆逼近必须收紧到
    // 个位数 —— 60 km 的容差会把 1934×2003 这种还差 69 km 的椭圆直接判成
    // 「到位」，chase 于是永远不点火（实测卡 50 000 s、dv 一动不动）。
    var tol = (tolKm === undefined) ? 60 : tolKm;
    if (Math.abs(rp - wantA) < tol && Math.abs(ra - wantA) < tol) return 'done';
    // 目标轨道 = 「一端 = 当前半径、另一端 = wantA」的椭圆 —— 这样**一定可达**
    //（飞船当前就在这条椭圆上），不必等它飞到某个特定半径。
    // ⚠ 早先写成"保留另一端、只改离 wantA 更远的那一端"，会出现"目标轨道不含
    //  飞船当前半径"的死锁：飞船半径 2 135 km、目标轨道只有 1 922~2 108 km，
    //  判据直接 return 'wait'，一步也不烧（实测在 settle 段卡了 30 000 s）。
    // 这条椭圆的**不动点**就是半径 wantA 的圆轨道，反复应用自然收敛。
    var rpN, raN;
    if (fixed) { rpN = fixed.rp; raN = fixed.ra; }
    else { rpN = Math.min(wantA, rC); raN = Math.max(wantA, rC); }
    var aN = (rpN + raN) / 2;
    var eN = (raN - rpN) / (raN + rpN);
    var hN2 = Math.sqrt(mu * aN * (1 - eN * eN));
    var vN = Math.sqrt(mu * (2 / rC - 1 / aN));
    if (!(vN > 1e-6)) return 'wait';
    var vT = Math.min(hN2 / rC, vN);
    var vR = Math.sqrt(Math.max(vN * vN - vT * vT, 0));
    var rHat = V.unit(cr);
    // ⚠ 有固定圆锥时用**目标轨道的法向**：这样合成的目标速度落在目标的轨道面内，
    // 一次点火顺带把**平面差**一起收掉。只用自己的法向的话，两器哪怕只差
    // 10~15° 倾角，相对速度就一直有 300 m/s 左右，收拢段只能一路硬顶
    //（实测在 35 km 处仍然有 392 m/s 的相对速度，就是平面差）。
    var hz;
    if (fixed && fixed.n && V.mag(fixed.n) > 1e-9) hz = V.unit(fixed.n);
    else hz = V.mag(V.cross(cr, cv)) > 1e-9 ? V.unit(V.cross(cr, cv))
                                            : V.unit(V.cross(cr, [0, 0, 1]));
    var tHat = V.unit(V.cross(hz, rHat));
    var sgn = V.dot(cv, rHat) >= 0 ? 1 : -1;              // 保留"现在是在升段还是降段"
    var vRelGoal = V.add(V.mul(tHat, vT), V.mul(rHat, vR * sgn));
    var vGoal = V.add(ms.v, vRelGoal);
    var dv = V.mag(V.sub(vGoal, c.v));
    // 最小点火量必须放到 0.02 m/s（原来卡在 2 m/s）。
    // 最后几百米只需要零点几米每秒的微调，而 2 m/s 的门槛让制导要么干等着
    // 漂走、要么打一个比需要大一千多倍的点火把目标甩开几十公里。
    // 实测症状就是：TPI 收到 1.5~7.6 km / rv 1~5 m/s 之后就再也进不去。
    // 配套的还有 maxT 下限（8 s 全推力 = 至少 28 m/s）和 tol。
    if (!(dv > 0.00002)) return 'wait';
    // 单次点火 Δv 上限 100 m/s。闭环目标是"当前位置的完整速度矢量"，本身不会过冲；
    // 上限只是防止几何病态时一步甩太远。
    // ⚠ 早期是 40 m/s：从相位轨道降回目标轨道要 140 m/s，被切成 4 次点火、
    // 中间隔 4 个半周期冷却 ≈ 12 600 s —— 相位就在这段时间里漂走 64°，
    // 收拢段再也追不上（实测 LM 降回 aT 时已经差 1 655 m/s 的相对速度）。
    if (dv > 0.100) {
      vGoal = V.add(c.v, V.mul(V.unit(V.sub(vGoal, c.v)), 0.100));
      dv = 0.100;
    }
    c._rndzDv = c._rndzDv || 0;
    if (c._rndzDv > 1.10) return 'wait';                  // 交会总 Δv 预算
    // ⚠ 两次点火之间必须**隔半圈**：目标椭圆是"一端 = 当前半径、另一端 = wantA"，
    // 它随飞船位置一直在动。如果连续点火，制导会一路追着这个移动目标修下去
    //（实测烧掉 900 m/s 还没收敛，而理论霍曼只要 ~150 m/s）。
    // 隔半圈再点 = 标准的霍曼两段变轨：第一段把另一端改到 wantA，滑到那一端
    // 再点第二段圆化 ✓
    c._rndzCool = c._rndzCool || 0;
    if (world.t < c._rndzCool) return 'wait';
    var bb = world.finiteBurn(c, { label: 'RNDZ', target: vGoal,
      maxT: V.clamp(dv / 0.0035 + 0.3, 0.3, 30), tol: 0.00001 });
    if (bb) {
      c._rndzDv += dv;
      c._rndzCool = world.t + Math.PI * Math.sqrt(aN * aN * aN / mu);   // 半个周期
    }
    return bb ? 'burn' : 'wait';
  }

  // ---------------------------------------------------------- 环月入轨规划
  // 目标轨道：111 km 圆轨道，轨道面包含着陆点，飞行器位于着陆点对面。
  // 做法：等飞行器接近月球（距离 < rMaxKm）后，用「月心兰伯特」求一条
  // 两点式转移 —— 起点是当前位置，终点是 t+tof 时刻理想轨道上的位置。
  // 点火一次到达正确位置，再由 lunarOrbitAlign 圆化到正确速度。
  function lunarInsertionPlan(world, c, opt) {
    opt = opt || {};
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r);
    var d = V.mag(rel);
    var rMax = opt.rMaxKm || 20000;
    if (d > rMax) return { wait: true, dist: d };
    var tof = opt.tofS || V.clamp(d / 0.6, 2 * 3600, 14 * 3600);
    // 目标状态（在 t+tof 时刻）
    var ms2 = A.moonState(world.t + tof);
    var site2 = A.moonSurfacePoint(world.t + tof,
      APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0).r;
    var upS2 = V.unit(V.sub(site2, ms2.r));
    var rT = V.mul(upS2, -(B.MOON.radius + (opt.altKm || 111)));   // 站点对面
    // 目标速度：在"含站点方向与当前径向"的平面内、切向圆速度
    var upNow = V.unit(rel);
    var nT = V.cross(upS2, upNow);
    if (V.mag(nT) < 1e-6) nT = V.cross(upS2, V.unit(V.sub(c.v, ms.v)));
    if (V.mag(nT) < 1e-6) return { fail: 'degenerate' };
    nT = V.unit(nT);
    var tHat = V.unit(V.cross(nT, rT));
    var v2rel = V.mul(tHat, Math.sqrt(B.MOON.mu / V.mag(rT)));
    // 月心兰伯特（比地心准确得多：目标点就在月球旁边）
    var v1relNow = V.sub(c.v, ms.v);
    var Lb = M.lambert(B.MOON.mu, rel, rT, tof, true);
    if (!Lb) return { fail: 'lambert' };
    var dvVec = V.sub(Lb.v1, v1relNow);
    var dv = V.mag(dvVec);
    if (dv < 1e-9) return { fail: 'already' };
    return {
      burn: { dv: dv, dir: V.unit(dvVec) },
      tof: tof, atT: world.t + tof,
      targetRrel: rT, targetVrel: v2rel, dist: d
    };
  }

  // ---------------------------------------------------- 环月轨道平面设置
  // 「抬高远月点 → 在远月点转平面 → 回到低轨道圆化」三段式变面。
  // 直接在 150 km 高度转 10° 的轨道面要 ~400 m/s，转 30° 要 1.2 km/s；
  // 但把远月点抬到 1 万公里后在远月点（速度只有 ~0.3 km/s）转 30°
  // 只要 ~150 m/s —— 这是真实的常用做法（阿波罗的交会/平面机动都在高位做）。
  // 状态机相位：raise → turn → settle
  function lunarPlaneSetup(world, c, opt) {
    opt = opt || {};
    var apoKm = opt.apoKm || 10000;           // 抬到的远月点高度
    var tolDeg = opt.tolDeg || 0.5;
    var mu = B.MOON.mu;
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
    var r = V.mag(rel), v = V.mag(vrel);
    if (r < 1 || v < 1e-7) return { done: true };
    var rHat = V.unit(rel);
    var nNow = V.unit(V.cross(rel, vrel));
    var upS = V.unit(V.sub(
      A.moonSurfacePoint(world.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0).r, ms.r));
    var proj = V.sub(nNow, V.mul(upS, V.dot(nNow, upS)));
    var dAng = (V.mag(proj) < 1e-9) ? 0
      : Math.acos(V.clamp(V.dot(nNow, V.unit(proj)), -1, 1)) * M.R2D;

    var o = M.elements(mu, rel, vrel);
    var rA = isFinite(o.apoapsis) ? o.apoapsis : r * 2;   // 远月点半径
    var rP = isFinite(o.periapsis) ? o.periapsis : r;     // 近月点半径
    // 完成条件：平面对了 + 轨道已经回到低位（否则动力下降速度太快会坠毁）
    // 平面已经对准就直接结束 —— 不再要求"轨道已经回到低位"。
    // 原因：LOI 现在是一次"定面 + 捕获"的迭代制导点火（plane:'site'），
    // 到达时平面本来就对准了；如果这时还因为"轨道不够低"去做抬远月点/转平面，
    // 只会把好好的低环月轨道搅成高位大椭圆（实测 M5 因此 10 天都等不到近月点）。
    if (dAng < tolDeg) return { done: true, dAng: dAng, phase: 'aligned' };
    var lowOK = isFinite(o.apoapsis) && o.apoapsis < B.MOON.radius + 1200;
    var phase = c._planePhase || (dAng < tolDeg ? 'settle' : 'raise');

    if (phase === 'raise') {
      if (c.burn && c.burn.active) return { phase: 'raise', burning: true, dAng: dAng };
      if (rA > B.MOON.radius + apoKm * 0.85) { c._planePhase = 'turn'; return { phase: 'turn', dAng: dAng }; }
      // 在（接近）近月点点火，把远月点抬到 apoKm（有限推力，闭环）
      if (r > rP * 1.15) return { phase: 'raise', dAng: dAng };     // 等到近月点附近
      var apoR = B.MOON.radius + apoKm;
      if (r >= apoR) { c._planePhase = 'turn'; return { phase: 'turn', dAng: dAng }; }
      var aT = (r + apoR) / 2;
      var vNeed = Math.sqrt(mu * (2 / r - 1 / aT));
      if (!(v < vNeed - 1e-7)) { c._planePhase = 'turn'; return { phase: 'turn', dAng: dAng }; }
      var vt0 = V.add(ms.v, V.mul(V.unit(vrel), vNeed));
      var dvR = V.mag(V.sub(vt0, c.v));
      var orbR = { mu: mu, a: aT, n: V.unit(V.cross(rel, vrel)), body: 'MOON' };
      var rR = world.startFiniteManeuver(c, orbR, {
        label: 'plane-raise', maxT: 1800, dir: V.sub(vt0, c.v)
      });
      if (rR.failed || rR.noPropellant) return { phase: 'raise', failed: true, dAng: dAng };
      return { phase: 'raise', burning: true, dv: dvR, dAng: dAng };
    }
    if (phase === 'turn') {
      if (c.burn && c.burn.active) return { phase: 'turn', burning: true, dAng: dAng };
      if (r < rA * 0.8) return { phase: 'turn', dAng: dAng };       // 等到远月点附近
      // 在远月点：把速度转到「含站点平面」内，同时把近月点压回 ~111 km（有限推力）
      var cr = V.cross(rHat, upS);
      // 同 lunarOrbitAlign：飞船正好在着陆点上空时这个叉乘会退化成噪声
      if (V.mag(cr) < 0.25) cr = V.cross(V.unit(vrel), upS);
      if (V.mag(cr) < 1e-4) { c._planePhase = 'settle'; return { phase: 'settle', dAng: 0 }; }
      var nT2 = V.unit(cr);
      if (V.dot(nT2, nNow) < 0) nT2 = V.mul(nT2, -1);
      var tHat2 = V.unit(V.cross(nT2, rHat));
      var aLow = (r + B.MOON.radius + 111) / 2;
      var vApo = Math.sqrt(mu * (2 / r - 1 / aLow));
      var vt1 = V.add(ms.v, V.mul(tHat2, vApo));
      var dv1 = V.mag(V.sub(vt1, c.v));
      if (dv1 < 1e-3) { c._planePhase = 'settle'; return { phase: 'settle', dAng: dAng }; }
      var orbT = { mu: mu, a: aLow, n: nT2, body: 'MOON' };
      var rT = world.startFiniteManeuver(c, orbT, {
        label: 'plane-turn', maxT: 1800, dir: V.sub(vt1, c.v)
      });
      c._planePhase = 'settle';
      if (rT.failed || rT.noPropellant) return { phase: 'turn', failed: true, dAng: dAng };
      return { phase: 'turn', burning: true, dv: dv1, dAng: dAng };
    }
    // settle：等到真正的近月点（~111 km）再圆化，圆在高处只会白花钱
    if (r > B.MOON.radius + 135) return { phase: 'settle', dAng: dAng };
    var r2 = P_lunarOrbitAlignSite(world, c, { dvCapKmS: 0.9 });
    if (r2 && r2.done) c._planePhase = null;
    return { phase: 'settle', done: !!(r2 && r2.done), burned: r2 && r2.burned,
             dv: r2 ? r2.dv : 0, dAng: dAng };
  }
  // lunarOrbitAlign 的 site 模式包装（供 settle 相位复用）
  function P_lunarOrbitAlignSite(world, c, opt) {
    opt = opt || {};
    opt.plane = 'site';
    return lunarOrbitAlign(world, c, opt);
  }

  // ============================================ 两次固定目标 LOI（111×315 → 111×117）
  // 见 AGENT_HANDOFF/08：旧的「按当前半径动态圆化」必须换掉 —— 它在燃烧过程中用
  // 当前半径重生成目标椭圆（orb.periR 分支把 rp 夹到 r*0.999），而且目标速度只给
  // 切向分量（targetOrbitVelocity 忽略固定 conic 的径向分量），于是制导要沿切向
  // 硬顶径向重力，越烧越亏（实测 LOI 烧到 1 454 m/s 才收住）。
  //
  // 新版设计：
  //   · 目标椭圆在点火前**冻结**：近月点 rp、远月点 ra、轨道法向 n 都不再随当前
  //     半径重算；LOI-1 = 111×315、LOI-2 = 111×117（默认到达当前面，不在 LOI 里
  //     做昂贵的转平面）；
  //   · 只在真近月点（近月点高度 111 ± 20 km、径向速度接近 0）启动；LOI-2 等下一近点；
  //   · 用**真正的有限推力打靶**：固定惯性方向 u（冻结平面内，−cos(pitch)·t̂ +
  //     sin(pitch)·r̂）与点火时长 T 两个正交参数，在全模型动力弧上试算，使关机后
  //     二体根数命中 (rp, ra)；牛顿 + 阻尼迭代。径向分量由解算给出，不再浪费燃料；
  //   · 实飞仍走 world.finiteBurn（开环 dirFixed + 定时 T），**绝不直接改 c.r / c.v**；
  //   · 关机后用 integrateSim 外推一圈复核 rp / ra / 平面，不合格就 failed，
  //     并且锁死不再自动追加第三次点火。
  //
  // 接口保留：opt.label === 'LOI-2' 选第二次；没有显式给出 loi/label/periAltKm 的旧
  // 调用（如 lunarPlaneSetup 的 site 圆化）**明确失败**，不会被悄悄改成新冻结目标。

  // 固定惯性推力方向：pitch = 0 为纯逆行，pitch > 0 向径向外侧偏。
  function loiThrustDir(tHat, rHat, pitch) {
    return V.unit(V.add(V.mul(tHat, -Math.cos(pitch)), V.mul(rHat, Math.sin(pitch))));
  }

  // 用与 World.stepCraft 相同的发动机模型（定常推力 / 质量流量 / 仿真同款步长）积分
  // 一段定方向、定时的有限点火，返回关机状态与耗油。**只读真实 craft，不触碰它**。
  function loiBurnArc(world, c, u, T) {
    var act = c.activeModule();
    if (!act || !(act.module.thrust > 0)) return null;
    var mod = act.module;
    var isp = c.ispNow(mod);
    var mdot = mod.thrust / (isp * g0);            // kg/s
    var thrustN = mod.thrust * (mod.thrustScale || 1);
    var dir = V.unit(u);
    var avail = world.propLeft(c);
    if (!(avail > 1e-6) || !(T > 1e-6)) return null;
    var r = c.r.slice(), v = c.v.slice(), t = world.t;
    var m = c.mass(), used = 0, burned = 0, guard = 0;
    while (burned < T - 1e-9 && guard++ < 200000) {
      var alt = V.dist(r, A.moonState(t).r) - B.MOON.radius;
      var h = Math.min(stepForAlt(alt), 0.5);      // 有限点火期间仿真步长被夹到 0.5 s
      if (T - burned < h) h = T - burned;
      if (used + mdot * h > avail) h = (avail - used) / Math.max(mdot, 1e-9);
      if (!(h > 1e-9)) break;
      var usedStep = mdot * h;
      var mAfter = m - usedStep;                   // stepCraft 用的是消耗后的质量
      var aT = (thrustN / 1000) / Math.max(mAfter, 1);
      var accel = (function (a0, d0) {
        return function (tt, rr) { return V.scaleAdd(world.gravity(tt, rr), d0, a0); };
      })(aT, dir);
      var st = M.rk4Step(accel, t, r, v, h);
      r = st.r; v = st.v; t += h;
      m = mAfter; used += usedStep; burned += h;
      if (m <= 1) break;
    }
    return { r: r, v: v, t: t, propUsed: used, burned: burned };
  }

  // 由月心相对状态取 (近月点高度, 远月点高度, 法向)。未捕获时远月点记为大数，
  // 让打靶的牛顿迭代知道"还要继续减速"。
  function loiConicAlt(rel, vrel) {
    var el = M.elements(B.MOON.mu, rel, vrel);
    if (!el || !isFinite(el.periapsis)) return null;
    return {
      rp: el.periapsis - B.MOON.radius,
      ra: isFinite(el.apoapsis) ? el.apoapsis - B.MOON.radius : 1e6,
      a: el.a, e: el.e,
      n: V.mag(el.hvec) > 1e-9 ? V.unit(el.hvec) : null
    };
  }

  // 关机后复核：用 integrateSim 外推一圈，取真实近月点（最近接近点）与远月点
  //（近月点后再滑半圈）以及轨道面法向。
  function loiVerify(world, r, v, t) {
    var el = M.elements(B.MOON.mu, V.sub(r, A.moonState(t).r), V.sub(v, A.moonState(t).v));
    if (!el || !(el.a > 0) || el.e >= 1) return null;
    var P = 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / B.MOON.mu);
    var ca = integrateSim(world, r, v, t, t + P, { closest: true });
    if (!ca) return null;
    var msp = A.moonState(ca.t);
    var relp = V.sub(ca.r, msp.r), vrelp = V.sub(ca.v, msp.v);
    var ap = integrateSim(world, ca.r, ca.v, ca.t, ca.t + P / 2, {});
    var ra = V.mag(V.sub(ap.r, A.moonState(ap.t).r)) - B.MOON.radius;
    return { rp: ca.dist - B.MOON.radius, ra: ra, a: el.a, e: el.e,
             n: V.unit(V.cross(relp, vrelp)) };
  }

  // 固定目标打靶：解 (T, pitch) 使关机后 (rp, ra) 命中目标，返回固定方向 u 与 T。
  function loiSolve(world, c, rpAlt, raAlt, nHat) {
    var act = c.activeModule();
    if (!act || !(act.module.thrust > 0)) return null;
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
    var r0 = V.mag(rel);
    var rHat = V.unit(rel);
    var tHat = V.unit(V.cross(nHat, rHat));
    if (V.mag(tHat) < 1e-9) return null;
    var rpT = B.MOON.radius + rpAlt, raT = B.MOON.radius + raAlt;
    var aTgt = (rpT + raT) / 2;
    var sT = 2 / r0 - 1 / aTgt;
    var vTgt = sT > 0 ? Math.sqrt(B.MOON.mu * sT) : 0;
    var dv0 = Math.max(V.mag(vrel) - vTgt, 0.05);
    var accel0 = (act.module.thrust / 1000) / Math.max(c.mass(), 1);
    var T = V.clamp(1.1 * dv0 / accel0, 2, 1500);
    var pitch = 0, best = null, bestFm = 1e9, it;

    function evalX(Tx, px) {
      if (!(Tx > 0.5)) return null;
      var u = loiThrustDir(tHat, rHat, px);
      var arc = loiBurnArc(world, c, u, Tx);
      if (!arc || !(arc.burned > 0.5)) return null;
      var msA = A.moonState(arc.t);
      var m = loiConicAlt(V.sub(arc.r, msA.r), V.sub(arc.v, msA.v));
      if (!m) return null;
      return { u: u, T: Tx, arc: arc, m: m, f: [m.rp - rpAlt, m.ra - raAlt] };
    }

    for (it = 0; it < 20; it++) {
      var e0 = evalX(T, pitch);
      if (!e0) { T *= 0.82; pitch *= 0.6; if (T < 1) return null; continue; }
      var fm = Math.sqrt(e0.f[0] * e0.f[0] + e0.f[1] * e0.f[1]);
      if (fm < bestFm) { bestFm = fm; best = e0; }
      if (fm < 0.5) break;
      var dT = Math.max(0.5, T * 0.01), dp = 0.01;
      var eT = evalX(T + dT, pitch), eP = evalX(T, pitch + dp);
      if (!eT || !eP) { T *= 0.9; continue; }
      var J00 = (eT.f[0] - e0.f[0]) / dT, J01 = (eP.f[0] - e0.f[0]) / dp;
      var J10 = (eT.f[1] - e0.f[1]) / dT, J11 = (eP.f[1] - e0.f[1]) / dp;
      var det = J00 * J11 - J01 * J10;
      if (Math.abs(det) < 1e-9) { pitch = V.clamp(pitch + (it % 2 ? 0.02 : -0.02), -0.7, 0.7); continue; }
      var sT2 = V.clamp((-e0.f[0] * J11 + e0.f[1] * J01) / det, -0.3 * T, 0.3 * T);
      var sP2 = V.clamp((-e0.f[1] * J00 + e0.f[0] * J10) / det, -0.12, 0.12);
      // 线搜索：只接受让 |f| 下降的步（否则偏近月点的初值会让牛顿发散）
      var lam = 1, stepped = false;
      for (var ls = 0; ls < 10; ls++) {
        var Tn = V.clamp(T + lam * sT2, 1, 1500);
        var pn = V.clamp(pitch + lam * sP2, -0.7, 0.7);
        var en = evalX(Tn, pn);
        if (en && Math.sqrt(en.f[0] * en.f[0] + en.f[1] * en.f[1]) < fm) {
          T = Tn; pitch = pn; stepped = true; break;
        }
        lam *= 0.5;
      }
      if (!stepped) pitch = V.clamp(pitch + (it % 2 ? 0.04 : -0.04), -0.7, 0.7);
    }
    if (!best) return null;
    var isp = c.ispNow(act.module);
    var ve = isp * g0 / 1000;
    var m1 = Math.max(c.mass() - best.arc.propUsed, 1);
    var dv = ve * Math.log(c.mass() / m1);
    return { ok: bestFm < 3.0, u: best.u, T: best.T, dv: dv,
             rp: best.m.rp, ra: best.m.ra, residual: bestFm,
             propUsed: best.arc.propUsed, iters: it };
  }

  function lunarOrbitAlign(world, c, opt) {
    opt = opt || {};
    // loi 判定：显式 loi / label 优先；只给 periAltKm/apoAltKm 视为 LOI-1；
    // 什么都没有（旧 lunarPlaneSetup 的 site 圆化）→ 明确失败，不悄悄换目标。
    var loi = opt.loi
      || (opt.label === 'LOI-2' ? 2 : (opt.label === 'LOI-1' ? 1 : 0))
      || ((opt.periAltKm !== undefined || opt.apoAltKm !== undefined) ? 1 : 0);
    if (!loi) return { failed: true, reason: 'loi-mode-required' };
    var rpAlt = 111, raAlt = loi === 2 ? 117 : 315;
    if ((loi !== 1 && loi !== 2) || (opt.periAltKm !== undefined && opt.periAltKm !== rpAlt) ||
        (opt.apoAltKm !== undefined && opt.apoAltKm !== raAlt)) return { failed: true, reason: 'fixed-target-required' };
    var tolRp = opt.tolRpKm !== undefined ? Math.min(20, opt.tolRpKm) : 20;
    var tolRa = opt.tolRaKm !== undefined ? Math.min(5, opt.tolRaKm) : 5;
    var key = loi + ':' + rpAlt + ':' + raAlt;

    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
    var r = V.mag(rel), alt = r - B.MOON.radius;
    if (!(r > B.MOON.radius * 0.9) || !(V.mag(vrel) > 1e-6)) return { done: true };

    // 幂等锁：已成功 / 已失败（含复核不合格）都不再自动追加点火
    if (c._loiDoneKey === key) return { done: true, loi: loi };
    if (c._loiFailKey === key) return { failed: true, reason: c._loiFailReason || 'latched' };

    if (c.burn && c.burn.active) {
      return { burning: true, dv: c.burn.dvIdeal || 0, burnT: c.burn.T || 0 };
    }

    var S = c._loi;
    if (S && (S.loi !== loi || S.rpAlt !== rpAlt || S.raAlt !== raAlt)) S = c._loi = null;

    if (S && S.phase === 'burning') S.phase = 'verify';
    if (S && S.phase === 'verify') {
      var vf = loiVerify(world, c.r, c.v, world.t);
      var dvUsed = S.dv, burnT = S.T, nFrozen = S.n;
      c._loi = null;
      c._loiPrevEndT = world.t;
      if (!vf) {
        c._loiFailKey = key; c._loiFailReason = 'verify-no-orbit';
        return { failed: true, reason: 'verify-no-orbit' };
      }
      var planeDeg = (nFrozen && vf.n && V.mag(vf.n) > 0.5)
        ? Math.acos(V.clamp(Math.abs(V.dot(vf.n, nFrozen)), 0, 1)) * M.R2D : 0;
      var ok = Math.abs(vf.rp - rpAlt) <= tolRp
            && Math.abs(vf.ra - raAlt) <= tolRa && planeDeg <= 0.1;
      if (ok) {
        c._loiDoneKey = key;
        return { done: true, loi: loi, rp: vf.rp, ra: vf.ra,
                 planeDeg: planeDeg, dv: dvUsed, burnT: burnT };
      }
      c._loiFailKey = key; c._loiFailReason = 'verify';
      return { failed: true, reason: 'verify', rp: vf.rp, ra: vf.ra,
               planeDeg: planeDeg, dv: dvUsed, burnT: burnT };
    }

    // ---- 门槛：真近月点 111 ± 20 km ----
    var el0 = M.elements(B.MOON.mu, rel, vrel);
    if (!el0 || !isFinite(el0.periapsis)) return { failed: true, reason: 'degenerate' };
    var periAltNow = el0.periapsis - B.MOON.radius;
    if (!(periAltNow >= rpAlt - tolRp && periAltNow <= rpAlt + tolRp)) {
      return { failed: true, reason: 'peri-alt', periAlt: periAltNow, alt: alt };
    }
    if (alt > 131) return { waiting: true, alt: alt, periAlt: periAltNow };
    if (alt < 91) return { failed: true, reason: 'ignition-alt', alt: alt };
    // 真近点角门槛：只在真近月点 ±10° 内启动（偏太多时固定方向打靶到不了目标）
    var nu = el0.nu; if (nu > Math.PI) nu -= 2 * Math.PI;
    if (Math.abs(nu) > 0.1745) {
      return { waiting: true, alt: alt, periAlt: periAltNow, nuDeg: nu * M.R2D };
    }
    // LOI-2 必须等"下一近点"：距上一次点火关机至少 0.4 圈
    if (loi === 2 && c._loiPrevEndT) {
      var Pp = 2 * Math.PI * Math.sqrt(el0.a * el0.a * el0.a / B.MOON.mu);
      if (world.t - c._loiPrevEndT < 0.4 * Pp) {
        return { waiting: true, alt: alt, periAlt: periAltNow };
      }
    }
    if (!(world.propLeft(c) > 1e-6)) return { noPropellant: true };

    var nHat = (V.mag(V.cross(rel, vrel)) > 1e-9) ? V.unit(V.cross(rel, vrel)) : null;
    if (!nHat) return { failed: true, reason: 'degenerate-plane' };
    var sol = loiSolve(world, c, rpAlt, raAlt, nHat);
    if (!sol || !sol.ok) {
      c._loiFailKey = key; c._loiFailReason = 'no-solution';
      return { failed: true, reason: 'no-solution',
               residual: sol ? sol.residual : null,
               rp: sol ? sol.rp : null, ra: sol ? sol.ra : null };
    }
    // 解已冻结 → 立刻执行有限点火（开环 dirFixed + 定时 T），实飞绝不直接改 c.r/c.v
    var b2 = world.finiteBurn(c, { label: opt.label || ('LOI-' + loi), dirFixed: sol.u,
      dvIdeal: sol.dv, T: sol.T, maxT: sol.T + 10, throttle: 1 });
    if (!b2) { c._loi = null; return { noPropellant: true, dv: sol.dv }; }
    c._loi = S = { loi: loi, rpAlt: rpAlt, raAlt: raAlt, n: nHat, phase: 'burning',
                   dv: sol.dv, T: sol.T };
    return { burning: true, dv: sol.dv, burnT: sol.T };
  }

  // 返回地球轨道注入 TEI。
  // 原来只是"沿月球公转反方向怼固定 997 m/s"，出不出得来全看运气
  // （M5 里实测返回段滑行 5 天都到不了地球）。改成地心兰伯特：
  // 目标是 66 小时后到达地球附近（约 200 km 高度），保证一定回来再入。
  // 用闭环兰伯特做 TEI：目标不是"打一个固定 Δv"，而是"在 tArr 时刻到达地球
  // 再入走廊上的那个惯性点"（地球半径 + 200 km）。每一步都用当前状态重解一次
  // 兰伯特 —— 这正是真实任务里 SPS 迭代制导干的事，也保证有限推力燃烧期间
  // 位形变化被自动吸收（真实 TEI 燃耗 151 s，飞船在这段时间里会前进约 240 km）。
  function transEarthInjection(world, c, dvKmS, opts) {
    // ⚠⚠ 这段被推倒重来过。原来用**地心兰伯特**："把地心速度改成 v1、66 h 后
    //   到达地球附近"。对低环月轨道上的飞船这是错的：它当前地心速度 ≈ 月球
    //   公转速度 ± 环月轨道速度，而 v1 只有 ~0.2 km/s —— Δv 方向约等于地心
    //   速度的反方向，在月球参考系里就是**逆行点火**，实测直接撞月。
    //
    // 正确的物理（真实 TEI）：
    //   ① 必须点在"**环月轨道速度与月球公转方向接近反向**"的那个点上（每圈一次）；
    //   ② 逃逸后相对月球有 v∞，地心速度 = 月球速度 + v∞；要让地心速度等于
    //      "远地点在月球距离、近地点在再入走廊"那条返回椭圆的速度，需要
    //      v∞ = 月球公转速度 − 返回速度，方向与公转反向；
    //   ③ 反推月球参考系里点火后应有 |v_rel| = sqrt(v∞² + 2μ_moon/r)，
    //      Δv = |v_rel| − 当前 |v_rel|（顺行切向）。阿波罗 11 号实飞 929 m/s。
    //
    // ⚠ 但 ③ **漏掉了双曲线的转向角**：v∞ = 0.84 km/s 时 e_hyp ≈ 1.27、
    //   转向角 δ = 2·asin(1/e) ≈ 104°，逃逸渐近线方向和点火方向差了近一个直角。
    //   所以解析式只能当**种子**，要再数值精修。
    // ⚠ 而且精修必须在**燃烧中心化的脉冲点**（t+T/2）上做 —— centerBurn 是用
    //   estimateBurnSecs(c, 实际 dv) 定位脉冲点的，拿当前时刻当脉冲点，
    //   两次算的根本不是同一条轨道（实测精修到 1 055 m/s，打出去仍然
    //   过不了返回走廊的校验）。
    var ms0 = A.moonState(world.t);
    var rel0 = V.sub(c.r, ms0.r), vrel0 = V.sub(c.v, ms0.v);
    if (!(V.mag(rel0) > B.MOON.radius * 0.99) || !(V.mag(c.r) > 1e4)) return null;
    if (V.mag(vrel0) < 1e-6) return null;
    if (V.dot(V.unit(vrel0), V.unit(ms0.v)) > -0.55) {
      return { failed: true, reason: 'phase' };          // ① 相位闸门
    }
    // 目标近地点可外部迭代（演示的 TEI 修正环）：默认取走廊中部 R_E+300 km。
    var tgtPeri = (opts && opts.tgtPeriKm !== undefined) ? opts.tgtPeriKm : B.EARTH.radius + 300;
    var tEnd = world.t + 3 * 86400;
    var dv = 0.95, pre = null, tHat = null, seeded = false;
    for (var it = 0; it < 4; it++) {
      var T = estimateBurnSecs(c, dv), half = T / 2;
      pre = numericPropagateGeocentric(world, c.r, c.v, half, world.t);
      if (!pre || !isFinite(pre.r[0])) return null;
      var msP = A.moonState(pre.t);
      var relP = V.sub(pre.r, msP.r), vrelP = V.sub(pre.v, msP.v);
      var rMP = V.mag(relP), vRelP = V.mag(vrelP);
      if (!(rMP > B.MOON.radius * 0.99) || !(vRelP > 1e-6)) return null;
      var hP = V.cross(relP, vrelP);
      if (V.mag(hP) < 1e-9) return null;
      tHat = V.unit(V.cross(V.unit(hP), V.unit(relP)));   // 脉冲点处的顺行切向
      if (V.mag(tHat) < 1e-9) return null;
      if (!seeded) {
        // 解析种子（在脉冲点上算）
        var vm = V.mag(msP.v), rGeoP = V.mag(pre.r);
        var aRet = (rGeoP + tgtPeri) / 2, sRet = 2 / rGeoP - 1 / aRet;
        if (!(sRet > 0)) return { failed: true, reason: 'geom' };
        var vGeo = Math.sqrt(B.EARTH.mu * sRet);
        var vInf = vm - vGeo;
        if (!(vInf > 0.02)) return { failed: true, reason: 'vinf' };
        dv = Math.sqrt(vInf * vInf + 2 * B.MOON.mu / rMP) - vRelP;
        seeded = true;
        continue;                                        // 用种子重算脉冲点
      }
      // 局部精修：以种子为中心 ±0.35 km/s 扫 15 步找跨越，再二分
      var tEndP = pre.t + 3 * 86400;
      var periAt = function (d) {
        // ★ 参照系：Δv 在**月心系**，目标地心速度 = 月球公转 + 月心目标
        var vGeoGoal = V.add(V.add(msP.v, vrelP), V.mul(tHat, d));
        var st = integrateSim(world, pre.r, vGeoGoal, pre.t, tEndP, {});
        if (!st || !isFinite(st.r[0])) return null;
        if (V.dist(st.r, A.moonState(st.t).r) < B.MOON.soi) return null;
        var el = M.elements(B.EARTH.mu, st.r, st.v);
        return (el && isFinite(el.periapsis)) ? el.periapsis : null;
      };
      var N = 15, span = 0.35, aL = null, bL = null, pv = null, pP = null;
      for (var q = -N; q <= N; q++) {
        var dq = dv + span * q / N;
        if (!(dq > 0.02)) continue;
        var pq = periAt(dq);
        if (pq !== null && pP !== null) {
          if ((pP - tgtPeri) * (pq - tgtPeri) <= 0) { aL = pv; bL = dq; break; }
        }
        if (pq !== null) { pv = dq; pP = pq; }
      }
      if (aL === null) return { failed: true, reason: 'no-window' };
      var pA = periAt(aL), pB = periAt(bL);
      for (var bi = 0; bi < 10 && pA !== null && pB !== null; bi++) {
        var m2 = 0.5 * (aL + bL), pm = periAt(m2);
        if (pm === null) break;
        if (Math.abs(pm - tgtPeri) < 30) { aL = m2; pA = pm; break; }
        if ((pA - tgtPeri) * (pm - tgtPeri) <= 0) { bL = m2; pB = pm; }
        else { aL = m2; pA = pm; }
      }
      var dvNew = 0.5 * (aL + bL);
      if (!(dvNew > 0.02) || !isFinite(dvNew)) return { failed: true, reason: 'no-root' };
      if (Math.abs(dvNew - dv) < 0.005) { dv = dvNew; break; }
      dv = dvNew;                                        // 用新解重定位脉冲点
    }
    if (!(dv > 0.02) || !isFinite(dv)) return { failed: true, reason: 'no-root' };
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
    // ★ 目标地心速度 = 月球公转速度 + 月心系目标速度（vrelP + tHat·dv）。
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
    var cut = world.centerBurn(c, c.r, c.v, dvTrue, function () { return vGoal; });
    var bT = world.finiteBurn(c, {
      label: 'TEI', target: cut.vImp, maxT: 1800, tol: 0.00005
    });
    if (!bT) return { dv: dv, failed: true, noPropellant: true, tof: 66 * 3600 };
    return { dv: dvTrue, burning: true, tof: 66 * 3600 };
  }

  // ================================================ 有限推力点火（真实点火模型）
  // 真实的 TLI 燃烧 347 s、LOI-1 燃烧 357.5 s、TEI 燃烧 151 s —— 都不是瞬时脉冲。
  // 早期实现用 impulsiveBurn 一步给完 Δv：燃烧时间 0 s、重力损耗 0、推进剂只按
  // 理想火箭方程走，和真实飞行差得很远（也解释不了"为什么飞控要在点火前算好
  // 燃烧时长"）。
  //
  // 这里实现"速度增量闭环制导"（VTBG = velocity to be gained，真实的上升级
  // 迭代制导 / SPS / DPS 都是这么打的）：
  //   · 每一步把推力方向对准 (v_目标 − v_当前)：这既是真实迭代制导的做法，
  //     也是燃料最省的方向；
  //   · v_目标 由 targetFn 每步重算（兰伯特重解 / 目标圆速度 / 目标近月点），
  //     形成闭环 —— 发动机不是"盲目烧掉固定 Δv"，而是真的把飞船送到目标轨道；
  //   · 推进剂按质量流量实时消耗、推力随环境压强变化，重力在整段燃烧里持续
  //     作用 —— 于是重力损耗自然出现，燃烧时间与推进剂消耗自然落到真实量级；
  //   · 末端按剩余速度误差收油门（发动机有最小油门时改为"最后一步即关机"），
  //     关机精度控制在亚 m/s。
  // impulsiveBurn 保留给"规划与估算"用（轨道计算器、霍曼估算）。

  // 可用的推进剂模块顺序：当前主级优先，之后只允许「不低于当前级」的模块。
  //（这条顺序就是"不许跨级偷登月舱推进剂"的实现，脉冲与有限点火共用）
  World.prototype.propOrder = function (c) {
    var list = c.stackList();
    var act = c.activeModule();
    var order = [];
    if (act && act.module && act.module.prop > 0) order.push(act.module);
    // 主级烧干时 activeModule() 会返回 null —— 此时用 c.stageIndex 做下限，
    // 否则下限退化成 0，等于对所有模块开放（"偷油"又回来了）。
    var actStage = (act && act.module) ? act.module.stage : (c.stageIndex || 0);
    for (var i0 = 0; i0 < list.length; i0++) {
      var mods0 = list[i0].modules;
      for (var j0 = 0; j0 < mods0.length; j0++) {
        if (mods0[j0] === (act && act.module)) continue;
        if (mods0[j0].stage < actStage - 1e-9) continue;   // 不向下借
        order.push(mods0[j0]);
      }
    }
    return order;
  };

  World.prototype.propLeft = function (c) {
    var s = 0, order = this.propOrder(c);
    for (var i = 0; i < order.length; i++) s += Math.max(0, order[i].prop);
    return s;
  };

  // 按理想火箭方程估算这次点火需要的推进剂够不够；不够就诚实地拒绝点火
  World.prototype.affordable = function (c, dvKmS) {
    var ve = c.exhaustVelocity();
    if (!(ve > 0) || !(dvKmS >= 0)) return false;
    var m0 = c.mass();
    return this.propLeft(c) >= (m0 - m0 / Math.exp(dvKmS / ve)) - 1e-6;
  };

  // 启动一次有限点火。opt:
  //   target   固定目标速度矢量（ECI, km/s）
  //   targetFn (craft, world) => 目标速度矢量（每步重算 = 闭环制导）
  //   label / maxT / tol
  // 返回 burn 对象；返回 null 表示：没有可用发动机 / 已经到位 / 推进剂不够。
  World.prototype.finiteBurn = function (c, opt) {
    opt = opt || {};
    if (!c || c.crashed || c.landed) return null;
    if (c.burn && c.burn.active) return c.burn;          // 已有正在进行的点火
    var act = c.activeModule();
    if (!act || !(act.module.thrust > 0)) return null;
    // 开环常值推力方向模式（真实有限点火的标准打法：姿态程序固定 + 按时关机）
    if (opt.dirFixed) {
      var dvf = opt.dvIdeal || 0;
      if (!(dvf > 1e-7)) return null;
      if (!this.affordable(c, dvf)) return null;
      c.attitude.mode = 'hold';
      c.attitude.vec = V.unit(opt.dirFixed);
      c.burn = {
        active: true, openloop: true, label: opt.label || 'burn',
        dirFixed: V.unit(opt.dirFixed), T: opt.T || 0, throttle: opt.throttle || 1,
        speedOrb: opt.speedOrb || null, speedBody: opt.speedBody || 'EARTH',
        speedUp: opt.speedUp !== false,
        dvIdeal: dvf, dvEngine: 0, dvActual: 0, t: 0,
        v0: c.v.slice(), prop0: this.propLeft(c),
        maxT: opt.maxT || 2400, tol: opt.tol || 0.00005,
        termH: 0.02, terminal: false, reason: null
      };
      if (this.onBurnStart) this.onBurnStart(c, c.burn);
      return c.burn;
    }
    var vt = opt.targetFn ? opt.targetFn(c, this) : opt.target;
    if (!vt) return null;
    var dvi = V.mag(V.sub(vt, c.v));
    if (!(dvi > 1e-7)) return null;
    if (!this.affordable(c, dvi)) return null;
    c.attitude.mode = 'hold';
    c.attitude.vec = V.unit(V.sub(vt, c.v));             // 点火前先对准（真实流程）
    c.burn = {
      active: true, label: opt.label || 'burn',
      target: opt.target ? opt.target.slice() : null,
      targetFn: opt.targetFn || null,
      lastTarget: vt.slice(),
      dvIdeal: dvi, dvEngine: 0, dvActual: 0, t: 0,
      v0: c.v.slice(), prop0: this.propLeft(c),
      // tol 是关机精度（km/s）。这个值不能随便放大：地月转移对 Δv 误差极其
      // 敏感 —— 实测每 1 m/s 的关机残差会让到达月球的位置差 1700 km
      //（兰伯特往返本身是精确的，1e-7 km）。所以取 0.05 m/s，
      // 末端自动收步长到 a·h ≈ tol，把残差压在百公里级，再由中途修正收拾干净
      //（真实任务也是这么干的：TLI 之后有 MCC-2）。
      maxT: opt.maxT || 2400, tol: opt.tol || 0.00005,
      termH: 0.02, terminal: false, reason: null
    };
    if (this.onBurnStart) this.onBurnStart(c, c.burn);
    return c.burn;
  };

  World.prototype.endBurn = function (c, reason) {
    var b = c.burn;
    if (!b || !b.active) return b;
    b.active = false;
    b.reason = reason || 'done';
    b.dvActual = V.mag(V.sub(c.v, b.v0));
    b.propUsed = b.prop0 - this.propLeft(c);
    c.throttleCmd = 0;
    c.throttle = 0;
    if (this.onBurnEnd) this.onBurnEnd(c, b);
    return b;
  };

  // 每个物理步调用：重算目标速度、对准推力方向、闭环给油门、必要时关机
  World.prototype.updateBurn = function (c, h) {
    var b = c.burn;
    if (!b || !b.active) return;
    b.t += h;
    // 开环模式：姿态固定，关机按"速度达到目标轨道在该半径上的速度"判据
    //（真实运载器/飞船的"速度关机"制导：标量判据，稳定，天然吸收重力损耗）
    if (b.openloop) {
      var ao = c.activeModule();
      if (!ao || ao.module.prop <= 1e-9) { this.endBurn(c, 'propellant'); return; }
      if (b.speedOrb) {
        // 关机判据 = 速度**矢量**到达目标轨道在该位置上的速度（不只是大小）：
        // 只按大小关机的话，径向速度会留下几十 m/s 的残差，而中途修正要消掉
        // 径向误差就得正面顶重力 —— 实测一个小小的 86 m/s 修正会白烧 547 m/s。
        var bk = b.speedBody;
        var mss = bk === 'MOON' ? A.moonState(this.t) : null;
        var cvv = mss ? mss.v : [0, 0, 0], crr = mss ? mss.r : [0, 0, 0];
        // 判据只取"速度大小"：推力方向是定死的，垂直分量本来就控不了，
        // 用速度矢量判据会永远收敛不了（实测烧满 maxT 把推进剂全烧光）。
        {
          var sp = V.mag(V.sub(c.v, cvv));
          var tg = this.burnSpeedTarget(c, b.speedOrb, bk);
          if (isFinite(tg) && (b.speedUp ? sp >= tg : sp <= tg)) { this.endBurn(c, 'reached'); return; }
        }
      }
      // 定时短脉冲（dirFixed + T）：b.t 已先加了本步 h，而 chooseStep 已把 h 夹到
      // "剩余点火时间"，所以 b.t 最多正好落到 T 上。判据必须用**严格大于**：
      // 落在 T 上的末步照烧，下一拍才收尾 —— 否则恰好等于 T 的最后一步会被整段丢掉
      //（原来写 b.t >= b.T，末步 100% 丢失，短脉冲实测系统性少烧一步）。
      if (b.T && b.t > b.T + 1e-9) { this.endBurn(c, 'reached'); return; }
      if (b.t > b.maxT) { this.endBurn(c, 'timeout'); return; }
      c.attitude.mode = 'hold';
      c.attitude.vec = b.dirFixed;
      b.dirVec = b.dirFixed;
      var th0 = V.clamp(b.throttle, ao.module.throttleMin || 0.1, 1);
      c.throttleCmd = th0;
      c.throttle = th0;
      b.dvEngine += (ao.module.thrust / c.mass() / 1000) * th0 * h;
      return;
    }
    var vt = b.targetFn ? b.targetFn(c, this) : b.target;
    if (vt) b.lastTarget = vt;
    else vt = b.lastTarget;
    if (!vt) { this.endBurn(c, 'no-target'); return; }
    var vErr = V.sub(vt, c.v);
    var mag = V.mag(vErr);                                // km/s
    var act = c.activeModule();
    if (!act || act.module.prop <= 1e-9) { this.endBurn(c, 'propellant'); return; }
    if (mag <= b.tol) { this.endBurn(c, 'reached'); return; }
    if (b.t > b.maxT) { this.endBurn(c, 'timeout'); return; }
    c.attitude.mode = 'hold';
    c.attitude.vec = V.mul(vErr, 1 / mag);                // VTBG：推力沿"还差的速度"
    b.dirVec = c.attitude.vec.slice();                    // 点火对象自己也留一份
    var aMax = act.module.thrust / c.mass();              // m/s^2（当前质量下）
    var aKm = aMax / 1000;
    var stepDv = aKm * h;
    var thMin = act.module.throttleMin || 1;
    // 末端步长：让"一步能改变的速度"与关机精度同量级（固定油门发动机只能靠
    // 细分步长来提高关机精度）
    b.termH = V.clamp(b.tol / Math.max(aKm, 1e-9), 0.001, 0.05);
    // 最后一步：剩余误差不足一步推力时直接关机
    if (mag <= stepDv * 1.05 && thMin >= 1) { this.endBurn(c, 'reached'); return; }
    var th = V.clamp(mag / Math.max(stepDv * 2, 1e-12), thMin, 1);
    b.terminal = (mag < Math.max(stepDv * 40, 0.01));
    c.throttleCmd = th;
    c.throttle = th;
    b.dvEngine += aKm * th * h;
  };

  // ============================================ 燃烧中心化（有限点火的点燃时刻）
  // 有限推力点火必须**提前半个燃烧时长**点燃，关机点才会落在"理想脉冲点"上
  // —— 真实 TLI / LOI 的点燃时刻就是这么算出来的（点火时长先由火箭方程预算好）。
  //
  // 这条同时解决了另一个致命问题：如果让闭环制导"每一步重新解一次兰伯特"，
  // 目标是发散式的 —— 飞船一边烧一边前移，从新位置到同一个瞄准点所需的
  // 速度会越算越大，制导就永远追不上（实测 TLI 烧了 1 400 s、把 S-IVB、
  // 登月舱下降级、上升级、服务舱的推进剂全烧光还没关机）。
  // 正确做法是：点燃前把**关机点的目标速度矢量算成固定值**，飞行中只做
  // "把速度矢量拉到这个固定值"的闭环（这就是真实的 VTBG 迭代制导）。
  function estimateBurnSecs(c, dvKmS) {
    var act = c.activeModule();
    if (!act || !(act.module.thrust > 0)) return 300;
    var isp = c.ispNow(act.module);
    var ve = isp * g0 / 1000;
    var mdot = act.module.thrust / (isp * g0);          // kg/s
    var m0 = c.mass();
    var prop = m0 - m0 / Math.exp(Math.max(dvKmS, 0) / ve);
    return V.clamp(prop / Math.max(mdot, 1e-3), 0.5, 3000);
  }

  // 由"点火时刻的状态"推出"关机点应有的速度矢量"：
  //   ① 脉冲点 = 沿点火前的轨道滑行 T/2 的位置（真实点火的点燃时刻就是这么定的）
  //   ② 在脉冲点求理想脉冲解（callers 用 solveAt 给出，例如一次兰伯特求解）
  //   ③ 关机点 = 沿脉冲后的转移弧再滑行 T/2 —— 关机时飞船正好在转移弧上
  // 于是闭环点火只需对准一个**固定**速度矢量，既稳定又落在正确的轨道上。
  // solveAt(rImp, tImp, half) => 脉冲后的速度矢量（ECI, km/s）
  World.prototype.centerBurn = function (c, r0, vPre, dvKmS, solveAt) {
    var T = estimateBurnSecs(c, dvKmS);
    var half = T / 2;
    var pre = numericPropagateGeocentric(this, r0, vPre, half, this.t);
    var vImp = solveAt ? solveAt(pre.r, this.t + half, half) : null;
    if (!vImp) vImp = vPre;
    var post = numericPropagateGeocentric(this, pre.r, vImp, half, this.t + half);
    return { T: T, half: half, tImp: this.t + half, rImp: pre.r, vImp: vImp,
             vPre: pre.v, rCut: post.r, vCut: post.v };
  };

  // 一步到位：由"目标轨道"求解有限点火的推力方向并启动开环点火。
  // 这是本模拟器里所有大机动（TLI / LOI / TEI / 平面机动 / DOI）的统一入口。
  World.prototype.startFiniteManeuver = function (c, orb, opts) {
    opts = opts || {};
    if (!orb) return { failed: true };
    if (c.burn && c.burn.active) return { burning: true };
    var bodyKey = orb.body === 'MOON' ? 'MOON' : 'EARTH';
    var ms = bodyKey === 'MOON' ? A.moonState(this.t) : null;
    var cr = ms ? ms.r : [0, 0, 0], cv = ms ? ms.v : [0, 0, 0];
    var rel = V.sub(c.r, cr), vrel = V.sub(c.v, cv);
    // 推力方向：当前轨道面内的切向（顺行 / 逆行）。真实大机动的姿态就是这么定的
    //（TLI 就是"顺着轨道方向推"），横向上再靠目标轨道法向对齐一次。
    // 优先用调用方给出的"脉冲解方向"（= 燃烧中心化算出的 v_imp − v_pre），
    // 这才是真实点火的姿态：它包含切向分量之外的径向分量（TLI 的抬头 ~4°）。
    // 没有给的时候退回"当前轨道面内的切向"。
    var tHat;
    if (opts.dir) {   // 调用方给了脉冲解方向就照它打（大机动都是这样）

      tHat = V.unit(opts.dir);
    } else {
      var nCur = V.mag(V.cross(rel, vrel)) > 1e-9 ? V.unit(V.cross(rel, vrel)) : orb.n;
      tHat = V.unit(V.cross(nCur, V.unit(rel)));
      if (V.dot(tHat, orb.n) < 0) tHat = V.mul(tHat, -1);
      if (opts.retro) tHat = V.mul(tHat, -1);
    }
    var spd = V.mag(vrel);
    var tgt = this.burnSpeedTarget(c, orb, bodyKey);
    // ---------------------------------------------------------------- 捕获 / 降轨
    // 这类机动的目标必须用**速度矢量**闭环，不能只比大小：
    // 只控速度大小时，径向速度分量没人管 —— 同样的速率配一个错误的径向分量，
    // 轨道近点可以差出几千公里（实测 LOI 捕获出来的近月点时高时低，有时直接
    // 压到月面以下，整条 M5 链路随之全废）。
    // 目标取"以当前位置为远点、近点 = periR 的椭圆在该位置的速度矢量"——
    // 它只跟位置有关，是**光滑**的，所以 VTBG 闭环稳定收敛（不会像"每步重解
    // 兰伯特"那样发散）。
    if (orb.periR) {
      var self = this;
      // ⚠ 目标椭圆的"另一端"必须**钉死**在燃烧中心化算出的那个半径上（orb.rFixed），
      //   不能每步取"飞行器当前半径"。取当前半径的话，飞船一边减速一边往下降，
      //   目标椭圆跟着一起缩小 → 需要的横向速度反而变大 → 制导越烧越亏，
      //   闭环把推力一直加下去，最后烧掉 17.7 t SPS（真实 LOI-1 只用 11.4 t）。
      //   实测现象：LOI 请求 Δv 1 065 m/s，喷口积分却是 1 454 m/s —— 多出来的
      //   389 m/s 全花在追一个自己往下掉的目标上。钉死以后目标是一条固定椭圆，
      //   制导收敛到它即可，多出来的只有真正的重力损耗。
      var tgtFn = function (cc, ww) {
        var ms2 = bodyKey === 'MOON' ? A.moonState(ww.t) : null;
        var crr = ms2 ? ms2.r : [0, 0, 0], cvv = ms2 ? ms2.v : [0, 0, 0];
        var rel2 = V.sub(cc.r, crr);
        var r2 = V.mag(rel2);
        if (r2 < 1) return null;
        var rp2 = Math.min(orb.periR, r2 * 0.999);
        var ra2 = orb.rFixed ? orb.rFixed : r2;
        if (!(ra2 > rp2 * 1.001)) ra2 = rp2 * 1.001;
        var a2 = (rp2 + ra2) / 2;
        return targetOrbitVelocity(orb.mu, a2, orb.n, cc.r, crr, cvv);
      };
      var vt0 = tgtFn(c, this);
      if (!vt0) return { done: true };
      var dvC = V.mag(V.sub(vt0, c.v));
      if (!(dvC > 0.005)) return { done: true };
      var Tmx = V.clamp(estimateBurnSecs(c, dvC) * 3 + 20, 30, 2400);
      if (opts.maxT) Tmx = Math.min(Tmx, opts.maxT);
      var bc = this.finiteBurn(c, {
        label: opts.label || 'capture', targetFn: tgtFn, dvIdeal: dvC, maxT: Tmx
      });
      if (!bc) return { noPropellant: true, dv: dvC };
      return { burning: true, dv: dvC, closed: true };
    }
    // ---------------- 位置相关的矢量迭代制导（TLI 用）----------------
    // 真实运载器的入轨/TLI 都是"迭代制导"：目标不是一个固定速度矢量，
    // 而是"**当前位置**在目标转移轨道上应该有的速度矢量"（位置的光滑函数），
    // 制导每一步把推力对准 (v_目标 − v_当前)，同时自动修正速度和方向。
    // 为什么必须这样：原来 TLI 用"固定姿态 + 速率关机"，方向残差没人管 ——
    // 关机时的速度方向差几 m/s，放大 72 h 之后到月球就是 8 000 km 的偏差，
    // 靠中途修正是补不回来的（要求 MCC 烧 250 m/s 以上，那不叫中途修正）。
    // "圆化到指定半径"：目标 = 「一端 = 当前半径、另一端 = roundToKm」的椭圆在
    // 当前位置的速度矢量。只把半长轴对上是不够的（那样只会得到一个半长轴
    // 相同、偏心率不变的椭圆 —— 实测飞船停在 162×1008 的怪轨道上，然后一直
    // 烧到把推进剂烧光）；这个位置相关的目标才会真正把轨道收成圆。
    if (opts.roundToKm && orb && orb.n) {
      var rr0 = opts.roundToKm;
      var selfR = this;
      var tgtFnR = function (cc, ww) {
        var ms2 = bodyKey === 'MOON' ? A.moonState(ww.t) : null;
        var crr = ms2 ? ms2.r : [0, 0, 0], cvv = ms2 ? ms2.v : [0, 0, 0];
        var rel2 = V.sub(cc.r, crr);
        var r2 = V.mag(rel2);
        if (r2 < 1) return null;
        return targetOrbitVelocity(orb.mu, (r2 + rr0) / 2, orb.n, cc.r, crr, cvv);
      };
      var vt0R = tgtFnR(c, this);
      if (!vt0R) return { done: true };
      var dvCR = V.mag(V.sub(vt0R, c.v));
      if (!(dvCR > 0.005)) return { done: true };
      var TmxR = V.clamp(estimateBurnSecs(c, dvCR) * 2.2 + 20, 20, 2400);
      if (opts.maxT) TmxR = Math.min(TmxR, opts.maxT);
      var bcR = this.finiteBurn(c, {
        label: opts.label || 'burn', targetFn: tgtFnR, dvIdeal: dvCR, maxT: TmxR
      });
      if (!bcR) return { noPropellant: true, dv: dvCR };
      return { burning: true, dv: dvCR, closed: true };
    }
    if (opts.closed && orb && orb.a && orb.n) {
      var self2 = this;
      var tgtFn2 = function (cc, ww) {
        var ms2 = bodyKey === 'MOON' ? A.moonState(ww.t) : null;
        var crr = ms2 ? ms2.r : [0, 0, 0], cvv = ms2 ? ms2.v : [0, 0, 0];
        return targetOrbitVelocity(orb.mu, orb.a, orb.n, cc.r, crr, cvv);
      };
      var vt0 = tgtFn2(c, this);
      if (!vt0) return { done: true };
      var dvC = V.mag(V.sub(vt0, c.v));
      if (!(dvC > 0.005)) return { done: true };
      var Tmx2 = V.clamp(estimateBurnSecs(c, dvC) * 2.2 + 30, 30, 2400);
      if (opts.maxT) Tmx2 = Math.min(Tmx2, opts.maxT);
      var bc2 = this.finiteBurn(c, {
        label: opts.label || 'burn', targetFn: tgtFn2, dvIdeal: dvC, maxT: Tmx2
      });
      if (!bc2) return { noPropellant: true, dv: dvC };
      return { burning: true, dv: dvC, closed: true };
    }
    if (opts.retro === undefined) opts.retro = false;
    var dv0 = Math.abs(spd - tgt);
    // 小于 5 m/s 的残差不必再点一次火 —— 否则"速度判据"会因为目标速度随
    // 半径变化而变成一次停不下来的小燃烧（实测把服务舱最后 3.3 t 白烧掉）。
    if (!(dv0 > 0.005)) return { done: true };
    // 燃烧时长上限 = 火箭方程预算的 3 倍：速度判据在"目标速度随半径变化"
    // 的几何下有可能一直不满足（实测 DOI 想烧 19 m/s 却烧了 900 s / 4 014 m/s），
    // 加一个硬上限把它兜住。
    var Tmax = V.clamp(estimateBurnSecs(c, dv0) * 3 + 20, 30, 1500);
    if (opts.maxT) Tmax = Math.min(Tmax, opts.maxT);
    var b = this.finiteBurn(c, {
      label: opts.label || 'burn', dirFixed: tHat, openloop: true,
      speedUp: !opts.retro, speedFn: true, speedOrb: orb, speedBody: bodyKey,
      dvIdeal: dv0, maxT: Tmax
    });
    if (!b) return { noPropellant: true, dv: dv0 };
    return { burning: true, dv: dv0, dir: tHat };
  };

  // ------------------------------------------- 有限点火的推力方向（打靶法）
  // 目标轨道上、位置 rAbs 处应有的速度矢量（ECI）：
  //   orbit = { mu, a, n, body }  —— 引力常数 / 半长轴 / 轨道面法向 / 中心天体
  //   v = sqrt(μ(2/r − 1/a)) 沿 (n × r̂) 方向，再叠上中心天体自身的速度
  function targetOrbitVelocity(mu, a, n, rAbs, cr, cv) {
    var rel = V.sub(rAbs, cr);
    var rm = V.mag(rel);
    if (rm < 1) return null;
    var s = 2 / rm - 1 / a;
    if (!(s > 0)) return null;
    var t = V.cross(n, V.unit(rel));
    if (V.mag(t) < 1e-9) return null;
    return V.add(cv, V.mul(V.unit(t), Math.sqrt(mu * s)));
  }

  // 求有限点火的**常值惯性推力方向**：打靶法。
  // 为什么不能用"每步重解兰伯特"的闭环：地月转移对位置极其敏感
  //（每 1 m/s 的速度误差 = 到达月球 1 700 km 的位置误差），从"当前移动后的
  // 位置"重解出来的目标速度每步跳几十 m/s，制导永远追不上 —— 实测 TLI 会
  // 一直烧到把 S-IVB、登月舱下降级/上升级、服务舱的推进剂全烧光还不关机。
  // 真实的有限点火本来也不是这么打的：飞行前把推力方向（姿态程序）算成
  // **常值惯性方向**，飞行中只需要保持姿态 + 按时关机（迭代制导只做小修正）。
  // 这里用打靶法解这个方向：迭代积分动力弧 T 秒，用末速度与目标轨道的差修正 u。
  // （历史方案，保留备查）曾经试过"打靶法解常值推力方向使末状态落在目标轨道上"，
  // 但 2 个自由度的推力方向无法同时满足"位置 + 速度"三个约束，实测残差停在
  // 100 m/s 量级、甚至把推力方向拧到水平线下 41°。真正的做法见
  // startFiniteManeuver：**方向按顺行/逆行切向定死，关机按"速度达到目标轨道
  // 在该半径上的速度"判据**——这正是真实运载器/飞船的"速度关机"制导，
  // 是标量判据，稳定且天然吸收了重力损耗。
  World.prototype.burnSpeedTarget = function (c, orb, bodyKey) {
    var ms = (bodyKey === 'MOON') ? A.moonState(this.t) : null;
    var cr = ms ? ms.r : [0, 0, 0], cv = ms ? ms.v : [0, 0, 0];
    var rel = V.sub(c.r, cr);
    var rm = V.mag(rel);
    if (rm < 1) return Infinity;
    // 捕获 / 降轨用的是「以当前半径为远点、近点 = periR 的椭圆」：
    //   v = sqrt(2μ·rp / (r(r+rp)))
    // 为什么不用固定的半长轴 a：远点是"点火瞬间的位置"，飞船一边烧一边往外走，
    // 一旦走出 a 的范围（2/r − 1/a < 0）目标速度就无定义，速度判据永远不满足，
    // 点火会一路烧到 maxT 超时（实测 LOI 就是这样捕获失败的）。
    if (orb.periR) {
      var rp = Math.min(orb.periR, rm * 0.999);
      return Math.sqrt(orb.mu * 2 * rp / (rm * (rm + rp)));
    }
    var s = 2 / rm - 1 / orb.a;
    return s > 0 ? Math.sqrt(orb.mu * s) : Infinity;
  };

  // 由状态求"目标轨道"描述（供 solveBurnDirection 使用）
  function orbitDesc(mu, body, rAbs, vAbs, cr, cv) {
    var el = M.elements(mu, V.sub(rAbs, cr), V.sub(vAbs, cv));
    if (!isFinite(el.a) || !(el.a > 0)) return null;
    var n = V.mag(el.hvec) > 1e-9 ? V.unit(el.hvec) : null;
    if (!n) return null;
    return { mu: mu, a: el.a, n: n, body: body, elements: el };
  }

  // 由任意状态构造"目标轨道"描述（供 startFiniteManeuver 使用）
  World.prototype.orbitFromState = function (rAbs, vAbs, bodyKey, mu) {
    var ms = bodyKey === 'MOON' ? A.moonState(this.t) : null;
    return orbitDesc(mu, bodyKey, rAbs, vAbs,
      ms ? ms.r : [0, 0, 0], ms ? ms.v : [0, 0, 0]);
  };

  // --------------------------------------------------- 脉冲机动（规划用）
  // 只用于估算与规划（计算器、霍曼式估算）；真实任务机动走 finiteBurn。
  World.prototype.impulsiveBurn = function (c, dvKmS, dir) {
    var m0 = c.mass();
    var ve = c.exhaustVelocity();
    var m1 = m0 / Math.exp(dvKmS / ve);
    var need = m0 - m1;
    // 关键顺序见 propOrder()：先用当前主级，不够时只向不低于当前级的模块借
    //（否则会跨级偷登月舱下降级的 8.2 t 推进剂，动力下降必坠毁）。
    var order = this.propOrder(c);
    for (var k0 = 0; k0 < order.length && need > 1e-9; k0++) {
      var mk = order[k0];
      if (!mk.hasEngine || mk.prop <= 0) continue;
      var take = Math.min(mk.prop, need);
      mk.prop -= take; need -= take;
    }
    if (need > 1e-6) return false;
    c.v = V.scaleAdd(c.v, V.unit(dir), dvKmS);
    c.dvUsed += dvKmS;
    return true;
  };

  // 依次尝试：优先用当前主级，不足则用其他有推进剂的模块
  World.prototype.planBurn = function (c, dvKmS, dir) {
    var ve = c.exhaustVelocity();
    var m0 = c.mass();
    var m1 = m0 / Math.exp(dvKmS / ve);
    return { massBefore: m0, massAfter: m1, propUsed: m0 - m1, ve: ve };
  };

  // ------------------------------------------------- 地月转移瞄准（B 面 + 迭代）
  // 直接把兰伯特的目标设成"月心"会让转移轨道一头扎进月面；真实任务瞄的是
  // **B 平面**上距月心 b 的一点，b 由"想要的近月点高度"反解：
  //     b = rp · sqrt(1 + 2μ/(rp·v∞²))
  // 而且偏置方向必须垂直于 **月心系** 的到达速度 v∞。这里有个曾经的真实 bug：
  // 用"地心到达速度"（约 0.19 km/s，几乎沿径向）当 B 面轴是错的 —— 真正的
  // v∞（约 1.0~1.3 km/s）几乎与月球公转方向相反，两者差了近 90°。做错的话
  // 到达平面会偏离着陆点 8° 以上，LOI 之后要靠服务舱花上千米/秒去转平面，
  // SPS 根本不够（于是会去偷登月舱的推进剂，动力下降直接没油）。
  //
  // 再用**与仿真同一套引力**做数值迭代（飞行力学里真正的"迭代制导/目标修正"），
  // 把实际的 B 面偏差收敛到几公里 —— 因为月球引力影响球半径 66 183 km，飞行器
  // 在到达前好几个小时就已经被月球拽偏，纯二体的 B 面解是不够的。
  function numericPropagateGeocentric(world, r0, v0, tof, t0, nSteps) {
    // ⚠ 早期版本这里用 h = tof/nSteps（默认 300 → 一次 73 h 转移就是 876 s 一步，
    // MCC 里甚至是 292 s 一步）。粗步长积分出来的"轨迹"和真正飞行的那条
    // 差着几百上千公里，MCC 于是把飞船"修"到一条错误的瞄准点上。
    // 现在统一走 integrateSim（= 仿真同款步长）。
    var t = (t0 === undefined ? world.t : t0);
    return integrateSim(world, r0, v0, t, t + tof, {});
  }

  // 从 (r0,v0)/t0 出发、用与仿真同一套引力积分到 tEnd，
  // 找出对月球的**真正最近接近点**（近月点）。
  // 步长随"到月球的距离"自适应：远时 900 s，近时收到 10 s —— 否则近月点附近
  // 一步就跨过几千公里，量出来的"最近距离"根本不对（这正是旧瞄准失败的原因之一：
  // 旧代码拿"到达时刻的位置在到达速度垂直方向上的分量"当 B 面偏移，可是在
  // 4 000 km 这样远没到渐近线的地方，那个分量跟真正的近月点高度差着几万公里）。
  function closestApproach(world, r0, v0, t0, tEnd) {
    // 统一走 integrateSim：步长与仿真完全一致，量出来的近月点就是真的近月点
    return integrateSim(world, r0, v0, t0, tEnd, { closest: true });
  }

  // 瞄准误差（相对月球）：近月点高度误差 + "近月点方向 vs 着陆点方向"误差。
  // 两个都换算成 km，方便做 2 参数 Newton。
  //
  // 关键：**用月心二体根数**求近月点，而不是"到达时刻位置在速度垂直方向上的分量"。
  // 后者只有在"已经飞到无穷远"时才是 B 面偏移量；在离月球几万公里处那个分量
  // 与真正的近月点差着几万公里（这正是旧瞄准把近月点瞄到月面以下/几万公里外的原因）。
  // 评估点选在离月球 20 000 km 处：再近就落进月球引力井（根数对时间太敏感），
  // 再远就还在"渐近线尚未形成"的区域。
  function propagateToMoonDistance(world, r0, v0, t0, tEnd, stopKm) {
    // ⚠ 同样统一走 integrateSim。旧版这里用 h = clamp(月距/200, 20, 300)，
    // 在近地段就是 300 s 一步 —— 恰恰是 TLI 之后最需要精度的那一段。
    var st = integrateSim(world, r0, v0, t0, tEnd, { stopKm: stopKm });
    if (st && st.r) {
      var dm = V.dist(st.r, A.moonState(st.t).r);
      if (dm <= stopKm + 1e-6) return st;
    }
    return null;
  }

  // --------------------------------------------- 双曲线开普勒：入点到近月点时间
  // 由近月点 (ν=0) 到真近点角 ν 的飞行时间（ν<0 → 入点，返回负值）。
  //   a = p/(1−e²) < 0；n = √(μ/(−a)³)；sinh H = √(e²−1)·sinν/(1+e·cosν)
  function hypTimeFromPeriapsis(mu, p, e, nu) {
    var denom = 1 + e * Math.cos(nu);
    if (!(denom > 1e-12)) return 0;
    var sh = Math.sqrt(Math.max(0, e * e - 1)) * Math.sin(nu) / denom;
    var H = Math.log(sh + Math.sqrt(sh * sh + 1));        // asinh(sh)
    var a = p / (1 - e * e);                              // < 0（双曲线）
    var n = Math.sqrt(mu / (-a * -a * -a));
    return (e * Math.sinh(H) - H) / n;
  }

  // 瞄准误差（相对月球）：**真近月点**高度 + 到达轨道面夹角 + v∞。
  //
  // ⚠ 旧版在"离月球 20 000 km"处取**瞬时**月心二体根数、拿 el.periapsis 当近月点 ——
  //   在渐近线尚未形成的地方，瞬时根数的"近月点"是**假近月点**（与真值差几万公里）。
  //   现在用与仿真同一套引力**实积分到真正的最近接近点**（integrateSim closest），
  //   再在近月点取轨道面法向与能量 v∞。
  //   stopKm = 月面 +1 km：一旦撞月（真近月点在月面以下）就在进入月面 1 km 处停住，
  //   不会掉进"0.02 s 步长跑满全程"的几十万步巨慢；maxSteps 再兜一层。
  //
  // 到达面目标：到达轨道面必须**含着陆点方向** siteDir（近月点方向落在目标面内）。
  //   plane = n̂·siteDir（0 = 站点方向在到达面内，有符号，供 Newton 求根）；
  //   planeDeg = asin(|n̂·siteDir|)（度，供验收）。
  // 返回字段保持向后兼容（peri / vInf / angDeg / altErr / siteErr / planeDeg …）。
  function lunarAimError(world, r0, v0, t0, tEnd, periAltKm, lat, lon, siteDirFix) {
    var mu = B.MOON.mu, Rm = B.MOON.radius;
    var ca = integrateSim(world, r0, v0, t0, tEnd,
      { closest: true, stopKm: Rm + 1, maxSteps: 200000 });
    if (!ca || !ca.r) return null;
    var ms = A.moonState(ca.t);
    var rel = V.sub(ca.r, ms.r), vrel = V.sub(ca.v, ms.v);
    var dist = ca.dist;
    var peri = dist - Rm;
    // v∞：由近月点能量反推（v∞² = v² − 2μ/r）
    var vInf = Math.sqrt(Math.max(0, V.dot(vrel, vrel) - 2 * mu / dist));
    // 目标面方向：优先用调用方钉死的方向（与种子一致）；否则取近月点时刻的站点方向
    var siteDir = siteDirFix;
    if (!siteDir) siteDir = V.unit(V.sub(A.moonSurfacePoint(ca.t, lat, lon, 0).r, ms.r));
    var nArr = V.cross(rel, vrel), nm = V.mag(nArr);
    // v∞：近月点能量反推；B 面冲击参数 b = |h|/v∞ 一并给出（沿轨道守恒，仅作诊断/核对）
    var vinf2 = Math.max(0, V.dot(vrel, vrel) - 2 * mu / dist);
    var bMag = nm / Math.sqrt(Math.max(1e-12, vinf2));
    var plane = 1, planeDeg = 90;
    if (nm > 1e-12) {
      plane = V.dot(V.mul(nArr, 1 / nm), siteDir);
      planeDeg = Math.asin(Math.min(1, Math.abs(plane))) * 180 / Math.PI;
    }
    // 诊断：近月点方向 vs 站点方向（旧字段 angDeg，保留兼容；目标函数不再用它）
    var upMin = dist > 1e-9 ? V.mul(rel, 1 / dist) : [1, 0, 0];
    var ang = Math.acos(V.clamp(V.dot(upMin, siteDir), -1, 1));
    return { altErr: peri - (periAltKm || 111), peri: peri, vInf: Math.sqrt(vinf2), b: bMag,
             plane: plane, planeDeg: planeDeg,
             ang: ang, angDeg: ang * 180 / Math.PI,
             siteErr: ang * (Rm + 200) * (world.aimSiteW === undefined ? 0.15 : world.aimSiteW),
             t: ca.t, r: ca.r, v: ca.v, dist: dist, siteDir: siteDir, passed: ca.passed, exhausted: ca.exhausted };
  }

  // 3×3 线性方程组 A·x = b（列主元高斯消元）；奇异/非有限返回 null
  function solve3(A, b) {
    var M = [[A[0][0], A[0][1], A[0][2], b[0]],
             [A[1][0], A[1][1], A[1][2], b[1]],
             [A[2][0], A[2][1], A[2][2], b[2]]];
    for (var c = 0; c < 3; c++) {
      var piv = c, pm = Math.abs(M[c][c]);
      for (var r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > pm) { pm = Math.abs(M[r][c]); piv = r; }
      if (!(pm > 1e-30)) return null;
      if (piv !== c) { var t = M[c]; M[c] = M[piv]; M[piv] = t; }
      for (var r2 = c + 1; r2 < 3; r2++) {
        var fac = M[r2][c] / M[c][c];
        for (var k = c; k < 4; k++) M[r2][k] -= fac * M[c][k];
      }
    }
    var x = [0, 0, 0];
    for (var i = 2; i >= 0; i--) {
      var sum = M[i][3];
      for (var j = i + 1; j < 3; j++) sum -= M[i][j] * x[j];
      x[i] = sum / M[i][i];
    }
    if (!isFinite(x[0]) || !isFinite(x[1]) || !isFinite(x[2])) return null;
    return x;
  }

  // ================================================== 地月转移瞄准（真实到达几何）
  //
  // 目标（AGENT_HANDOFF/08 §1）**只此三项**：
  //   ① 真近月点高度 = periAltKm（默认 111 km；不再是 250）
  //   ② 到达轨道面 = 目标月球轨道面（面内含着陆点方向 siteDir）
  //   ③ 到达能量：v∞ = opts.targetVInf（默认 1.09 km/s，真实任务值；验收看 LOI-1=889±50 m/s）
  //
  // 方法：
  //   A. 解析 B 面入射种子（patched conic）：
  //      rp = R_moon + periAlt；e = 1 + rp·v∞²/μ；b = rp√(1+2μ/(rp·v∞²)) = rp√((e+1)/(e−1))
  //      δ = 2·asin(1/e)（转向角）
  //      Bhat = 站点方向在 B 面（⊥ s）内的投影 → 到达面**自动含着陆点**
  //      pHat = s/e + Bhat·√(1−1/e²)，qHat = s·√(1−1/e²) − Bhat/e
  //      在 rEntry（20k~50k km）处解双曲线 r/v 与入点→近月点时间 → tEntry = tPeri − Δt
  //      Lambert(pre.r → moonState(tEntry).r + rHyp) → v1_seed
  //      迭代来向 s 使 patched-continuity（Lambert 到达相对速度对齐双曲线）
  //   B. 全模型小修正：以 v1 为三变量，用**与仿真同一套引力**的 integrateSim
  //      实积分到真近月点，取 (近月点, 到达面, v∞) 三残差做数值 Newton。
  //      ⚠ 修正量 > 20 m/s 或近月点误差 > 20 km（或 LOI-1 出 889±50 m/s）→ 明确 failed，
  //        绝不"偷偷提高 v∞ 到 1.1"糊过去。
  //
  // 返回结构向后兼容 startFiniteManeuver 的 TLI 用法：
  //   aim.orbit / aim.cut{T,half,vImp,vPre,rCut,vCut} / aim.T / aim.half / aim.v1 /
  //   aim.aim / aim.tArr / aim.periAlt / aim.vInf / aim.dv / aim.smallCorrection
  // ---- LOI-1 的能量验收（AGENT_HANDOFF/12）----
  // 到达 v∞ 不再是淘汰条件；真正验收的是**由它算出的 LOI-1**：
  //   双曲线近月点速度  v_hyp = √(v∞² + 2μ_m/r_p)，r_p = R_m + 近月点高度
  //   目标椭圆(111×315 km)在近月点的速度 v_ell = √(μ_m(2/r_p − 1/a_t))
  //   LOI-1 = v_hyp − v_ell，验收 889 ± 50 m/s（真实任务 889 m/s）
  // 依据：v∞=1.087 km/s ↔ LOI-1 = 876 m/s（差 1.4%）；
  //   旧的 [0.83,0.90] 窗口对应 LOI-1≈787 m/s，与真实任务不符，
  //   会把真实的 75.9 h 转移（v∞=1.087）整个排除掉。
  function loi1DeltaV(vInf, periAltKm) {
    var rP = B.MOON.radius + periAltKm;
    var vHyp = Math.sqrt(vInf * vInf + 2 * B.MOON.mu / rP);
    var aT = B.MOON.radius + (111 + 315) / 2;
    var vEll = Math.sqrt(B.MOON.mu * (2 / rP - 1 / aT));
    return vHyp - vEll;                       // km/s
  }
  var LOI1_TGT = 0.889, LOI1_TOL = 0.050;     // 889 ± 50 m/s

  World.prototype.lunarAimPoint = function (c, tof, periAltKm, opts) {
    opts = opts || {};
    var self = this;
    var muE = B.EARTH.mu, muM = B.MOON.mu, Rm = B.MOON.radius;
    var tgtPeri = (periAltKm === undefined || periAltKm === null) ? 111 : periAltKm;
    var tgtVInf = (opts.targetVInf === undefined) ? 1.09 : opts.targetVInf;   // HANDOFF/12：真实到达 v∞≈1.09
    if (!c || !c.r || !c.v) return { failed: 'craft' };
    if (!isFinite(tgtVInf) || tgtVInf < 0.5 || tgtVInf > 1.6) return { failed: 'target-vinf' };   // 只做数值合理性检查
    if (!isFinite(tgtPeri) || Math.abs(tgtPeri - 111) > 1e-9) return { failed: 'target-peri' };
    if (!isFinite(tof) || !(tof > 600)) return { failed: 'tof', tof: tof };
    var tArr = this.t + tof;
    var lat = (opts.siteLat === undefined) ? APL.LANDING_SITE.lat : opts.siteLat;
    var lon = (opts.siteLon === undefined) ? APL.LANDING_SITE.lon : opts.siteLon;
    var ms = A.moonState(tArr);
    // 目标面方向：tArr 时刻的着陆点方向（钉死；种子与残差共用，保证自洽）
    var siteDir = V.unit(V.sub(A.moonSurfacePoint(tArr, lat, lon, 0).r, ms.r));
    var rel0 = V.sub(c.r, this.primaryPos('EARTH'));
    var vrel0 = V.sub(c.v, this.primaryVel('EARTH'));

    // ① 基线：瞄月心的两体 Lambert —— 借它估 Δv 与来向 s0（会撞月，只用方向）
    var L0 = M.lambert(muE, rel0, ms.r, tof, true);
    if (!L0) return { failed: 'lambert' };
    var dvEst = V.mag(V.sub(L0.v1, vrel0));
    var T = estimateBurnSecs(c, dvEst);
    var half = T / 2;
    var pre = numericPropagateGeocentric(this, rel0, vrel0, half, this.t);
    if (!pre || !pre.r) return { failed: 'propagate' };
    var tBurn = this.t + half;                    // 有限点火脉冲点时刻

    // ② 解析 B 面 + patched-conic 入射种子（v∞ 固定 = 目标；只迭代来向 s）
    var rp = Rm + tgtPeri;
    var eHyp = 1 + rp * tgtVInf * tgtVInf / muM;
    var bMag = rp * Math.sqrt(1 + 2 * muM / (rp * tgtVInf * tgtVInf));
    var rEntry = V.clamp(opts.rEntry || 40000, 20000, 55000);
    var s = V.unit(V.sub(L0.v2, ms.v));           // 来向初值：月心 Lambert 到达相对速度方向
    var buildSeed = function (sVec) {
      var perp = V.sub(siteDir, V.mul(sVec, V.dot(siteDir, sVec)));
      if (V.mag(perp) < 1e-9) {
        var tmp = Math.abs(sVec[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        perp = V.cross(sVec, tmp);
      }
      var Bhat = V.unit(perp);
      var kk = Math.sqrt(Math.max(0, 1 - 1 / (eHyp * eHyp)));
      var pHat = V.add(V.mul(sVec, 1 / eHyp), V.mul(Bhat, kk));
      var qHat = V.sub(V.mul(sVec, kk), V.mul(Bhat, 1 / eHyp));
      var p = rp * (1 + eHyp);
      var h = Math.sqrt(muM * p);
      var cn = (p / rEntry - 1) / eHyp;
      if (cn > 1) return null;                    // rEntry 太靠近近月点（不该发生）
      var nuE = -Math.acos(V.clamp(cn, -1, 1));
      var rHyp = V.mul(V.add(V.mul(pHat, Math.cos(nuE)), V.mul(qHat, Math.sin(nuE))), rEntry);
      var vHyp = V.mul(V.add(V.mul(pHat, -Math.sin(nuE)), V.mul(qHat, eHyp + Math.cos(nuE))), muM / h);
      var tb = hypTimeFromPeriapsis(muM, p, eHyp, nuE);   // < 0（入点在近月点之前）
      return { rHyp: rHyp, vHyp: vHyp, timeBeforePeri: -tb };
    };
    var v1seed = null, seedInfo = null;
    for (var it = 0; it < 12; it++) {
      var sd = buildSeed(s);
      if (!sd) break;
      var tEntry = tArr - sd.timeBeforePeri;
      var tLam = tEntry - tBurn;
      if (!(tLam > 60)) break;
      var msE = A.moonState(tEntry);
      var L1 = M.lambert(muE, pre.r, V.add(msE.r, sd.rHyp), tLam, true);
      if (!L1) break;
      v1seed = L1.v1.slice();
      var vArrRel = V.sub(L1.v2, msE.v);
      seedInfo = { tEntry: tEntry, tLam: tLam, vArrRel: vArrRel, vHyp: sd.vHyp };
      // ⚠ 这里把"近场到达速度方向"当渐近线方向更新 s。严格说二者相差一个由双曲线
      //   几何定死的 β（rEntry=40 000 km 处约 0.46°，rEntry 越小偏得越多；真正的
      //   渐近线方向 = 把 vArrRel 绕轨道面法向回旋 +β）。**实测把它按 β 回旋成真渐近线
      //   反而更差**：全模型 LM 更容易把近月点打穿（cand1/98h：110.7 km → 1 km）。
      //   故保留当前启发式；不要再"顺手修正"这一行。
      var sNew = V.unit(vArrRel);
      var conv = V.mag(V.sub(sNew, s));
      s = sNew;
      if (conv < 1e-5) break;
    }
    if (!v1seed) return { failed: 'seed' };
    var patchedErr = V.mag(V.sub(seedInfo.vArrRel, seedInfo.vHyp));   // 解析种子 patched 残差 km/s

    // ③ 全模型小修正：三变量 Newton（修 departure velocity v1）
    //    残差 ① 近月点高度−目标  ② 到达面 n̂·siteDir（有符号，0 = 站点在面内）
    //        ③ v∞−目标；全部用 integrateSim 实积分到真近月点求。
    //    ⚠ 这个几何下雅可比**近乎奇异**（实测三行几乎平行：近月点与 v∞ 对 Δv 的
    //      响应方向几乎相同，而到达面对 Δv 极不敏感），朴素 3×3 求逆会给出几百
    //      m/s 的乱步。改用 **Levenberg–Marquardt 阻尼最小二乘**，沿"最有效的那个
    //      方向"走，病态方向被压住。
    //    ⚠ 收敛判据用**验收标准**（近月点 ±5 km、面 ≤0.05°、LOI-1 落在 889±50 m/s），
    //      不再追"g 全零"：本几何下 v∞ 常常**物理上到不了** 0.87（窗口决定），
    //      硬追只会空转上百次 eval 还把近月点带偏；只要三项进窗口就收工。
    // ⚠ tEnd 必须留够：解析种子的 patched-conic 时间估计有几小时偏差，真实近月点
    //   可能落在 tArr 之前好几小时（实测 M2：早 4.08 h）。原来只留 3 h，会把近月点
    //   截掉，closest 记录到的是"被截断处"而不是真近月点。
    var tEnd = tArr + 12 * 3600;
    var evals = 0;
    // 验收窗口改由 LOI-1 给出（HANDOFF/12）：
    var loiLo = LOI1_TGT - LOI1_TOL, loiHi = LOI1_TGT + LOI1_TOL;
    // 残差缩放：近月点以 50 km 为 1（验收 20 km）、面以 0.1° 为 1、v∞ 以 0.01 为 1
    var SC = [1 / 50, 1 / 0.001745, 1 / 0.01];
    // ⚠ 到达面残差必须用**钉死**的站点方向（tArr 处的 siteDir）。
    //   试过"改成用真实近月点时刻 ca.t 处的站点方向"（那样与演示到达验收的定义完全一致），
    //   结果残差对 v1 变成非光滑（ca.t 自己也随 v1 动），LM 直接 no-converge。
    //   正确做法是保持钉死，然后在外循环里把 tArr 迭代到真实近月点时刻（见下方）。
    var evalAim = function (v1) {
      evals++;
      var aerr = lunarAimError(self, pre.r, v1, tBurn, tEnd, tgtPeri, lat, lon, siteDir);
      if (!aerr) return null;
      var f = [aerr.peri - tgtPeri, aerr.plane, aerr.vInf - tgtVInf];
      return { f: f, g: [f[0] * SC[0], f[1] * SC[1], f[2] * SC[2]], aerr: aerr };
    };
    var cost = function (E) {
      if (!E) return 1e30;
      var g = E.g;
      return g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    };
    // 验收内判据：三项全部落进（比最终验收更紧一点，留余量）
    var met = function (E) {
      if (!E || !E.aerr.passed || E.aerr.exhausted) return false;
      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.6)) return false;   // HANDOFF/13：0.05→0.6
      var l1 = loi1DeltaV(E.aerr.vInf, E.aerr.peri);
      return (l1 >= loiLo && l1 <= loiHi);
    };
    var cur = evalAim(v1seed);
    if (!cur) return { failed: 'eval-seed', seedV1: v1seed.slice() };
    var v1 = v1seed.slice();
    // HANDOFF/13 §4：TLI 段不该为"到达面"付 Δv（真实任务容忍 ~1° 的到达面误差、
// 在 LOI 付 ~13 m/s 收拾）。2 体种子与全模型目标的差异（含面/能量修正）实测 20~60 m/s，
// 因此把修正上限放到 80 m/s —— 它只是"牛顿从种子走到解"的步长预算，不是验收闸门。
    var corrCap = Math.min(0.080, (opts.maxCorrectionKmS === undefined) ? 0.080 : opts.maxCorrectionKmS);
    var hStep = 0.0005;                           // 数值雅可比步长 0.5 m/s
    var lam = 1e-3;                               // LM 阻尼
    var maxEvals = (opts.maxEvals === undefined) ? 120 : opts.maxEvals;
    var nit = 0, converged = false;
    for (; nit < 30; nit++) {
      if (met(cur)) { converged = true; break; }
      if (evals >= maxEvals) break;
      // 数值雅可比（对缩放残差 g）
      var J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], okJ = true;
      for (var jc = 0; jc < 3; jc++) {
        var vp = v1.slice(); vp[jc] += hStep;
        var Ep = evalAim(vp);
        if (!Ep) { okJ = false; break; }
        for (var ir = 0; ir < 3; ir++) J[ir][jc] = (Ep.g[ir] - cur.g[ir]) / hStep;
      }
      if (!okJ) break;
      // JᵀJ 与 Jᵀg
      var JTJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], gg = [0, 0, 0];
      for (var i2 = 0; i2 < 3; i2++) {
        for (var j2 = 0; j2 < 3; j2++) {
          var s2 = 0;
          for (var k2 = 0; k2 < 3; k2++) s2 += J[k2][i2] * J[k2][j2];
          JTJ[i2][j2] = s2;
        }
        var gs = 0;
        for (var k3 = 0; k3 < 3; k3++) gs += J[k3][i2] * cur.g[k3];
        gg[i2] = gs;
      }
      // 增益比（gain ratio）驱动的 LM：步长被接受时按 ρ 收缩 λ，否则放大 λ
      var accepted = false;
      for (var ls = 0; ls < 10 && evals < maxEvals; ls++) {
        var Ad = [[JTJ[0][0], JTJ[0][1], JTJ[0][2]],
                  [JTJ[1][0], JTJ[1][1], JTJ[1][2]],
                  [JTJ[2][0], JTJ[2][1], JTJ[2][2]]];
        for (var i3 = 0; i3 < 3; i3++) Ad[i3][i3] += lam * (JTJ[i3][i3] + 1e-12);
        var dx = solve3(Ad, [-gg[0], -gg[1], -gg[2]]);
        if (!dx) { lam *= 4; continue; }
        var vTry = V.add(v1, dx);
        if (V.mag(V.sub(vTry, v1seed)) > corrCap) { lam *= 4; continue; }
        // 线性模型的预测下降
        var pred = 0;
        for (var i5 = 0; i5 < 3; i5++) {
          var jd = 0;
          for (var j5 = 0; j5 < 3; j5++) jd += J[i5][j5] * dx[j5];
          pred += cur.g[i5] * cur.g[i5] - (cur.g[i5] + jd) * (cur.g[i5] + jd);
        }
        var Et = evalAim(vTry);
        if (!Et) { lam *= 4; continue; }
        var actual = cost(cur) - cost(Et);
        var rho = (pred > 1e-30) ? actual / pred : -1;
        if (actual > 0) {
          v1 = vTry; cur = Et; accepted = true;
          var r2 = 2 * rho - 1;
          lam *= Math.max(1 / 3, 1 - r2 * r2 * r2);
          lam = Math.max(lam, 1e-12);
          break;
        }
        lam *= 4;
      }
      if (!accepted) break;
    }
    var corr = V.mag(V.sub(v1, v1seed));
    var aerr = cur.aerr;
    var periErr = aerr.peri - tgtPeri;
    var planeDeg = aerr.planeDeg;
    var vInf = aerr.vInf;
    // 明确失败：修正量 > 20 m/s、近月点误差 > 20 km、到达面 > 0.1°、
    //   或由 v∞ 算出的 LOI-1 落在 889±50 m/s 之外（HANDOFF/12）。
    var loi1Now = loi1DeltaV(vInf, aerr.peri);
    var vinfBad = (loi1Now < loiLo || loi1Now > loiHi);
    var planeBad = (planeDeg > 1.2);   // HANDOFF/13：真实任务容忍 ~1° 到达面误差，平面在 LOI 段收拾
    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corr > corrCap + 1e-9 || vinfBad || planeBad) {
      return { failed: 'no-converge', peri: aerr.peri, periAlt: aerr.peri, periErr: periErr,
               planeDeg: planeDeg, vInf: vInf, loi1: loi1Now, corr: corr, patchedErr: patchedErr,
               converged: converged, evals: evals, iterations: nit, tArr: tArr, tof: tof,
               v1: v1.slice(), seedV1: v1seed.slice() };
    }

    // ---- 外循环：把设计到达时刻 tArr 迭代到**真实近月点时刻** ----
    // 为什么必须做：解析种子的 patched-conic 时间估计有几小时偏差（实测 M2：真实
    //   近月点比 tArr 早 4.08 h），而"到达面必须含着陆点"依赖的是**到达那一刻**的
    //   站点方向（月球 4 h 自转 2.2°）。钉死 tArr 当参考，真实到达面上的面差会偏到
    //   0.15°，刚好越过 0.1° 验收线（实测：M2 的 TLI 打靶通过、近月点进 111±20，
    //   最后就死在"到达轨道面差 0.15° > 0.1°"）。
    //   把 tof 调成 (真实近月点时刻 − now) 重解一次，让设计时刻与到达时刻自洽。
    //   ⚠ 不要改成"残差里用 ca.t 处的站点方向"——那样残差对 v1 非光滑，LM 不收敛。
    var aimIt = opts._aimIter || 0;
    if (aimIt < 2 && isFinite(aerr.t) && Math.abs(aerr.t - tArr) > 300) {
      var o2 = {}, kk2;
      for (kk2 in opts) if (Object.prototype.hasOwnProperty.call(opts, kk2)) o2[kk2] = opts[kk2];
      o2._aimIter = aimIt + 1;
      var retry = this.lunarAimPoint(c, aerr.t - this.t, periAltKm, o2);
      if (retry && !retry.failed) return retry;
    }

    // ④ 瞄准点 = 这条轨迹在 tArr 时刻真正所在的位置（自洽，供 MCC 用）
    var atArr = numericPropagateGeocentric(this, pre.r, v1, tof - half, this.t + half, 300);
    if (!atArr || !atArr.r) return { failed: 'propagate-cut' };
    var aimReal = atArr.r.slice();
    var dv = V.mag(V.sub(v1, pre.v));

    // ⑤ 完整结果（兼容 startFiniteManeuver 的 TLI 用法）
    var post = numericPropagateGeocentric(this, pre.r, v1, half, this.t + half);
    return {
      v1: v1.slice(), v2: V.sub(atArr.v, A.moonState(tArr).v), aim: aimReal, tArr: tArr, tof: tof,
      periAlt: aerr.peri, bMag: bMag, vInf: vInf, planeDeg: planeDeg,
      errKm: Math.sqrt(periErr * periErr + aerr.plane * aerr.plane * 1e6),
      iterations: nit, evals: evals,
      dv: dv, T: T, half: half, rImp: pre.r.slice(), vPre: pre.v.slice(),
      vImp: v1.slice(), rCut: null, vCut: null,
      dir: V.unit(V.sub(v1, pre.v)),
      orbit: orbitDesc(muE, 'EARTH', pre.r, v1, [0, 0, 0], [0, 0, 0]),
      cut: { T: T, half: half, tImp: this.t + half, rImp: pre.r, vImp: v1,
             vPre: pre.v, rCut: post ? post.r : null, vCut: post ? post.v : null },
      // 解析种子与数值解的差（修正量），供交接/验收核对
      smallCorrection: {
        seedV1: v1seed.slice(), numericV1: v1.slice(),
        dvVec: V.sub(v1, v1seed), dv: corr,
        patchedErr: patchedErr, evals: evals, iterations: nit,
        periAlt: aerr.peri, vInf: vInf, planeDeg: planeDeg
      }
    };
  };

  // ============================================ 有限推力 TLI 打靶（真实动力弧）
  //
  // 为什么需要这一步：lunarAimPoint 解出的是**理想脉冲**瞄准（在脉冲点施加 v1−v_pre），
  //   而真实 TLI 是一段 ~400 s 的有限点火。若沿用"固定惯性方向 + 速度关机"
  //   （startFiniteManeuver 的默认打法），到达近月点会从 111 km 偏到 2600 km 量级：
  //   速度关机判据是"速度大小达到目标轨道在该半径的速度"，但推力方向定死、飞船
  //   一边烧一边沿轨道前移/抬升，目标速度随半径变化 ⇒ 系统性过烧（实测 433.5 s /
  //   104 t 推进剂，真近月点 2628 km）。这是有限点火的固有偏差，不是调阈值能解决的。
  //
  // 做法：直接对**有限动力弧**打靶。
  //   三变量 = 常值惯性推力方向 u 的两个小角度偏置 (a,b) + 点火时长 T；
  //     u = unit(u0 + a·ê_r + b·ê_n)，u0 = aim.dir，ê_r/ê_n = 径向 / 轨道法向（⊥ u0）。
  //   每次试验：用与 World.stepCraft / advance 内环**完全同构**的 RK4（h ≤ 0.5、
  //     低空高速段 0.2 s、先消耗推进剂再用**燃后质量**算推力加速度、含真实阻力项）
  //     把动力弧积分 T 秒，得到关机状态 (r,v,t)，再交给 lunarAimError 全模型预测
  //     **真近月点**，取三项残差（近月点 111 km、到达面含着陆点、v∞ = 目标）。
  //   用 Levenberg–Marquardt 阻尼最小二乘迭代（这个几何下雅可比易病态，阻尼压住坏方向）。
  //
  // 硬约束（不放宽 08 的 20 m/s）：
  //   · 姿态偏置 |a|,|b| ≤ tan(10°)（正常有限点火的姿态程序变化，不是 MCC）；
  //   · 相对**初始有限种子**（u0, T0=estimateBurnSecs(c, aim.dv)）的冲量等效修正
  //     |v_cut − v_cut_seed| ≤ 20 m/s；
  //   · 成功后只用 world.finiteBurn(dirFixed + 定时 T) 实飞，**绝不直接改 c.r / c.v**。

  // 克隆模块推进剂状态：动力弧只作用于克隆，绝不污染真实飞行器
  function cloneModulesForArc(modules) {
    var out = [];
    for (var i = 0; i < modules.length; i++) {
      var m = modules[i], o = {};
      for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) o[k] = m[k];
      out.push(o);
    }
    return out;
  }

  // 与 World.stepCraft / advance 内环完全同构的有限推力动力弧（纯预测，不改真实状态）。
  // opts: { r0,v0,t0, dir(常值惯性方向), T, hMax(默认 0.5), maxSteps }
  // 返回 { r,v,t,T, dir, propUsed, dvActual, mass0, mass1, steps, exhaustedProp }
  World.prototype.finiteBurnArc = function (c, opts) {
    opts = opts || {};
    if (!c || !opts.dir) return null;
    var T = opts.T;
    if (!(T > 0) || !isFinite(T)) return null;
    var self = this;
    var u = V.unit(opts.dir);
    if (!(V.mag(u) > 0.5)) return null;
    var v00 = (opts.v0 || c.v).slice();
    var r = (opts.r0 || c.r).slice(), v = v00.slice();
    var t0 = (opts.t0 === undefined) ? this.t : opts.t0, t = t0;
    var hMax = opts.hMax || 0.5;
    // 克隆飞行器（模块推进剂独立），只用它的模块/质量/推力模型
    var arc = new Craft({ id: 'ARC', name: c.name, r: r.slice(), v: v.slice(),
      modules: cloneModulesForArc(c.modules), mode: 'hold', primary: c.primary, rcsProp: c.rcsProp });
    arc.stageIndex = c.stageIndex;
    var mass0 = arc.mass();
    var prop0 = this.propLeft(arc);
    var tEnd = t0 + T, guard = 0, maxSteps = opts.maxSteps || 200000, exhaustedProp = false;
    while (t < tEnd - 1e-9 && guard++ < maxSteps) {
      var alt = (c.primary === 'MOON')
        ? V.dist(r, A.moonState(t).r) - B.MOON.radius : earthAltitude(r);
      var h = hMax;
      // 与 chooseStep 同款夹逼：低空高速段用 0.2 s
      if (V.mag(v) > 3 && alt < 300) h = Math.min(h, 0.2);
      if (t + h > tEnd) h = tEnd - t;
      var am = arc.activeModule();
      if (!am || am.module.prop <= 1e-9) { exhaustedProp = true; break; }
      arc.r = r; arc.v = v;
      arc.ambientP = this.ambientPressure(r);
      arc.throttleCmd = 1;
      arc.ignite(h);                       // 先消耗推进剂（与 advance 内环同序）
      var massKg = arc.mass();             // 燃后质量（stepCraft 用的就是它）
      var thrust = arc.currentThrust();
      var aT = thrust > 0 ? (thrust / 1000) / massKg : 0;
      var accel = function (tt, rr, vv) {
        var a = self.gravity(tt, rr);
        a = V.add(a, self.dragAccel(tt, rr, vv, massKg, arc));
        if (aT > 0) a = V.scaleAdd(a, u, aT);
        return a;
      };
      var st = M.rk4Step(accel, t, r, v, h);
      r = st.r; v = st.v; t += h;
    }
    var mass1 = arc.mass();
    return { r: r, v: v, t: t, T: t - t0, dir: u,
             propUsed: prop0 - this.propLeft(arc), dvActual: V.mag(V.sub(v, v00)),
             mass0: mass0, mass1: mass1, steps: guard, exhaustedProp: exhaustedProp,
             propLeft: this.propLeft(arc) };
  };

  // 通用 3 变量 Levenberg–Marquardt（阻尼最小二乘），供有限推力 TLI 打靶使用。
  //   evalFn(p) => { g:[3], cost } | null    —— g 为缩放后的残差
  //   opt.inBox(p) => bool                    —— 参数盒约束
  //   opt.met(E, p) => bool                   —— 收敛判据
  //   opt.accept(Et, pt) => bool              —— 附加的接受约束（如冲量等效修正上限）
  // 返回 { p, E, it, evals } 或 null。
  function lm3(evalFn, p0, opt) {
    opt = opt || {};
    var h = opt.h || [0.002, 0.002, 0.1];
    var maxEvals = opt.maxEvals || 240, maxIters = opt.maxIters || 60;
    var evals = 0;
    var wrap = function (p) { var E = evalFn(p); evals++; return E; };
    var p = p0.slice();
    var E = wrap(p);
    if (!E) return null;
    var lam = 1e-3, it = 0;
    for (; it < maxIters; it++) {
      if (opt.met && opt.met(E, p)) break;
      if (evals >= maxEvals) break;
      var J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], ok = true, jc, ir;
      for (jc = 0; jc < 3; jc++) {
        var pp = p.slice(); pp[jc] += h[jc];
        var Ep = wrap(pp);
        if (!Ep) { ok = false; break; }
        for (ir = 0; ir < 3; ir++) J[ir][jc] = (Ep.g[ir] - E.g[ir]) / h[jc];
      }
      if (!ok) break;
      var JTJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], gg = [0, 0, 0], i2, j2, k2;
      for (i2 = 0; i2 < 3; i2++) {
        for (j2 = 0; j2 < 3; j2++) { var s = 0; for (k2 = 0; k2 < 3; k2++) s += J[k2][i2] * J[k2][j2]; JTJ[i2][j2] = s; }
        var gs = 0; for (k2 = 0; k2 < 3; k2++) gs += J[k2][i2] * E.g[k2]; gg[i2] = gs;
      }
      var accepted = false;
      for (var ls = 0; ls < 20 && evals < maxEvals; ls++) {
        var Ad = [[JTJ[0][0], JTJ[0][1], JTJ[0][2]],
                  [JTJ[1][0], JTJ[1][1], JTJ[1][2]],
                  [JTJ[2][0], JTJ[2][1], JTJ[2][2]]];
        for (i2 = 0; i2 < 3; i2++) Ad[i2][i2] += lam * (JTJ[i2][i2] + 1e-12);
        var dx = solve3(Ad, [-gg[0], -gg[1], -gg[2]]);
        if (!dx) { lam *= 4; continue; }
        var pt = [p[0] + dx[0], p[1] + dx[1], p[2] + dx[2]];
        if (opt.inBox && !opt.inBox(pt)) { lam *= 4; continue; }
        var pred = 0;
        for (i2 = 0; i2 < 3; i2++) {
          var jd = 0; for (j2 = 0; j2 < 3; j2++) jd += J[i2][j2] * dx[j2];
          pred += E.g[i2] * E.g[i2] - (E.g[i2] + jd) * (E.g[i2] + jd);
        }
        var Et = wrap(pt);
        if (!Et) { lam *= 4; continue; }
        if (opt.accept && !opt.accept(Et, pt)) { lam *= 4; continue; }
        var actual = E.cost - Et.cost;
        var rho = (pred > 1e-30) ? actual / pred : -1;
        if (actual > 0) {
          p = pt; E = Et; accepted = true;
          var r2 = 2 * rho - 1;
          lam *= Math.max(1 / 3, 1 - r2 * r2 * r2);
          lam = Math.max(lam, 1e-12);
          break;
        }
        lam *= 4;
      }
      if (!accepted) break;
    }
    return { p: p, E: E, it: it, evals: evals };
  }

  // 有限推力 TLI 打靶 + 实飞（见上方长注释）。
  //
  // 两阶段打靶（这是"有限点火固有偏差"能被真正消掉的关键）：
  //   阶段A（稳种子）：把**动力弧到达近月点时刻的位置**拉到理想脉冲的近月点位置。
  //       位置对 Δv 近似线性（~1 700 km per m/s），条件数好，LM 稳收敛；
  //       这一步吸收掉有限点火的全部"固有偏差"（重力损耗 + 姿态程序），
  //       得到一条到达几何已接近目标、但三项还差一点的动力弧（≈aim 的到达）。
  //   阶段B（微调）：在阶段A 结果附近，用全模型到达三项 (近月点/面/v∞) 做小修正，
  //       相对阶段A 的冲量等效修正 ≤ 20 m/s（与 08 的解析修正同量级，不放宽）。
  //
  // 返回报告：{ ok, u, a, b, T, periAlt, planeDeg, vInf, corrEq, seedA, aim }
  // 或 { failed: reason, ... }。失败一律如实返回，绝不"偷偷加宽门"。
  World.prototype.startLunarTransfer = function (c, aim, opts) {
    opts = opts || {};
    if (!c || !aim || aim.failed) return { failed: 'aim' };
    if (c.burn && c.burn.active) return { failed: 'burning' };
    var self = this;
    var t0 = this.t;
    var r0 = c.r.slice(), v0 = c.v.slice();
    var tArr = aim.tArr;
    if (!isFinite(tArr) || !(tArr > t0 + 1800)) return { failed: 'tArr' };
    var lat = (opts.siteLat === undefined) ? APL.LANDING_SITE.lat : opts.siteLat;
    var lon = (opts.siteLon === undefined) ? APL.LANDING_SITE.lon : opts.siteLon;
    var tgtPeri = (opts.periAltKm === undefined) ? 111 : opts.periAltKm;
    var tgtVInf = (opts.targetVInf === undefined) ? (aim.vInf || 1.09) : opts.targetVInf;
    if (!(tgtVInf > 0.5 && tgtVInf < 1.6)) return { failed: 'target-vinf', targetVInf: tgtVInf };   // 只做数值合理性检查（HANDOFF/12）
    // 与 lunarAimPoint 同理：真实近月点可能比 tArr 早几小时，tEnd 要留够
    var tEnd = tArr + 12 * 3600;
    // 固定目标面方向（仅用于解析种子/参考弧的构造；到达面残差用真实近月点时刻的
    // 站点方向 —— 与演示到达验收同一个定义，见下方 arrEval）
    var msArr = A.moonState(tArr);
    var siteDir = V.unit(V.sub(A.moonSurfacePoint(tArr, lat, lon, 0).r, msArr.r));

    // 初始方向/时长：u0 = aim.dir（脉冲解方向），Tbase = estimateBurnSecs(c, aim.dv)
    var u0 = V.unit(aim.dir || V.sub(aim.cut.vImp, aim.cut.vPre));
    var dvSeed = (aim.dv !== undefined) ? aim.dv : V.mag(V.sub(aim.v1, aim.cut.vPre));
    var Tbase = estimateBurnSecs(c, dvSeed);
    if (!(Tbase > 0.5)) return { failed: 'T-seed', T0: Tbase };

    // 方向基底：以 u0 为轴，径向 / 轨道法向（各取垂直 u0 的分量）
    var rel0 = V.sub(r0, this.primaryPos('EARTH'));
    var hOrb = V.cross(rel0, V.sub(v0, this.primaryVel('EARTH')));
    var nOrb = V.mag(hOrb) > 1e-12 ? V.unit(hOrb) : [0, 0, 1];
    var rHat = V.unit(rel0);
    var eR = V.sub(rHat, V.mul(u0, V.dot(rHat, u0)));
    if (V.mag(eR) < 1e-6) {
      var tmpR = Math.abs(u0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      eR = V.cross(u0, tmpR);
    }
    eR = V.unit(eR);
    var eN = V.sub(nOrb, V.mul(u0, V.dot(nOrb, u0)));
    if (V.mag(eN) < 1e-6) eN = V.cross(u0, eR);
    eN = V.unit(eN);
    var angCap = ((opts.maxTiltDeg === undefined) ? 10 : opts.maxTiltDeg) * Math.PI / 180;
    var tanCap = Math.tan(angCap);
    var dirFrom = function (a, b) { return V.unit(V.add(V.add(u0, V.mul(eR, a)), V.mul(eN, b))); };

    var corrCap = (opts.maxCorrectionKmS === undefined) ? 0.020 : opts.maxCorrectionKmS;

    // ---- 推进剂预算先过一遍：不够就明确报"推进剂不足"，不要落到含糊的 no-converge ----
    // 为什么必须显式检查：打靶的阶段A 用 Tbase = estimateBurnSecs(c, dvSeed) 播种，而
    //   estimateBurnSecs 会按**可用推进剂**把 T 压短；于是 T 落在盒子里、动力弧也"跑得完"，
    //   只是 Δv 远远不够 ⇒ 到达三项全偏 ⇒ 最后报 no-converge，完全看不出真实原因。
    //   实测 M5：真实上升段飞完后 S-IVB 只剩 12910 kg，而这条 TLI 需要约 45000 kg；
    //   症状是"打靶收敛到近月点 378006 km"（根本到不了月球），完全误导。
    //   ⚠ 必须只看**当前发动机模块**的推进剂：LM/SM 的油 S-IVB 用不了，
    //     用 this.propLeft(c)（全模块合计 48110 kg）会算出 3878 m/s 的假上限而漏报。
    var amBurn = c.activeModule();
    var propAvail = (amBurn && amBurn.module) ? amBurn.module.prop : 0;
    var massNow = c.mass();
    var veNow = c.exhaustVelocity();
    var dvMax = (propAvail > 1 && veNow > 0)
      ? veNow * Math.log(massNow / Math.max(1, massNow - propAvail)) : 0;
    if (!(dvMax > dvSeed * 0.98)) {
      return { failed: 'propellant', dvNeed: dvSeed, dvMax: dvMax,
               propAvail: propAvail, mass0: massNow,
               engine: (amBurn && amBurn.module) ? amBurn.module.id : null };
    }

    var tLo = Tbase * 0.95, tHi = Tbase * 1.10;
    var inBox = function (p) {
      return Math.abs(p[0]) <= tanCap && Math.abs(p[1]) <= tanCap && p[2] >= tLo && p[2] <= tHi;
    };

    // ---- 参考：理想脉冲的近月点位置（阶段A 的目标）----
    var pre0 = numericPropagateGeocentric(this, r0, v0, aim.half, t0);
    if (!pre0 || !pre0.r) return { failed: 'propagate' };
    var impRef = lunarAimError(this, pre0.r, aim.v1, t0 + aim.half, tEnd, tgtPeri, lat, lon);
    if (!impRef || !impRef.r) return { failed: 'impulse-ref' };
    var tPeriRef = impRef.t, rPeriRef = impRef.r;

    var evals = 0, evalsA = 0, evalsB = 0;
    var arcOf = function (a, b, T) {
      var arc = self.finiteBurnArc(c, { r0: r0, v0: v0, t0: t0, dir: dirFrom(a, b), T: T });
      if (!arc || arc.exhaustedProp) return null;
      return arc;
    };
    // 阶段A 残差：到达位置（tPeriRef 时刻）与理想脉冲近月点位置之差（缩放 1/1000 km）。
    //   阶段A 只是种子，用**粗固定步长**（fixedH=120 s）积分：动力弧关机时在 350 km
    //   高度、v≈10.4 km/s（近逃逸、弹道近乎直线），120 s 一步的 RK4 截断 <0.1 km，
    //   远小于阶段A 的 60 km 容差；近月点附近 120 s≈9° 弧，误差 ~0.2 km，同样可忽略。
    //   这样阶段A 的 98 h 滑行步数减半（~2900 vs ~5900），是整个求解里最大的一块开销。
    //   阶段B（决定最终三项）仍用与仿真完全同款的 stepForAlt，绝不放水。
    var aH = opts.aH || 120;
    var posEval = function (p) {
      evals++; evalsA++;
      var arc = arcOf(p[0], p[1], p[2]);
      if (!arc) return null;
      var st = integrateSim(self, arc.r, arc.v, arc.t, tPeriRef, { fixedH: aH });
      if (!st || !st.r) return null;
      var d = V.sub(st.r, rPeriRef);
      var g = [d[0] / 1000, d[1] / 1000, d[2] / 1000];
      return { g: g, cost: g[0] * g[0] + g[1] * g[1] + g[2] * g[2], d: d, arc: arc };
    };
    // 阶段B 残差：到达三项（近月点 111 / 面 / v∞）
    var SC = [1 / 50, 1 / 0.001745, 1 / 0.01];
    var arrEval = function (p) {
      evals++; evalsB++;
      var arc = arcOf(p[0], p[1], p[2]);
      if (!arc) return null;
      var aerr = lunarAimError(self, arc.r, arc.v, arc.t, tEnd, tgtPeri, lat, lon);
      if (!aerr) return null;
      var f = [aerr.peri - tgtPeri, aerr.plane, aerr.vInf - tgtVInf];
      var g = [f[0] * SC[0], f[1] * SC[1], f[2] * SC[2]];
      return { g: g, cost: g[0] * g[0] + g[1] * g[1] + g[2] * g[2], f: f, aerr: aerr, arc: arc };
    };
    // 阶段A 的**唯一**职责是把动力弧"拽到月球附近"给阶段B 当种子：到达位置对 Δv
    //   在近月点附近是剧烈振荡的（实测 |d| 随 T 从 2.9e5→1e4→2.4e5 km 摆动），
    //   Newton 会过冲震荡、LM 也压不到亚公里级。但阶段B 只要求种子在**切点速度**上
    //   差 ≤ 20 m/s（≈ 到达位置 7 000 km！），所以阶段A 根本不需要亚公里精度 ——
    //   只要把残差从 1e5 km 量级拉到 ~20 km 量级就够（这一步的冲量等效 < 0.1 m/s）。
    //   原来 metA 卡 d<2 km 且 maxEvals=100，4 次尝试全部跑满 100 次 ⇒ 392 evals（占全解 90%）。
    var metA = function (E) { return !!E && V.mag(E.d) < 60; };
    // HANDOFF/13：验收看 LOI-1（889±50 m/s）+ 几何；到达面闸门放宽到 0.6°（外层 1.2°）
    var metB = function (E) {
      if (!E || !E.aerr.passed || E.aerr.exhausted) return false;
      if (!(Math.abs(E.aerr.peri - tgtPeri) < 5 && E.aerr.planeDeg < 0.6)) return false;
      var l1 = loi1DeltaV(E.aerr.vInf, E.aerr.peri);
      return (l1 >= LOI1_TGT - LOI1_TOL && l1 <= LOI1_TGT + LOI1_TOL);
    };

    // ---- 阶段A：扫种子 + LM ----
    var seedList = [];
    var nSeed = (opts.aSeeds === undefined) ? 9 : opts.aSeeds;
    for (var k = 0; k <= nSeed; k++) seedList.push([0, 0, Tbase + (tHi - Tbase) * k / nSeed]);
    // 先按位置残差排序种子（每个种子 1 次 eval），从最好的开始试 LM
    var ranked = [];
    for (var si = 0; si < seedList.length; si++) {
      var E0 = posEval(seedList[si]);
      ranked.push({ seed: seedList[si], res: E0 ? V.mag(E0.d) : 1e30 });
    }
    ranked.sort(function (x, y) { return x.res - y.res; });
    // ⚠ 阶段A 必须多试几个种子：实测（tools/diag_tli_budget.js，M2 / tof=100 h）
    //   tries=1 → 位置残差只到 214 km（metA 要 <60 km），阶段B 继承这个坏种子后
    //   停在 periErr = +21.33 km（刚好越过 20 km 验收线）⇒ 整条 TLI 打靶失败；
    //   tries=3 → 残差 57 km，阶段B 顺利收敛到 peri 115.5 km / 面 0.0028°。
    //   原因是阶段A 的残差对 (a,b,T) 高度振荡，单个种子很容易卡在局部极小。
    var resA = null, tries = Math.min(opts.aTries === undefined ? 3 : opts.aTries, ranked.length);
    for (var ti = 0; ti < tries; ti++) {
      var rA = lm3(posEval, ranked[ti].seed, {
        h: [0.002, 0.002, 0.1], inBox: inBox, met: metA,
        maxEvals: opts.aMaxEvals === undefined ? 150 : opts.aMaxEvals,
        maxIters: opts.aMaxIters === undefined ? 60 : opts.aMaxIters
      });
      if (rA && rA.E && (!resA || V.mag(rA.E.d) < V.mag(resA.E.d))) resA = rA;
      if (resA && V.mag(resA.E.d) < 60) break;
    }
    if (!resA) return { failed: 'stageA', evals: evals };
    var pA = resA.p.slice();
    var seedACutV = resA.E.arc.v.slice();

    // ---- 阶段B：到达三项小修正（冲量等效 ≤ 20 m/s，相对阶段A 种子）----
    var accB = function (Et) { return V.mag(V.sub(Et.arc.v, seedACutV)) <= corrCap + 1e-9; };
    var resB = lm3(arrEval, pA, {
      h: [0.0008, 0.0008, 0.02], inBox: inBox, met: metB, accept: accB,
      maxEvals: opts.bMaxEvals === undefined ? 400 : opts.bMaxEvals,
      maxIters: opts.bMaxIters === undefined ? 150 : opts.bMaxIters
    });
    var cur = (resB && resB.E) ? resB.E : resA.E;
    var curP = (resB && resB.E) ? resB.p : pA;

    var aerr = cur.aerr;
    var periErr = aerr.peri - tgtPeri;
    var planeDeg = aerr.planeDeg, vInf = aerr.vInf;
    var corrEq = V.mag(V.sub(cur.arc.v, seedACutV));               // 阶段B 修正（对阶段A 种子）
    var corrImp = aim.cut && aim.cut.vCut ? V.mag(V.sub(cur.arc.v, aim.cut.vCut)) : NaN;
    var base = { u: cur.arc.dir, a: curP[0], b: curP[1], T: curP[2],
                 periAlt: aerr.peri, planeDeg: planeDeg, vInf: vInf,
                 corrEq: corrEq, corrImp: corrImp, evals: evals, evalsA: evalsA, evalsB: evalsB,
                 stageA: { a: pA[0], b: pA[1], T: pA[2], d: V.mag(resA.E.d),
                           periAlt: resA.E.aerr ? resA.E.aerr.peri : null },
                 seedT: Tbase, arc: cur.arc, aim: aim };
    var loi1End = loi1DeltaV(vInf, aerr.peri);
    var vinfBad = (loi1End < LOI1_TGT - LOI1_TOL || loi1End > LOI1_TGT + LOI1_TOL);
    var planeBad = (planeDeg > 1.2);   // HANDOFF/13
    if (!aerr.passed || aerr.exhausted || Math.abs(periErr) > 20 || corrEq > corrCap + 1e-9 || vinfBad || planeBad) {
      base.failed = 'no-converge';
      base.periErr = periErr;
      return base;
    }

    // ---- 成功：用真实有限点火引擎实飞（开环常值方向 + 定时 T）----
    var ve = c.exhaustVelocity();
    var rocketDV = ve * Math.log(cur.arc.mass0 / Math.max(1, cur.arc.mass1));
    var bres = this.finiteBurn(c, { label: opts.label || 'TLI', dirFixed: cur.arc.dir, T: curP[2],
      dvIdeal: rocketDV, maxT: curP[2] + 10 });
    if (!bres) { base.failed = 'ignite'; return base; }
    base.ok = true;
    base.dvIdeal = rocketDV;
    return base;
  };

  // 把一次**已经启动**的有限点火驱动到关机（用引擎自身的自然步长，warp=1）。
  //
  // 为什么必须用这个而不是 `while (burn) advance(0.5)`：advance(dtWall) 会把每个
  //   dtWall 块内部再切成 chooseStep() 的子步，块边界上 h 被夹到 remain，于是步长
  //   序列变成 0.2/0.2/0.1…，与 finiteBurnArc 的均匀步长不同 ⇒ RK4 截断误差不同
  //   ⇒ 关机速度差 ~3.5 m/s ⇒ 近月点差 38 km（实测 advance(0.5) → 68.2 km，
  //   本函数 → 106.7 km == 打靶预测）。打靶用的是 finiteBurnArc 的均匀步长，
  //   所以实飞必须用同一套步长序列才能严格同构。
  //   等价于主代理在 11-demo 里用精确窗口推进；这里封装成一个调用点。
  // 返回 burn 对象（已 active=false）；若中途推进剂耗尽/超时也如实返回。
  World.prototype.advanceBurnToEnd = function (c, opts) {
    opts = opts || {};
    if (!c) return null;
    var maxSteps = opts.maxSteps || 200000, guard = 0;
    // ⚠ 必须临时把 warp 压到 1：advance(h) 内部按 dtWall*warp 推进，warp>1 时
    //   一次调用会推进 h*warp 秒，步长序列就不是"引擎自然步长"了，与 finiteBurnArc
    //   的打靶步长不同源 ⇒ 关机状态偏离预测（这正是 M2 实测 115 km 预测 vs 1 km 实飞）。
    var warp0 = this.warp;
    this.warp = 1;
    while (c.burn && c.burn.active && guard++ < maxSteps) {
      var h = this.chooseStep();
      this.advance(h);
    }
    this.warp = warp0;
    if (c.burn) c.burn.steps = guard;
    return c.burn || null;
  };

  // ---------------------------------------------- 中途修正：直接瞄**真实近月点**
  //
  // 为什么不用「到达位置」做目标（世界系 3 分量牛顿）：
  //   到达位置对 delta-v 的雅可比在这个几何下几乎奇异 —— 实测三行几乎共线
  //      [ 453027  -1498499  -1032286 ]
  //      [-143700    669309    451394 ]
  //      [ -79265    379990    277035 ]
  //   于是牛顿步的方向几乎全是噪声：每 20 m/s 只把到达残差降 3 000 km，
  //   120 m/s 才降一半，而且把真实近月点从 5 362 km 打到 -729 km（撞月）。
  // 为什么直接瞄近月点可行：**真实近月点**（用与仿真同一套引力积分的
  //   closestApproach）对「顺行切向 delta-v」是一条陡但光滑的曲线
  //   （实测 0 m/s -> 1 923 km、+2 -> 666、+5 -> -492、+10 -> 21、+20 -> 5 095），
  //   割线法几次就能压到目标高度上。而这正是 LOI 真正在乎的量 ——
  //   近月点每高 1 000 km，LOI 就要多烧 ~150 m/s，直接决定服务舱还有没有
  //   油做 TEI。
  World.prototype.lunarPeriTrim = function (c, opts) {
    opts = opts || {};
    var self = this;
    var tgt = opts.periAltKm || 250;
    var band = opts.tolKm || 30;
    var maxDv = opts.maxDv || 0.060;      // 允许的最大修正量（km/s）
    var r0 = c.r.slice(), v0 = c.v.slice(), t0 = this.t;
    var tEnd = t0 + (opts.horizonH || 80) * 3600;
    var tHat = V.unit(v0);
    var f = function (d) {
      var ca = closestApproach(self, r0, V.add(v0, V.mul(tHat, d)), t0, tEnd);
      return ca ? (ca.alt - tgt) : null;
    };
    var d0 = 0, e0 = f(0);
    if (e0 === null) return null;
    if (Math.abs(e0) < band) return { dvVec: [0, 0, 0], dv: 0, periAlt0: tgt + e0, periAlt: tgt + e0 };
    // ------------------------------------------------------------------
    // ⚠ 这里必须**先粗扫再细化**，不能用割线法。
    //   近月点对顺行 Δv 的响应是一条**剧烈振荡**的曲线（同一条弹道上实测
    //   0 m/s→1 923 km、+2→666、+5→−492、+10→21、+20→5 095 km，周期大约
    //   10 m/s），割线法在这种函数上会跳到任意一个根上：实测同一个状态，
    //   这次解出 0.36 m/s（挪 33 km）、下次解出 7.4 m/s（挪 1 700 km）、
    //   再下次 221.6 m/s（只挪 215 km）—— 一次 221 m/s 的中途修正就烧掉
    //   3.3 t SPS，比整个 LOI-2 还贵。
    //   粗扫把振荡全部采到，直接挑 |f| 最小的那一支，再在它两侧二分细化。
    //   代价：一次 ~20 次 73 h 外推 ≈ 4 s，所以上层必须限制调用次数。
    var NS = opts.scanN || 20;
    var stepD = 2 * maxDv / NS;
    // ⚠ 采样步长必须**明显小于振荡周期（约 10 m/s）**。步长取 15 m/s 时
    //   整支会被跨过去，挑到一个 |f| 很小的伪根：实测一次 84.8 m/s 的
    //   "修正"预测近月点 250 km，实际把飞船打上了逃逸轨道（|r| 涨到 1.5e6 km）。
    //   上层把 maxDv 收到 0.03~0.04、NS 取 15~20，步长就是 3~4 m/s。
    var bs = null, bsE = 1e30, i2, dd, ee;
    for (i2 = 0; i2 <= NS; i2++) {
      dd = -maxDv + stepD * i2;
      ee = f(dd);
      if (ee === null) continue;
      if (Math.abs(ee) < band) {
        return { dvVec: V.mul(tHat, dd), dv: Math.abs(dd), periAlt0: tgt + e0,
                 periAlt: tgt + ee, scanned: true };
      }
      if (Math.abs(ee) < bsE) { bsE = Math.abs(ee); bs = { d: dd, e: ee }; }
    }
    if (!bs) return { failed: 'no-solution', periAlt0: tgt + e0 };
    // 局部二分：在 bs 两侧 ±stepD 内细化到 band/4
    var loD = bs.d - stepD, hiD = bs.d + stepD;
    var loE = f(loD), hiE = f(hiD);
    if (loE !== null && hiE !== null && loE * hiE < 0) {
      for (var bi = 0; bi < 12; bi++) {
        var midD = 0.5 * (loD + hiD), midE = f(midD);
        if (midE === null) break;
        if (Math.abs(midE) < band * 0.25) { bs = { d: midD, e: midE }; break; }
        if (loE * midE < 0) { hiD = midD; hiE = midE; } else { loD = midD; loE = midE; }
        if (Math.abs(midE) < Math.abs(bs.e)) bs = { d: midD, e: midE };
      }
    }
    if (Math.abs(bs.e) > 200) {
      return { failed: 'no-converge', periAlt0: tgt + e0, periAlt: tgt + bs.e };
    }
    return { dvVec: V.mul(tHat, bs.d), dv: Math.abs(bs.d), periAlt0: tgt + e0,
             periAlt: tgt + bs.e, scanned: true };
  };

  // ------------------------------------------- 地月转移中途修正（MCC）瞄准
  // 目标：用一个尽量小的 Δv，让飞船在 tArr 时刻**精确落在 B 面瞄准点上**
  //（也就是 TLI 时通过 lunarAimPoint 解出来的那个 aim 点）。
  //
  // 为什么不去直接瞄"近月点高度"：近月点对转移段 Δv 是**高度非线性**的 ——
  // 实测在 T+2 800 s 处，顺行 +10 m/s 能把近月点从 4 705 km 打到 −1 086 km，
  // +50 m/s 又打到 +11 282 km（周期只有几 m/s）。任何 Newton/梯度法在这种
  // 函数上都会发散（实测 MCC 反而把近月点从 4 705 km "修"到 8 894 km）。
  // B 面瞄准点则是 Δv 的**光滑线性函数**（经典结论：横向 1 m/s ≈ 到达位置
  // 1 700 km），所以这里改用"到达时刻位置误差"当目标，3 分量 Newton 求解。
  //
  // 也不用旧代码里的"地心二体兰伯特"：月球引力影响球里月球引力与地球同量级，
  // 二体解给出的 Δv 差几百 m/s，制导会反复"修正"、越修越偏 —— 实测把 18.4 t
  // 的 SPS 烧到只剩 154 kg。
  World.prototype.lunarApproachTarget = function (c, opts) {
    opts = opts || {};
    var self = this;
    var tArr = opts.tArr;
    var A = opts.aimPoint;
    var r0 = c.r.slice(), v0 = c.v.slice(), t0 = this.t;
    if (!A) return { failed: 'no-aimpoint' };
    var tof = tArr - t0;
    if (!(tof > 1800)) return { failed: 'tof', tof: tof };
    var nSteps = opts.steps || 900;
    var evalDv = function (dvx, dvy, dvz) {
      var vv = [v0[0] + dvx, v0[1] + dvy, v0[2] + dvz];
      var st = numericPropagateGeocentric(self, r0, vv, tof, t0, nSteps);
      return V.sub(st.r, A);                     // 3 维位置误差（km）
    };
    var dv = [0, 0, 0], best = null, J = null;
    // 基线误差（完全不修正时的到达位置偏差）—— 验证解的好坏要跟它比
    var E0 = evalDv(0, 0, 0);
    var baseErr = E0 ? V.mag(E0) : 1e9;
    // ⚠ 每次迭代都要 1 次"主线"+3 次"雅可比"积分 = 4 次 73 h 外推（现在步长与仿真
    // 一致，一次 ~0.2 s）。所以雅可比每两轮才重算一次：到达位置对 Δv 基本是线性的
    //（实测 ~1 700 km/m/s），隔轮复用完全够，算下来一次 MCC 求解 ~2 s。
    for (var it = 0; it < 7; it++) {
      var E = evalDv(dv[0], dv[1], dv[2]);
      if (!E) break;
      var err = V.mag(E);
      if (!best || err < best.err) best = { err: err, dv: dv.slice() };
      if (err < 40) break;                       // 到达位置 40 km 以内就够了
      if (it % 2 === 0 || !J) {
        // ⚠ 雅可比步长要小（0.5 m/s）：地月转移在 72 h 尺度上被放大成 ~1 700 km/m/s，
        // 用 20 m/s 的步长算出来的"导数"完全是噪声。
        var h = 0.0005;
        var EX = evalDv(dv[0] + h, dv[1], dv[2]);
        var EY = evalDv(dv[0], dv[1] + h, dv[2]);
        var EZ = evalDv(dv[0], dv[1], dv[2] + h);
        if (!EX || !EY || !EZ) break;
        J = [[(EX[0] - E[0]) / h, (EY[0] - E[0]) / h, (EZ[0] - E[0]) / h],
             [(EX[1] - E[1]) / h, (EY[1] - E[1]) / h, (EZ[1] - E[1]) / h],
             [(EX[2] - E[2]) / h, (EY[2] - E[2]) / h, (EZ[2] - E[2]) / h]];
      }
      var b = [-E[0], -E[1], -E[2]];
      // 克莱姆法则解 J·s = b
      // ⚠ 用**阻尼最小二乘**（Tikhonov）解 J·s = b，而不是克莱姆法则。
      // 这个几何下雅可比几乎是奇异的：实测三个方向的行向量几乎共线
      //      [ 453027  -1498499  -1032286 ]
      //      [-143700    669309    451394 ]
      //      [ -79265    379990    277035 ]
      // 克莱姆法在这种矩阵上给出的步长方向几乎全是噪声 —— 实测 120 m/s 的
      // "修正"只把到达残差从 27 000 km 收到 12 000 km，还把近月点打到 −729 km。
      // 阻尼最小二乘会沿"最有效的那一个方向"走，多余自由度自动被压住。
      // 解 (JᵀJ + λI)·s = Jᵀ·b，λ 取 JᵀJ 迹的 1e-4。
      var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0], i2, j2, k2;
      for (i2 = 0; i2 < 3; i2++) {
        for (j2 = 0; j2 < 3; j2++) {
          var sum = 0;
          for (k2 = 0; k2 < 3; k2++) sum += J[k2][i2] * J[k2][j2];
          A[i2][j2] = sum;
        }
        var gs = 0;
        for (k2 = 0; k2 < 3; k2++) gs += J[k2][i2] * b[k2];
        g[i2] = gs;
      }
      var lam = 1e-4 * (A[0][0] + A[1][1] + A[2][2] + 1e-12);
      for (i2 = 0; i2 < 3; i2++) A[i2][i2] += lam;
      var det2 = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
               - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
               + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
      if (!isFinite(det2) || Math.abs(det2) < 1e-30) break;
      var s0 = (g[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
              - A[0][1] * (g[1] * A[2][2] - A[1][2] * g[2])
              + A[0][2] * (g[1] * A[2][1] - A[1][1] * g[2])) / det2;
      var s1 = (A[0][0] * (g[1] * A[2][2] - A[1][2] * g[2])
              - g[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
              + A[0][2] * (A[1][0] * g[2] - g[1] * A[2][0])) / det2;
      var s2 = (A[0][0] * (A[1][1] * g[2] - g[1] * A[2][1])
              - A[0][1] * (A[1][0] * g[2] - g[1] * A[2][0])
              + g[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])) / det2;
      var step = [s0, s1, s2];
      var sm = V.mag(step);
      if (!isFinite(sm) || !(sm > 0)) break;
      // ⚠ 中途修正的合理量级就是几 m/s（有限点火的关机残差 ≈ 1~3 m/s，
      // 在 72 h 的地月转移上放大成 2 000~5 000 km 的到达偏差）。
      // 这个几何下雅可比很容易病态：一旦解出几十上百 m/s，那不是"修正"，
      // 是把飞船彻底打歪 —— 实测一次 149.8 m/s 的 MCC 把到达残差从 2 082 km
      // 放大到 50 877 km，LOI 只能在 44 960 km 高度硬捕获，整条链断掉。
      // 所以每次迭代最多 5 m/s，总量不超过 30 m/s；解不出来就老实放弃。
      // 每次迭代最多 20 m/s：雅可比是 10^6 km per km/s 量级，实测 TLI 的
      // 有限点火残差在到达位置上是 **2.7 万公里**（≈ 27 m/s），5 m/s 的
      // 单步上限根本够不着。
      var cap = 0.020;
      if (sm > cap) step = V.mul(step, cap / sm);
      dv = V.add(dv, step);
      if (V.mag(dv) > 0.120) break;              // 总修正不超过 120 m/s
    }
    if (!best) return null;
    // ⚠ 解出来之后**必须验证**：把这个 Δv 代回去重算一次到达残差，只有确实变小
    // 才准点火。这个几何下雅可比经常病态（实测一组解把到达残差从 15 478 km
    // 打到 62 408 km —— 越修越偏），病态解比"不修正"危害大得多：
    // LOI 自己能在近月点兜底，被 MCC 打歪的轨道谁都救不回来。
    var E2 = evalDv(best.dv[0], best.dv[1], best.dv[2]);
    // ⚠ 比的对象必须是**不修正的基线**（dv=0），不能是 best.err ——
    // best 就是这次求解自己的结果，拿它比等于"自己和自己比"，
    // 判定永远不成立 → MCC **永远返回 null**。实测这就是"TLI 实飞偏 27 000 km、
    // MCC 一声不响地放弃、LOI 只能在 5 400 km 高度硬捕获（烧掉 14 t SPS）、
    // TEI 没钱点火"的根因。
    if (!E2 || !(V.mag(E2) < baseErr * 0.9)) {
      return { failed: 'no-improve', baseErr: baseErr, errKm: E2 ? V.mag(E2) : null,
               dv: best ? V.mag(best.dv) : 0 };
    }
    // 顺带用真实积分给出修完之后的近月点（日志/判定用）
    var peri = null;
    try {
      var ca = closestApproach(self, r0, V.add(v0, best.dv), t0, tArr + 6 * 3600);
      if (ca) peri = ca.alt;
    } catch (e) {}
    return { dvVec: best.dv, dv: V.mag(best.dv), errKm: best.err,
             periAlt: peri, tArr: tArr, tof: tof };
  };

  // ---------------------------------------------------------- 轨道预测
  // 轨道预演：从当前状态出发、只受引力（不点火）外推。
  // 用的是和仿真完全相同的引力模型（地球 μ+J2、月球 μ+J2、太阳第三体），
  // RK4 积分 —— 所以预演出来的就是"接下来真的会飞到哪"，包括月球的引力弯折。
  // 注意计算量：每步 4 次引力求值，一次 ~0.05 ms，几百步就有几十毫秒，
  // 调用方应当分帧/分块计算，不要每帧整段重算。
  World.prototype.predict = function (c, steps, dt, state) {
    var r = (state && state.r) || c.r.slice();
    var v = (state && state.v) || c.v.slice();
    var t = (state && state.t !== undefined) ? state.t : this.t;
    var pts = [];
    var self = this;
    var acc = function (tt, rr) { return self.gravity(tt, rr); };
    for (var i = 0; i < steps; i++) {
      var st = M.rk4Step(acc, t, r, v, dt);
      r = st.r; v = st.v; t += dt;
      pts.push({ t: t, r: r.slice() });
    }
    return { pts: pts, state: { r: r, v: v, t: t } };
  };



  // ============================================================== 动力下降自动制导
  // 设计要点（这个游戏里最"反直觉"的一段物理）：
  //   月球 111 km 环月轨道速度 1.63 km/s，而下降发动机最大加速度只有
  //   aMax = 45 040 N / 15 349 kg ≈ 2.93 m/s²。所以在下降刚开始时，
  //   "有效重力" f = g − vh²/r ≈ 0 —— 飞行器几乎是失重地"飘"着，
  //   下沉率是被 f 慢慢喂出来的。任何只按真空自由落体设计的制导都会
  //   在开头把飞行器拽下去、或者在中段把燃料烧光。
  // 控制律：
  //   水平：tgo = 2s/vh（匀减速），沿 −u 施加 aAlong = vh/tgo；
  //         另有一条横向通道把侧向速度按 τ 拉回 0。
  //   竖直：把下沉率拉向 vdReq = 2h/tgo，使两个轴同时归零。
  //   最后 flareAlt 以下切"悬停下降"，只保下沉率。
  function descentGuidance(world, c, opt) {
    opt = opt || {};
    var tauV = opt.tauV || 10, tauLat = opt.tauLat || 12;
    var flareAlt = opt.flareAlt || 120, flareSink = opt.flareSink || 1.2;
    var hGate = opt.hGate || 300, vBias = opt.vBias || 1.6;
    var tauSmax = opt.tauSmax || 8;
    var ms = A.moonState(world.t);
    var rel = V.sub(c.r, ms.r), rr = V.mag(rel);
    var up = V.unit(rel);
    var h = (rr - B.MOON.radius) * 1000;
    var site = A.moonSurfacePoint(world.t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
    var toSite = V.sub(site.r, c.r);
    var hv = V.sub(toSite, V.mul(up, V.dot(toSite, up)));
    var s = V.mag(hv) * 1000;
    var u = s > 1e-6 ? V.unit(hv) : [0, 0, 0];
    var latDir = V.mag(u) > 0 ? V.unit(V.cross(up, u)) : [0, 0, 0];
    var act = c.activeModule();
    var aMax = act ? act.module.thrust / c.mass() : 3;
    if (!(aMax > 0.05)) aMax = 0.05;
    var thMin = act ? (act.module.throttleMin || 0.1) : 0.1;
    var g = B.MOON.mu / (rr * rr) * 1000;
    var vrel = V.sub(c.v, ms.v);
    var vUp = V.dot(vrel, up) * 1000;
    var vhVec = V.mul(V.sub(vrel, V.mul(up, V.dot(vrel, up))), 1000);
    var vh = V.dot(vhVec, u), vlat = V.dot(vhVec, latDir), vhMag = V.mag(vhVec);
    var vd = -vUp;
    var f = g - (vhMag * vhMag) / (rr * 1000);      // 有效重力（扣离心支撑）
    if (f < 0) f = 0;

    var tgo = vhMag > 1 ? (2 * s) / vhMag : 8;
    tgo = V.clamp(tgo, 8, 4000);
    // 竖直故意比水平"慢一点"（vBias>1）：这样水平速度会在还有高度时就收干净，
    // 进入 hGate 以下的纯垂直下降段 —— 也就是真实 Apollo 的 P63/P64/P66 结构。
    var tgoV = tgo * vBias;
    var vdReq = (2 * h) / tgoV;
    var aV;
    if (h < hGate) {
      // P66 终端下降：只保下沉率
      var want = V.clamp(h / 25, 0.5, flareSink);
      aV = V.clamp(g + (vd - want) / 2.5, 0, aMax);
    } else {
      if (vdReq < flareSink * 0.3) vdReq = flareSink * 0.3;
      aV = f + (vd - vdReq) / tauV;
      aV = V.clamp(aV, 0, aMax);
    }
    // 水平：主制动 = vh/tgo（等价于自杀式制动曲线）；
    //       再叠一条「最低接近速度」约束，避免速度提前收尽、停在半路。
    var aAlong = vh / Math.max(tgo, 8);
    var vhMin = Math.min(s / tauSmax, 60);          // 末端最低接近速度（有上限，别暴走）
    if (vh < vhMin) aAlong = V.clamp((vh - vhMin) / 3.0, -1.0, 0);

    var room = Math.sqrt(Math.max(aMax * aMax - aV * aV, 0.02));
    aAlong = V.clamp(aAlong, -room, room);
    var aLat = V.clamp(-vlat / tauLat, -room, room);
    var aH = Math.sqrt(aAlong * aAlong + aLat * aLat);
    if (aH > room && aH > 1e-9) { var k = room / aH; aAlong *= k; aLat *= k; aH = room; }

    var cmd = V.add(V.add(V.mul(up, aV), V.mul(u, -aAlong)), V.mul(latDir, aLat));
    var mag = V.mag(cmd);
    c.attitude.mode = 'hold';
    if (mag < 1e-9) { c.attitude.vec = up; c.throttleCmd = 0; return null; }
    c.attitude.vec = V.unit(cmd);
    if (h < 1.0 && Math.abs(vUp) < 0.6 && vhMag < 0.6) c.throttleCmd = 0;
    else c.throttleCmd = V.clamp(mag / aMax, thMin, 1);
    return { h: h, s: s, vh: vh, vlat: vlat, vhMag: vhMag, vd: vd, vdReq: vdReq,
             tgo: tgo, f: f, g: g, aV: aV, aH: aH, aMax: aMax, mag: mag, hGate: hGate, vBias: vBias };
  }

  // ============================================================== 环月场景
  // 构造一条「轨道面精确包含着陆点」的环月圆轨道，并把飞行器放在着陆点
  // 正对面 —— 这样绕半圈后正好从着陆点上空经过（真实任务也要选这个窗口）。
  // 之前直接用月球轨道面（unit(cross(ms.r, ms.v))）做轨道面，平面里没有
  // 着陆点，导致飞行器从着陆点旁边几十公里掠过，产生几百 m/s 的横向速度，
  // 动力下降段完全追不回来。
  function orbitOverSite(world, altKm) {
    var t = world.t;
    var ms = A.moonState(t);
    var site = A.moonSurfacePoint(t, APL.LANDING_SITE.lat, APL.LANDING_SITE.lon, 0);
    var upS = V.unit(V.sub(site.r, ms.r));          // 着陆点径向
    var axis = A.moonFrame(t).z;                    // 月球自转轴
    var east = V.unit(V.cross(axis, upS));          // 着陆点处的东向
    var n = V.unit(V.cross(upS, east));             // 轨道面法向（平面含 upS）
    var rM = B.MOON.radius + altKm;
    var rad = V.mul(upS, -1);                       // 着陆点正对面
    var tang = V.unit(V.cross(n, rad));
    var pos = V.add(ms.r, V.mul(rad, rM));
    var vel = V.add(ms.v, V.mul(tang, Math.sqrt(B.MOON.mu / rM)));
    return { r: pos, v: vel, normal: n, upSite: upS, radiusKm: rM };
  }

    // 判定"当前状态是不是在一条能回到地球的弹道上"。
  // 做法：外推 6 天 → 必须脱离月球影响球 → 地心轨道必须是束缚的（e < 0.995）、
  // 且近地点落在再入走廊附近（地球半径 +0.9~+800 km）。
  // 用途：TEI 点火后**闭环校验** —— 解算用的是脉冲假设，而实际点火要烧 300 多秒，
  // 两者算出来的轨道不是同一条；点火后再验一次、不合格就再修一次，才能保证
  // 自动演示每次都真的回来。
  function returnIsValid(world, c) {
    var st = integrateSim(world, c.r, c.v, world.t, world.t + 6 * 86400, {});
    if (!st || !isFinite(st.r[0])) return false;
    if (V.dist(st.r, A.moonState(st.t).r) < B.MOON.soi) return false;
    var el = M.elements(B.EARTH.mu, st.r, st.v);
    if (!el || !isFinite(el.periapsis)) return false;
    if (!(el.e < 0.995)) return false;
    // 走廊判据放宽为"保证撞回地球"（用户授权：演示里回地球就行，哪怕动画）：
    // 参照系修正前的 TEI 会把飞船打成远拱 580 万 km 的倒退双曲线（用户报
    // "弹射回宇宙"）；修正后弹道陡（ peri 1 375 km，穿过地球）但确定再入。
    // 原判据要求 peri ∈ [0.9R_E, R_E+800]，会把这种确定返回的弹道判为无效，
    // 导致修正环空转 5 次后失败。真实任务的走廊是 40 km 级，留给后续收紧。
    return (el.periapsis < B.EARTH.radius + 800);
  }

APL.Physics = {
  // 自检用：把"仿真同款步长"和固定细步长的弹道结果并排比出来
  periCompare: function (world, r0, v0, t0, hours) {
    var tEnd = t0 + (hours || 80) * 3600, out = {};
    var mk = [['sim', 0], ['h20', 20], ['h5', 5], ['h1', 1]];
    for (var i = 0; i < mk.length; i++) {
      var o = { closest: true };
      if (mk[i][1]) o.fixedH = mk[i][1];
      var ca = integrateSim(world, r0, v0, t0, tEnd, o);
      out[mk[i][0]] = ca ? { alt: ca.alt, t: ca.t } : null;
    }
    return out;
  },
  integrateSim: integrateSim, returnIsValid: returnIsValid,
  // 返回走廊迭代用：6 天外推后的地心近地点（km；null = 没到/被月球抓住）
  returnPeri: function (world, c) {
    var st = integrateSim(world, c.r, c.v, world.t, world.t + 6 * 86400, {});
    if (!st || !isFinite(st.r[0])) return null;
    if (V.dist(st.r, A.moonState(st.t).r) < B.MOON.soi) return null;
    var el = M.elements(B.EARTH.mu, st.r, st.v);
    return (el && isFinite(el.periapsis)) ? el.periapsis : null;
  },
    Craft: Craft, World: World, mod: mod, buildSaturnVStack: buildSaturnVStack,
    guidanceDirection: guidanceDirection, localFrame: localFrame,
    launchGuidance: launchGuidance, pitchFromTable: pitchFromTable,
    rotateAbout: rotateAbout, apogeeOf: apogeeOf, perigeeOf: perigeeOf,
    earthRadiusAt: earthRadiusAt, earthAltitude: earthAltitude,
    landingControl: landingControl, deorbitTo: deorbitTo, PDI_RANGE_KM: PDI_RANGE_KM,
    orbitOverSite: orbitOverSite, descentGuidance: descentGuidance,
    lunarInsertionPlan: lunarInsertionPlan, lunarOrbitAlign: lunarOrbitAlign,
    lunarPlaneSetup: lunarPlaneSetup,
    lunarAscentControl: lunarAscentControl, jettisonModule: jettisonModule,
    rendezvousControl: rendezvousControl,
    transEarthInjection: transEarthInjection,
    vgoGuidance: vgoGuidance, vgoResidual: vgoResidual,
    loi1DeltaV: loi1DeltaV, loi1Window: { tgt: LOI1_TGT, tol: LOI1_TOL },
    // 瞄准/积分的诊断入口（Node 测试台与浏览器控制台都要用；
    // 之前它们只在闭包里，外部没法独立验证"瞄准模型 vs 真实积分"的差别）
    closestApproach: closestApproach,
    propagateToMoonDistance: propagateToMoonDistance,
    numericPropagateGeocentric: numericPropagateGeocentric,
    lunarAimError: lunarAimError,
    targetOrbitVelocity: targetOrbitVelocity, estimateBurnSecs: estimateBurnSecs,
    PITCH_TABLE: PITCH_TABLE
  };

})(typeof window !== 'undefined' ? window : globalThis);
