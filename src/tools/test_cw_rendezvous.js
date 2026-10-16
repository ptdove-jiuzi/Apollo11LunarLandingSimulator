// tools/test_cw_rendezvous.js
// ---------------------------------------------------------------------------
// 环月交会终端（CW 旋转参考系闭环）独立验证台。
//
//   · 只加载四个基础模块（00/01/02/03），用 P.World 的**真实引力**与有限推力模型
//   · 追踪器初始位于目标后方 30 km（仅"测试构造 Craft"允许直接设 r/v）
//   · 场景：① 111 km 圆轨道   ② 111×117 km 椭圆
//   · 断言：从 30 km 收到 ≤150 m、rv ≤1 m/s；连续保持 300 s；终端耗油 ≤150 kg
//   · 断言：100 m 内 rv < 0.2 m/s；距离包络单调下降；重复同 t 不重复脉冲；
//           目标航天器不被控制
//
// 用法：  node tools/test_cw_rendezvous.js .
// ---------------------------------------------------------------------------
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const ctx = { console, Math, isFinite, Number, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, 'apollo11', 'webdata', 'js', f), 'utf8'),
    ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY } = ctx.APL;
const RM = BODY.MOON.radius, MU = BODY.MOON.mu;
const T0 = 250000;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? '   ' + detail : ''));
}
function fmt(x, n) { return (x === undefined || x === null) ? '-' : x.toFixed(n === undefined ? 1 : n); }

// 绕 axis 旋转 ang（罗德里格斯公式）
function rotAxis(v, axis, ang) {
  const c1 = Math.cos(ang), s1 = Math.sin(ang);
  return V.add(V.add(V.mul(v, c1), V.mul(V.cross(axis, v), s1)),
               V.mul(axis, V.dot(v, axis) * (1 - c1)));
}

// 一条环月轨道（月心相对状态）：近月点在 +x、速度沿 +y、轨道面为赤道面
function orbitRel(altPeri, altApo) {
  const rp = RM + altPeri, ra = RM + altApo, a = (rp + ra) / 2;
  const r = rp;
  const v = Math.sqrt(MU * (2 / r - 1 / a));
  return { r: [r, 0, 0], v: [0, v, 0] };
}

function buildScenario(altPeri, altApo, offsetM) {
  const w = new P.World(); w.t = T0; w.running = true;   // 默认 gravityModel：真实引力
  const ms = A.moonState(T0);
  const tRel = orbitRel(altPeri, altApo);
  const hHat = V.unit(V.cross(tRel.r, tRel.v));
  const dTheta = (offsetM / 1000) / V.mag(tRel.r);       // 后方 offsetM 米对应的相位角
  const cRelR = rotAxis(tRel.r, hHat, -dTheta);
  const cRelV = rotAxis(tRel.v, hHat, -dTheta);

  const tgt = new P.Craft({
    id: 'CSM', name: 'Columbia',
    r: V.add(ms.r, tRel.r), v: V.add(ms.v, tRel.v),
    modules: P.buildSaturnVStack().filter(m => m.id === 'CM')
  });
  tgt.primary = 'MOON';
  const ch = new P.Craft({
    id: 'LM', name: 'Eagle',
    r: V.add(ms.r, cRelR), v: V.add(ms.v, cRelV),
    modules: P.buildSaturnVStack().filter(m => m.id === 'LM_A')
  });
  ch.primary = 'MOON'; ch.stageIndex = 4; ch.flags.isLM = true;
  w.addCraft(ch); w.addCraft(tgt);
  return { w, ch, tgt };
}

// 复刻 World.advance 的内层循环（确定性固定帧长），advance 之后由调用方驱动制导
function advanceWorld(w, dt) {
  let remain = dt, guard = 0;
  while (remain > 1e-9 && guard++ < 400000) {
    let h = w.chooseStep();
    if (h > remain) h = remain;
    for (let i = 0; i < w.crafts.length; i++) {
      const c = w.crafts[i];
      if (c.crashed) continue;
      c.ambientP = w.ambientPressure(c.r);
      w.updateBurn(c, h);
      c.ignite(h);
      w.stepCraft(c, h);
    }
    w.t += h; remain -= h;
  }
}

function relDist(ch, tgt) { return V.dist(ch.r, tgt.r) * 1000; }
function relVel(ch, tgt) { return V.mag(V.sub(ch.v, tgt.v)) * 1000; }

// 距离包络：每 win 秒取窗口内最大值，检查是否单调不增
function envelopeMonotonic(samples, dt, win, tolM) {
  const buckets = [];
  let t = 0, cur = -1, curMax = 0;
  for (let i = 0; i < samples.length; i++) {
    const b = Math.floor((i * dt) / win);
    if (b !== cur) { if (cur >= 0) buckets.push(curMax); cur = b; curMax = 0; }
    if (samples[i] > curMax) curMax = samples[i];
  }
  if (cur >= 0) buckets.push(curMax);
  let worst = 0;
  for (let i = 1; i < buckets.length; i++) worst = Math.max(worst, buckets[i] - buckets[i - 1]);
  return { buckets, worst, ok: worst <= tolM };
}

