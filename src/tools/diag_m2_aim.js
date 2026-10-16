// tools/diag_m2_aim.js
// ---------------------------------------------------------------------------
// 诊断：M2 真实点火时刻的 lunarAimPoint 为什么 no-converge。
//
// 复现 11-demo.solveTLI 选中的候选（tof=100 h、wait≈21378 s）：
//   ① 规划路径：integrateSim 从 t=700 滑行到 t=700+wait → 该状态 lunarAimPoint
//      （solveTLI 里就是这条路径，日志显示它**收敛**了：peri 116 km / v∞ 0.857）
//   ② 实飞路径：new World + advance(1/60) 逐帧（warp=2000）滑行到同一时刻
//      → 同一函数（burnTLI 里就是这条路径，实测 **no-converge**）
// 对比两条路径的状态差与 aim 的失败原因，判定是「步长序列差」还是「时刻过冲」。
//
// 用法： node tools/diag_m2_aim.js .
// ---------------------------------------------------------------------------
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const ctx = { console, Math, isFinite, isNaN, Number, JSON, Object };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, 'apollo11', 'webdata', 'js', f), 'utf8'),
    ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY } = ctx.APL;
const RE = BODY.EARTH.radius, MUE = BODY.EARTH.mu, RM = BODY.MOON.radius;
const SITE = ctx.APL.SITE, LSITE = ctx.APL.LANDING_SITE;
const fmt = (x, n) => (x === undefined || x === null || !isFinite(x)) ? '-' : x.toFixed(n === undefined ? 1 : n);

const M2T0 = 700, TOF = 100 * 3600;

