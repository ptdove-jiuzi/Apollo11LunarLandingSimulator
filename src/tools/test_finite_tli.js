// tools/test_finite_tli.js
// ---------------------------------------------------------------------------
// 真实 M2 有限推力 TLI 打靶验证台（World.prototype.startLunarTransfer）。
//
// 复现 AGENT_HANDOFF/07 U3/U4 的真实起点：
//   · 07 buildScenario('parking')：t=700 s，停泊 183.2×185.9 km、i=32.521°，
//     模块 S-IVB(106400) + LM_D(8200) + LM_A(3000) + SM(24000) + CM。
//   · 停车面用**共面候选**（raanCandidates[1]=359.340°，与月球轨道面夹角最小 4.01°）；
//     07 因两候选兰伯特在 180° 退化而落到第一个（面偏 60.82°），那条没有可行窗口。
//   · tof=98 h + coarseWait（≈21375.4 s）点火；lunarAimPoint 预测 110.66 km、
//     面 0.0022°、v∞ 0.8672、解析修正 19.15 m/s。
//
// 验证目标（AGENT_HANDOFF/08 §1 三项，绝不放宽）：
//   ① 真近月点 111 ± 20 km；② 到达面 ≤ 0.1°；③ v∞ ∈ 0.83~0.90。
//   有限点火相对初始有限种子的冲量等效修正 ≤ 20 m/s。
//
// 流程（全部走**真实引擎**，初始化之外绝不直接改 c.r/c.v）：
//   1) 构造停车态 → integrateSim 滑行到点火点 → newCraft（克隆模块，独立推进剂）；
//   2) lunarAimPoint 理想脉冲瞄准（只作参考/种子，不实飞）；
//   3) startLunarTransfer：对有限动力弧打靶 (a,b,T)，成功后 world.finiteBurn 实飞；
//   4) world.advance 跑到关机 → integrateSim 到真近月点 → 三项复核；
//   5) 校验预测动力弧 == 实飞关机状态（同构性）。
//
// 用法： node tools/test_finite_tli.js .
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
const RE = BODY.EARTH.radius, MUE = BODY.EARTH.mu;
const RM = BODY.MOON.radius;
const SITE = ctx.APL.SITE, LSITE = ctx.APL.LANDING_SITE;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? '   ' + detail : ''));
}
function fmt(x, n) {
  return (x === undefined || x === null || !isFinite(x)) ? '-' : x.toFixed(n === undefined ? 1 : n);
}
const NODE = process.execPath;

// --------------------------------------------------------------- M2 起点构造
const M2T0 = 700;
function m2PlaneAngle(nPark, tRef) {
  const ms = A.moonState(tRef);
  const nMoon = V.unit(V.cross(ms.r, ms.v));
  return Math.acos(V.clamp(V.dot(V.unit(nPark), nMoon), -1, 1)) * 180 / Math.PI;
}
// 07 buildScenario('parking') 的停车状态 + 真实模块（raanIdx：0=07 实际选中，1=共面候选）
function m2ParkCraft(raanIdx) {
  const rp = RE + SITE.parkingPerigee, ra = RE + SITE.parkingApogee;
  const incP = SITE.parkingInclination * M.D2R, tofP = 96 * 3600;
  const uArr = V.unit(A.moonState(M2T0 + tofP).r), rMid = (rp + ra) / 2;
  const raanP = M.raanCandidates(incP, uArr)[raanIdx];
  const nP = M.orbitNormal(incP, raanP);
  const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
  const rDep = V.mul(depP, -rMid);
  const vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(MUE / rMid));
  const w = new P.World(); w.t = M2T0; w.running = true; w.autoStage = false;
  const c = new P.Craft({ id: 'CSM', name: 'Columbia', r: rDep, v: vDep,
    modules: P.buildSaturnVStack().filter(m => m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA'),
    mode: 'prograde' });
  c.stageIndex = 2; w.addCraft(c);
  return { w, c, raan: raanP, nPark: nP };
}
// 07 solveTLI 的粗扫：停车轨道上每 1/25 圈扫一次 wait，取两体兰伯特 score 最小的 wait
function m2CoarseWait(craft, tof) {
  const mu = MUE, el = M.elements(mu, craft.r, craft.v);
  const period = 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / mu);
  let best = null;
  for (let k = 0; k <= 120; k++) {
    const wait = k * period / 25;
    const st1 = M.propagate(mu, craft.r, craft.v, wait);
    const tg = A.moonState(M2T0 + wait + tof);
    const Lb = M.lambert(mu, st1.r, tg.r, tof, true);
    if (!Lb) continue;
    const dv = V.mag(V.sub(Lb.v1, st1.v));
    const vInfE = V.mag(V.sub(Lb.v2, tg.v));
    const score = dv + Math.abs(vInfE - 0.87);
    if (!best || score < best.score) best = { wait, dv, vInfE, score, period };
  }
  return best;
}