function runScenario(label, altPeri, altApo, dt, maxSim, opts) {
  opts = opts || {};
  const offsetM = opts.offsetM === undefined ? 30000 : opts.offsetM;
  const { w, ch, tgt } = buildScenario(altPeri, altApo, offsetM);
  const lmMod = ch.modules.filter(m => m.id === 'LM_A')[0];
  const prop0 = lmMod.prop;
  const d0 = relDist(ch, tgt), rv0 = relVel(ch, tgt);

  console.log('\n=== ' + label + '  (dt=' + dt + ' s, 目标 ' + altPeri + '×' + altApo +
    ' km, 初始后方 ' + offsetM + ' m) ===');
  console.log('  初始：后方距离 ' + fmt(d0, 0) + ' m，相对速度 ' + fmt(rv0, 2) + ' m/s，' +
    '推进剂 ' + fmt(prop0, 0) + ' kg');

  let tgtThrottleMax = 0;          // 目标被控制的证据
  let dupAccViol = 0, dupBurnViol = 0;
  let nearSince = null, doneT = null, firstNearT = null;
  let maxRvUnder100 = 0, dUnder100Seen = false;
  let termProp0 = null, termPropAtDone = null;
  const samples = [];
  let tSim = 0, lastLog = -1e9;

  while (tSim < maxSim) {
    advanceWorld(w, dt);
    tSim += dt;

    if (tgt.burn && tgt.burn.active) tgtThrottleMax = Math.max(tgtThrottleMax, 1);
    if ((tgt.throttleCmd || 0) > tgtThrottleMax) tgtThrottleMax = tgt.throttleCmd || 0;

    // 调用者 Demo.tick 在 advance 之后调用 rendezvousControl
    P.rendezvousControl(w, ch, tgt, dt);
    // 重复同 t 调用：不允许产生第二次脉冲 / 再次累加期望 Δv
    const b1 = (ch.burn && ch.burn.active) ? ch.burn : null;
    const a1 = (ch._rndzAcc || [0, 0, 0]).slice();
    P.rendezvousControl(w, ch, tgt, dt);
    const b2 = (ch.burn && ch.burn.active) ? ch.burn : null;
    const a2 = ch._rndzAcc || [0, 0, 0];
    if (b1 !== b2) dupBurnViol++;
    if (Math.abs(a1[0] - a2[0]) + Math.abs(a1[1] - a2[1]) + Math.abs(a1[2] - a2[2]) > 1e-15) dupAccViol++;

    const d = relDist(ch, tgt), rv = relVel(ch, tgt);
    samples.push(d);

    if (d < 100) { dUnder100Seen = true; if (rv > maxRvUnder100) maxRvUnder100 = rv; }

    if (ch._rndzPhase === 'terminal' && termProp0 === null) termProp0 = ch._rndzTermP0;

    // 复刻"连续满足 300 s"的计时（用于独立核对）
    if (d <= 150 && rv <= 1.0) {
      if (nearSince === null) { nearSince = tSim; if (firstNearT === null) firstNearT = tSim; }
    } else nearSince = null;

    if (tSim - lastLog >= 2500) {
      lastLog = tSim;
      const act = ch.activeModule();
      console.log('    t=' + fmt(tSim, 0) + 's  d=' + fmt(d, 1) + 'm  rv=' + fmt(rv, 2) +
        'm/s  phase=' + (ch._rndzPhase || '-') + '  prop=' + (act ? fmt(act.module.prop, 0) : '-'));
    }

    if (ch._rndzPhase === 'done') { doneT = tSim; termPropAtDone = lmMod.prop; break; }
    if (ch._rndzPhase === 'failed') { console.log('  >> 失败：' + ch._rndzFailReason); break; }
  }

  const dEnd = relDist(ch, tgt), rvEnd = relVel(ch, tgt);
  const propUsed = prop0 - lmMod.prop;
  const termUsed = (termProp0 !== null) ? (termProp0 - lmMod.prop) : propUsed;
  const holdS = (doneT !== null && nearSince !== null) ? (tSim - nearSince) : 0;

  console.log('  结束：phase=' + (ch._rndzPhase || '-') +
    '  d=' + fmt(dEnd, 1) + 'm  rv=' + fmt(rvEnd, 3) + 'm/s' +
    '  总耗油=' + fmt(propUsed, 1) + 'kg  终端耗油=' + fmt(termUsed, 1) + 'kg' +
    '  用时=' + fmt(tSim, 0) + 's');

  check(label + '：进入完成状态', ch._rndzPhase === 'done',
    '(phase=' + (ch._rndzPhase || '-') + ')');
  check(label + '：收到 ≤150 m 且 rv ≤1 m/s', dEnd <= 150 && rvEnd <= 1.0,
    '(d=' + fmt(dEnd, 1) + 'm rv=' + fmt(rvEnd, 3) + 'm/s)');
  check(label + '：连续保持 ≥300 s', holdS >= 300, '(hold=' + fmt(holdS, 0) + 's)');
  check(label + '：终端推进剂 ≤150 kg', termUsed <= 150, '(' + fmt(termUsed, 1) + ' kg)');
  const ok100 = opts.require100 ? (dUnder100Seen && maxRvUnder100 < 0.2)
                                : (!dUnder100Seen || maxRvUnder100 < 0.2);
  check(label + '：100 m 内 rv < 0.2 m/s', ok100,
    '(进入 100 m=' + dUnder100Seen + '  100m 内 maxRv=' + fmt(maxRvUnder100, 3) + 'm/s)');
  check(label + '：重复同 t 不重复脉冲', dupBurnViol === 0 && dupAccViol === 0,
    '(burn 违规=' + dupBurnViol + ' 累加违规=' + dupAccViol + ')');
  check(label + '：目标航天器不被控制', tgtThrottleMax === 0,
    '(目标最大油门指令=' + fmt(tgtThrottleMax, 3) + ')');

  // 目标轨道是否保持（不被推走）：外推前后应仍在 111×117（圆则 111）附近
  const elT = M.elements(MU, V.sub(tgt.r, A.moonState(w.t).r), V.sub(tgt.v, A.moonState(w.t).v));
  const apoAlt = (elT.apoapsis - RM), periAlt = (elT.periapsis - RM);
  check(label + '：目标轨道保持', Math.abs(periAlt - altPeri) < 3 && Math.abs(apoAlt - altApo) < 3,
    '(近' + fmt(periAlt, 1) + ' 远' + fmt(apoAlt, 1) + ' km)');

  const env = envelopeMonotonic(samples, dt, 2000, opts.envTol === undefined ? 40 : opts.envTol);
  const envStr = env.buckets.map(x => Math.round(x)).join(' → ');
  console.log('  距离包络（每 2 000 s 窗口最大值，m）：' + envStr);
  check(label + '：距离包络单调下降', env.ok,
    '(最大回升 ' + fmt(env.worst, 1) + ' m)');

  return { w, ch, tgt, ok: ch._rndzPhase === 'done' };
}