// ---- 07 buildScenario('parking') 的共面候选停车态（与 test_finite_tli 一致）----
function parkCraft(raanIdx) {
  const rp = RE + SITE.parkingPerigee, ra = RE + SITE.parkingApogee;
  const incP = SITE.parkingInclination * M.D2R, tofP = 96 * 3600;
  const uArr = V.unit(A.moonState(M2T0 + tofP).r), rMid = (rp + ra) / 2;
  const raanP = M.raanCandidates(incP, uArr)[raanIdx];
  const nP = M.orbitNormal(incP, raanP);
  const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
  const rDep = V.mul(depP, -rMid);
  const vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(MUE / rMid));
  return { r: rDep, v: vDep, raan: raanP };
}
const mods = () => P.buildSaturnVStack().filter(m => m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA');

const park = parkCraft(1);
// solveTLI 的粗扫（每 1/25 圈），取 tof=100 h 的 score 最优 wait
function coarseWait() {
  const el = M.elements(MUE, park.r, park.v);
  const period = 2 * Math.PI * Math.sqrt(el.a ** 3 / MUE);
  let best = null;
  for (let k = 0; k <= 120; k++) {
    const wait = k * period / 25;
    const st1 = M.propagate(MUE, park.r, park.v, wait);
    const tg = A.moonState(M2T0 + wait + TOF);
    const Lb = M.lambert(MUE, st1.r, tg.r, TOF, true);
    if (!Lb) continue;
    const dv = V.mag(V.sub(Lb.v1, st1.v));
    const vInfE = V.mag(V.sub(Lb.v2, tg.v));
    const score = dv + Math.abs(vInfE - 0.87);
    if (!best || score < best.score) best = { wait, dv, vInfE, score, period };
  }
  return best;
}

console.log('=== M2 lunarAimPoint 诊断 ===');
const cw = coarseWait();
const tIgn = M2T0 + cw.wait;
console.log('停车周期 ' + fmt(cw.period, 1) + ' s   wait=' + fmt(cw.wait, 1) + ' s   t_ign=' + fmt(tIgn, 2)
  + ' s   (粗扫兰伯特 Δv=' + fmt(cw.dv * 1000, 0) + ' m/s, v∞E=' + fmt(cw.vInfE, 4) + ')');

function aimAt(label, w, r, v, t, tof) {
  const plan = new P.Craft({ id: 'PLAN', r: r.slice(), v: v.slice(), modules: mods(), mode: 'prograde', primary: 'EARTH' });
  plan.stageIndex = 2;
  const w2 = new P.World(); w2.t = t;
  const tSave = w.t; w.t = t;
  let aim;
  try { aim = w.lunarAimPoint(plan, tof, 111); } finally { w.t = tSave; }
  console.log('\n--- ' + label + ' ---');
  console.log('  r=' + r.map(x => fmt(x, 1)).join(',') + '  |v|=' + fmt(V.mag(v), 6));
  if (!aim) { console.log('  aim = null'); return aim; }
  if (aim.failed) {
    console.log('  ✘ failed=' + aim.failed + '  periErr=' + fmt(aim.periErr, 2)
      + '  periAlt=' + fmt(aim.periAlt, 2) + '  plane=' + fmt(aim.planeDeg, 4)
      + '  vInf=' + fmt(aim.vInf, 4) + '  corrEq=' + fmt(aim.corrEq * 1000, 2) + ' m/s'
      + '  evals=' + aim.evals + '  tof=' + fmt(aim.tof || tof, 0));
  } else {
    console.log('  ✔ peri=' + fmt(aim.periAlt, 2) + ' km  plane=' + fmt(aim.planeDeg, 4)
      + '°  v∞=' + fmt(aim.vInf, 4) + '  dv=' + fmt(aim.dv * 1000, 0) + ' m/s  corr='
      + fmt(aim.smallCorrection && aim.smallCorrection.dv * 1000, 2) + ' m/s  tArr=' + fmt(aim.tArr, 0));
  }
  return aim;
}

// ① 规划路径：integrateSim（与 solveTLI 的 planning clone 完全一致）
const w0 = new P.World(); w0.t = M2T0;
const st = P.integrateSim(w0, park.r, park.v, M2T0, tIgn, {});
const aimPlan = aimAt('① 规划路径 integrateSim（solveTLI 用的就是它）', w0, st.r, st.v, tIgn, TOF);

// ② 实飞路径：逐帧 advance（warp=2000，即 advance(1/60) 推进 33.3 s/帧）
function flyTo(tStop, stopAt) {
  const w = new P.World(); w.t = M2T0; w.warp = 2000; w.running = true;
  const c = new P.Craft({ id: 'CSM', r: park.r.slice(), v: park.v.slice(), modules: mods(), mode: 'prograde' });
  c.stageIndex = 2; w.addCraft(c);
  w._advanceStopAt = stopAt === undefined ? null : stopAt;
  let guard = 0;
  while (w.t < tStop && guard++ < 200000) w.advance(1 / 60);
  return { w, c };
}
const f1 = flyTo(tIgn);
const aimFly = aimAt('② 实飞路径 advance(1/60)×warp2000（burnTLI 用的就是它，无 _advanceStopAt）',
  f1.w, f1.c.r, f1.c.v, f1.w.t, TOF - (f1.w.t - tIgn));

// ②b 实飞路径 + _advanceStopAt（拟采用的修法：精确停在点火点）
const f2 = flyTo(tIgn, tIgn);
console.log('\n--- ②b 实飞 + _advanceStopAt=t_ign ---');
console.log('  停在 t=' + fmt(f2.w.t, 6) + ' s（目标 ' + fmt(tIgn, 6) + ' s，过冲 '
  + fmt(f2.w.t - tIgn, 6) + ' s）');
const aimFly2 = aimAt('②b 实飞路径 + _advanceStopAt（精确停在点火点）',
  f2.w, f2.c.r, f2.c.v, f2.w.t, TOF - (f2.w.t - tIgn));
console.log('\n--- 实飞（精确停）vs 规划 状态差 ---');
console.log('  |Δr| = ' + fmt(V.dist(st.r, f2.c.r), 4) + ' km   |Δv| = '
  + fmt(V.mag(V.sub(st.v, f2.c.v)) * 1000, 3) + ' m/s');

// ③ 状态差
console.log('\n--- 两条路径的状态差（同一 t_ign） ---');
const dR = V.dist(st.r, f1.c.r), dV = V.mag(V.sub(st.v, f1.c.v));
console.log('  |Δr| = ' + fmt(dR, 4) + ' km   |Δv| = ' + fmt(dV * 1000, 3) + ' m/s   Δt = '
  + fmt(f1.w.t - tIgn, 3) + ' s');

// ④ 时刻敏感性：规划态在 t_ign 与 t_ign+24 分别求解
if (st && st.r) {
  const st2 = P.integrateSim(w0, park.r, park.v, M2T0, tIgn + 24, {});
  aimAt('④ 规划态但 tof 少 24 s（t=t_ign+24）', w0, st2.r, st2.v, tIgn + 24, TOF - 24);
}

// ===========================================================================
// ⑤ startLunarTransfer 在"实飞精确停"状态上的完整失败报告
//    （demo 的 burnTLI 现在就走这条路；失败原因要能看到 evals / stageA / 三项残差）
// ===========================================================================
if (aimFly2 && !aimFly2.failed) {
  console.log('\n--- ⑤ startLunarTransfer（实飞精确停状态） ---');
  const t5 = Date.now();
  const res = f2.w.startLunarTransfer(f2.c, aimFly2, {});
  const ms = Date.now() - t5;
  console.log('  用时 ' + ms + ' ms  ok=' + (res && res.ok) + '  failed=' + (res && res.failed)
    + '  evals=' + (res && res.evals) + '（A=' + (res && res.evalsA) + ', B=' + (res && res.evalsB) + '）');
  if (res) {
    console.log('  T=' + fmt(res.T, 2) + ' s  a=' + fmt(res.a * 180 / Math.PI, 3) + '°  b='
      + fmt(res.b * 180 / Math.PI, 3) + '°');
    console.log('  periAlt=' + fmt(res.periAlt, 2) + ' km  periErr=' + fmt(res.periErr, 2)
      + '  plane=' + fmt(res.planeDeg, 4) + '°  vInf=' + fmt(res.vInf, 4)
      + '  corrEq=' + fmt(res.corrEq * 1000, 2) + ' m/s  corrImp=' + fmt(res.corrImp * 1000, 2) + ' m/s');
    if (res.stageA) console.log('  stageA: a=' + fmt(res.stageA.a * 180 / Math.PI, 3) + '° b='
      + fmt(res.stageA.b * 180 / Math.PI, 3) + '° T=' + fmt(res.stageA.T, 2) + ' s  位置残差 |d|='
      + fmt(res.stageA.d, 2) + ' km  periAlt=' + fmt(res.stageA.periAlt, 2) + ' km');
    if (res.arc) console.log('  arc: T=' + fmt(res.arc.T, 2) + ' s  prop=' + fmt(res.arc.propUsed, 0)
      + ' kg  dvActual=' + fmt(res.arc.dvActual * 1000, 0) + ' m/s  m0=' + fmt(res.arc.mass0, 0)
      + ' → m1=' + fmt(res.arc.mass1, 0) + '  steps=' + res.arc.steps
      + '  exhaustedProp=' + res.arc.exhaustedProp);
    console.log('  seedT=' + fmt(res.seedT, 2) + ' s  aim.dv=' + fmt(aimFly2.dv * 1000, 0) + ' m/s');
  }
}