console.log('有限推力 TLI 打靶验证台 —— 真实 M2（S-IVB 106400 + CSM 24000 + LM 3000），受管 Node');
console.log('node: ' + NODE + '\n');

// ===========================================================================
// 构造：停车态 → 滑行到点火点 → newCraft（真实引擎实飞的对象）
// ===========================================================================
const TOF = 98 * 3600;
const { w, c } = m2ParkCraft(1);
const cw = m2CoarseWait(c, TOF);
const tIgn = M2T0 + cw.wait;
const stC = P.integrateSim(w, c.r, c.v, M2T0, tIgn);        // 真实引力滑行
w.t = tIgn;
const plan = new P.Craft({ id: 'CSM', name: 'Columbia', r: stC.r.slice(), v: stC.v.slice(),
  modules: c.modules, mode: 'prograde', primary: 'EARTH' });
plan.stageIndex = c.stageIndex;
w.crafts.length = 0; w.addCraft(plan);                       // 用克隆飞行器实飞
console.log('停车面 cand1 RAAN=' + fmt(cw.period, 1) + ' s/圈  粗扫 wait=' + fmt(cw.wait, 1)
  + ' s  点火 t=' + fmt(tIgn, 1) + ' s  m0=' + fmt(plan.mass(), 0) + ' kg');
console.log('停车面与月球轨道面夹角 = ' + fmt(m2PlaneAngle(M.orbitNormal(
  SITE.parkingInclination * M.D2R, M.raanCandidates(SITE.parkingInclination * M.D2R,
    V.unit(A.moonState(M2T0 + 96 * 3600).r))[1]), M2T0 + 96 * 3600), 2) + '°');

// ---------------------------------------------------------------- 理想脉冲瞄准
const t1 = Date.now();
const aim = w.lunarAimPoint(plan, TOF, 111);
const aimMs = Date.now() - t1;
check('A1 lunarAimPoint 收敛（理想脉冲参考解）', !!(aim && !aim.failed),
  '(failed=' + (aim && aim.failed) + ')');
if (!aim || aim.failed) { console.log('  aim 失败，终止'); process.exit(1); }
console.log('   aim：peri=' + fmt(aim.periAlt, 2) + ' km  plane=' + fmt(aim.planeDeg, 4) + '°  v∞='
  + fmt(aim.vInf, 4) + '  corr=' + fmt(aim.smallCorrection.dv * 1000, 2) + ' m/s  T=' + fmt(aim.T, 1)
  + ' s  (' + aimMs + ' ms)');
// 只用 aim.tArr 时刻站点方向作为目标面（与 03 内部 startLunarTransfer 一致）
const msArr0 = A.moonState(aim.tArr);
const siteDir0 = V.unit(V.sub(A.moonSurfacePoint(aim.tArr, LSITE.lat, LSITE.lon, 0).r, msArr0.r));

// ---------------------------------------------------- 初始有限种子响应（诊断）
const dvSeed = aim.dv;
const Tseed = P.estimateBurnSecs(plan, dvSeed);
const seedArc = w.finiteBurnArc(plan, { dir: aim.dir, T: Tseed });
const seedErr = P.lunarAimError(w, seedArc.r, seedArc.v, seedArc.t, aim.tArr + 3 * 3600, 111,
  LSITE.lat, LSITE.lon, siteDir0);
console.log('\n初始有限种子（u=aim.dir, T=estimateBurnSecs(c,aim.dv)=' + fmt(Tseed, 1) + ' s）：');
console.log('   动力弧关机：r=' + seedArc.r.map(x => fmt(x, 0)).join(',') + '  |v|=' + fmt(V.mag(seedArc.v), 4)
  + '  prop=' + fmt(seedArc.propUsed, 0) + ' kg  实际Δv=' + fmt(seedArc.dvActual * 1000, 0) + ' m/s');
console.log('   全模型预测：peri=' + fmt(seedErr && seedErr.peri, 2) + ' km  plane='
  + fmt(seedErr && seedErr.planeDeg, 4) + '°  v∞=' + fmt(seedErr && seedErr.vInf, 4));