// 定时短脉冲精度：直接验证 chooseStep / updateBurn 的末步修复 ——
// 短于一个积分步的脉冲不能丢、落在 T 上的末步不能漏、也不能超烧。
function testPulsePrecision() {
  console.log('\n=== 定时短脉冲精度（chooseStep/updateBurn 末步修复） ===');
  const cases = [
    { dv: 0.00002, dt: 5 },   // 0.02 m/s（远短于 0.5 s 积分步）
    { dv: 0.0001, dt: 5 },    // 0.10 m/s
    { dv: 0.001, dt: 5 },     // 1 m/s
    { dv: 0.05, dt: 5 },      // 50 m/s
    { dv: 0.001, dt: 1 },     // 换控制周期
    { dv: 0.001, dt: 10 },
    { dv: 0.05, dt: 1 }       // 脉冲（18 s）长于一个帧，跨多帧执行
  ];
  for (const cs of cases) {
    const w = new P.World(); w.t = T0; w.running = true;
    const ms = A.moonState(T0);
    const o = orbitRel(111, 111);
    const c = new P.Craft({
      id: 'P', r: V.add(ms.r, o.r), v: V.add(ms.v, o.v),
      modules: P.buildSaturnVStack().filter(m => m.id === 'LM_A')
    });
    c.primary = 'MOON'; c.stageIndex = 4; w.addCraft(c);
    const aMax = c.activeModule().module.thrust / c.mass() / 1000;
    const T = cs.dv / aMax;
    const bb = w.finiteBurn(c, { label: 'T', dirFixed: [0, 1, 0],
      dvIdeal: cs.dv, T: T, maxT: T + 2, throttle: 1 });
    let guard = 0;
    while (c.burn && c.burn.active && guard++ < 100000) advanceWorld(w, cs.dt);
    const eng = (bb && bb.dvEngine !== undefined) ? bb.dvEngine * 1000 : 0;  // m/s（发动机积分）
    const cmd = cs.dv * 1000;
    const err = Math.abs(eng - cmd) / cmd;
    check('脉冲 ' + cmd + ' m/s（dt=' + cs.dt + 's, T=' + T.toFixed(4) + 's）',
      c.burn && !c.burn.active && err < 0.03,
      '(实测 ' + eng.toFixed(4) + ' m/s, 相对误差 ' + (err * 100).toFixed(2) + '%)');
  }
}

console.log('CW 交会终端验证台 —— 受管 Node，真实引力 + 有限推力，无演示兜底');

// 主场景：圆轨道 + 椭圆，标准控制周期
runScenario('圆轨道', 111, 111, 5, 150000);
runScenario('111×117 椭圆', 111, 117, 5, 150000);

// 近距离保持：从 100 m 后方进入，验证"100 m 内 rv < 0.2 m/s"
runScenario('近距离保持(100m)', 111, 111, 5, 150000, { offsetM: 100, require100: true });

// 分项步长验证：同一圆轨道换控制周期，确认稳健性
runScenario('圆轨道(细步长)', 111, 111, 2, 150000);
runScenario('圆轨道(粗步长)', 111, 111, 10, 150000);

// 定时短脉冲精度（直接验证末步修复）
testPulsePrecision();

console.log('\n===== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