check('A2 初始有限种子明显偏离 111 km（有限点火固有偏差，需打靶）',
  !!seedErr && Math.abs(seedErr.peri - 111) > 20, '(peri=' + fmt(seedErr && seedErr.peri, 1) + ' km)');

// ===========================================================================
// 打靶 + 实飞
// ===========================================================================
console.log('\n=== B  startLunarTransfer：有限动力弧打靶 (a,b,T) ===');
const t2 = Date.now();
const res = w.startLunarTransfer(plan, aim, {});
const solveMs = Date.now() - t2;
console.log('   求解用时 ' + solveMs + ' ms');
console.log('   结果：ok=' + (res && res.ok) + '  failed=' + (res && res.failed)
  + '  evals=' + (res && res.evals) + '（A=' + (res && res.evalsA) + ', B=' + (res && res.evalsB) + '）');
if (res) console.log('   解：a=' + fmt(res.a * 180 / Math.PI, 3) + '°  b=' + fmt(res.b * 180 / Math.PI, 3)
  + '°  T=' + fmt(res.T, 1) + ' s  peri=' + fmt(res.periAlt, 2) + ' km  plane=' + fmt(res.planeDeg, 4)
  + '°  v∞=' + fmt(res.vInf, 4) + '  corrEq=' + fmt(res.corrEq * 1000, 2) + ' m/s  corrImp='
  + fmt(res.corrImp * 1000, 2) + ' m/s');
if (res && res.stageA) console.log('   阶段A 种子：a=' + fmt(res.stageA.a * 180 / Math.PI, 3) + '° b='
  + fmt(res.stageA.b * 180 / Math.PI, 3) + '° T=' + fmt(res.stageA.T, 1) + ' s  位置残差 |d|='
  + fmt(res.stageA.d, 2) + ' km');

check('B1 startLunarTransfer 成功（有限动力弧收敛到三项）', !!(res && res.ok),
  '(failed=' + (res && res.failed) + ')');
if (!res || !res.ok) {
  console.log('\n===== 汇总：' + pass + ' 通过 / ' + (fail + 1) + ' 失败（打靶失败，明确失败不加宽门） =====');
  process.exit(1);
}
check('B2 预测近月点 111 ± 20 km', Math.abs(res.periAlt - 111) <= 20, '(peri=' + fmt(res.periAlt, 2) + ')');
check('B3 预测到达面 ≤ 0.1°', res.planeDeg <= 0.1, '(plane=' + fmt(res.planeDeg, 4) + '°)');
check('B4 预测 v∞ ∈ [0.83, 0.90]', res.vInf >= 0.83 && res.vInf <= 0.90, '(v∞=' + fmt(res.vInf, 4) + ')');
check('B5 冲量等效修正 ≤ 20 m/s（不放宽 08）', res.corrEq <= 0.020 + 1e-9,
  '(corrEq=' + fmt(res.corrEq * 1000, 2) + ' m/s)');
check('B6 姿态偏置在 ±10° 内（不是 MCC 级转向）',
  Math.abs(res.a) <= Math.tan(10 * Math.PI / 180) + 1e-9 && Math.abs(res.b) <= Math.tan(10 * Math.PI / 180) + 1e-9,
  '(a=' + fmt(res.a * 180 / Math.PI, 2) + '°, b=' + fmt(res.b * 180 / Math.PI, 2) + '°)');

// ---------------------------------------------------------- 真实引擎实飞关机
console.log('\n=== C  真实有限引擎实飞（world.advance）到关机 ===');
check('C1 finiteBurn 已启动（plan.burn.active）', !!(plan.burn && plan.burn.active),
  '(label=' + (plan.burn && plan.burn.label) + ')');
const predCut = res.arc;                       // 预测的关机状态（点火末端 t0+T）
const t3 = Date.now();
// ⚠ 必须用**引擎自身的步长**把点火驱动到关机（warp=1，无块截断）——见
//   World.prototype.advanceBurnToEnd 的注释。advance(0.5) 会在块边界夹 h，步长序列
//   与 finiteBurnArc 的均匀步长不同 ⇒ 近月点差 38 km（实测 68.2 vs 106.7）。
const bEnd = w.advanceBurnToEnd(plan);
const flyMs = Date.now() - t3;
const burnT = plan.burn ? plan.burn.t : 0;
const burnProp = plan.burn ? plan.burn.propUsed : 0;
console.log('   实飞用时 ' + flyMs + ' ms  步数 ' + (bEnd && bEnd.steps) + '  点火 ' + fmt(burnT, 2)
  + ' s  耗油 ' + fmt(burnProp, 0) + ' kg  关机 r=' + plan.r.map(x => fmt(x, 0)).join(',')
  + '  |v|=' + fmt(V.mag(plan.v), 4));
check('C2 真实点火时长 == 打靶 T（±1 s）', Math.abs(burnT - res.T) < 1,
  '(实飞 ' + fmt(burnT, 2) + ' s vs 打靶 ' + fmt(res.T, 2) + ' s)');

// 同构性：预测动力弧关机状态 vs 实飞关机状态。
// 引擎在 updateBurn 里先 b.t+=h 再判 T，所以真正的关机步会比 T 多走一个"无推力滑行步"
// （b.t = T + h_末步）。要比较同一时刻的状态，把预测弧滑行到实飞当前时刻再比。
const coastDt = w.t - predCut.t;
const stSame = P.integrateSim(w, predCut.r, predCut.v, predCut.t, w.t, {});
const dR = V.dist(plan.r, stSame.r), dV = V.mag(V.sub(plan.v, stSame.v));
console.log('   同构性（滑行补偿 ' + fmt(coastDt, 3) + ' s 后）：|Δr|=' + fmt(dR, 4) + ' km  |Δv|='
  + fmt(dV * 1000, 3) + ' m/s');
check('C3 预测动力弧 == 实飞关机（|Δr|<1 km, |Δv|<1 m/s，同一时刻）', dR < 1 && dV < 0.001,
  '(|Δr|=' + fmt(dR, 4) + ' km, |Δv|=' + fmt(dV * 1000, 3) + ' m/s)');
check('C4 末端仅多一个无推力滑行步（< 1 个步长）', Math.abs(coastDt) < 0.5 + 1e-6,
  '(coastDt=' + fmt(coastDt, 3) + ' s)');

// ---------------------------------------------------------- 严格到达复核（closest）
console.log('\n=== D  严格到达复核（真实引力积分到真近月点） ===');
const ca = P.integrateSim(w, plan.r, plan.v, w.t, aim.tArr + 6 * 3600,
  { closest: true, stopKm: RM + 1, maxSteps: 400000 });
check('D1 积分到达真近月点（有 closest 记录）', !!(ca && ca.r && isFinite(ca.dist)),
  '(dist=' + fmt(ca && ca.dist, 1) + ' km)');
if (ca && ca.r) {
  const aerr = P.lunarAimError(w, plan.r, plan.v, w.t, aim.tArr + 6 * 3600, 111,
    LSITE.lat, LSITE.lon, siteDir0);
  const peri = ca.dist - RM;
  console.log('   真近月点 ' + fmt(peri, 2) + ' km   plane=' + fmt(aerr && aerr.planeDeg, 4)
    + '°   v∞=' + fmt(aerr && aerr.vInf, 4));
  check('D2 真近月点 111 ± 20 km（真实有限引擎，不是预测）', Math.abs(peri - 111) <= 20,
    '(peri=' + fmt(peri, 2) + ' km)');
  check('D3 到达面 ≤ 0.1°', !!aerr && aerr.planeDeg <= 0.1, '(plane=' + fmt(aerr && aerr.planeDeg, 4) + '°)');
  check('D4 v∞ ∈ [0.83, 0.90]', !!aerr && aerr.vInf >= 0.83 && aerr.vInf <= 0.90,
    '(v∞=' + fmt(aerr && aerr.vInf, 4) + ')');
  // 与理想脉冲 aim 的到达三项一致性（打靶确实把有限弧拉回了 aim 的到达几何）
  check('D5 到达三项与理想脉冲 aim 一致（近月点差 <5 km、面差 <0.05°、v∞ 差 <0.01）',
    Math.abs(peri - aim.periAlt) < 5 && Math.abs(aerr.planeDeg - aim.planeDeg) < 0.05 &&
    Math.abs(aerr.vInf - aim.vInf) < 0.01,
    '(|Δperi|=' + fmt(Math.abs(peri - aim.periAlt), 2) + ' km, |Δplane|='
    + fmt(Math.abs(aerr.planeDeg - aim.planeDeg), 4) + '°, |Δv∞|='
    + fmt(Math.abs(aerr.vInf - aim.vInf), 4) + ')');
}

console.log('\n===== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
