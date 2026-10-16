// tools/diag_tli_budget.js
// ---------------------------------------------------------------------------
// 决定性问题：M2 的 TLI 有限动力弧打靶（World.prototype.startLunarTransfer）
// 失败到底是「搜索预算不够」还是「几何本身不可达」？
//
// 背景（见 outputs/route08/diag-m2-aim.txt ⑤）：
//   在"实飞精确停到点火点"的状态上，startLunarTransfer 的阶段 A 只把位置残差
//   收到 |d| = 214.48 km（metA 要 < 60 km），阶段 B 用满 120 evals 后停在
//   periErr = +21.33 km（验收上限 20 km），而 corrEq 只用了 15.72 / 20 m/s
//   —— 预算没用完，说明是**搜索没收敛**，不是被上限卡住。
//
// 本脚本对同一状态、同一 aim，扫几组 (aTries, aMaxEvals, bMaxEvals, bMaxIters)，
// 看三项残差能不能压进 111 ± 20 / 0.1° / v∞ 0.83~0.90。
// 只做诊断，不改产品行为。
//
// 用法： node tools/diag_tli_budget.js .
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
const SITE = ctx.APL.SITE, LSITE = ctx.APL.LANDING_SITE;
const fmt = (x, n) => (x === undefined || x === null || !isFinite(x)) ? '-' : x.toFixed(n === undefined ? 1 : n);

const M2T0 = 700, TOF = 100 * 3600;

function parkState() {
  const rp = RE + SITE.parkingPerigee, ra = RE + SITE.parkingApogee;
  const incP = SITE.parkingInclination * M.D2R, tofP = 96 * 3600;
  const uArr = V.unit(A.moonState(M2T0 + tofP).r), rMid = (rp + ra) / 2;
  const raanP = M.raanCandidates(incP, uArr)[1];       // 共面候选（07 现在选的就是它）
  const nP = M.orbitNormal(incP, raanP);
  const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
  const rDep = V.mul(depP, -rMid);
  const vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(MUE / rMid));
  return { r: rDep, v: vDep, raan: raanP };
}
const mods = () => P.buildSaturnVStack().filter(m => m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA');

const park = parkState();
// 粗扫（每 1/25 圈）取 tof=100 h 的最优 wait
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
const cw = coarseWait();
const tIgn = M2T0 + cw.wait;
console.log('t_ign = ' + fmt(tIgn, 3) + ' s   tof = ' + (TOF / 3600) + ' h\n');

// ---- 实飞路径（引擎步长）精确停在点火点 ----
function flyExact() {
  const w = new P.World(); w.t = M2T0; w.warp = 2000; w.running = true;
  const c = new P.Craft({ id: 'CSM', r: park.r.slice(), v: park.v.slice(), modules: mods(), mode: 'prograde' });
  c.stageIndex = 2; w.addCraft(c);
  w._advanceStopAt = tIgn;
  let guard = 0;
  while (w.t < tIgn && guard++ < 200000) w.advance(1 / 60);
  return { w, c, r: c.r.slice(), v: c.v.slice() };
}
const f = flyExact();
console.log('实飞精确停：t = ' + fmt(f.w.t, 6) + ' s（过冲 ' + fmt(f.w.t - tIgn, 6) + ' s）');
console.log('  r=' + f.r.map(x => fmt(x, 1)).join(',') + '  |v|=' + fmt(V.mag(f.v), 6) + '\n');

// ---- 规划路径（integrateSim）状态，用于对比 aim ----
const w0 = new P.World(); w0.t = M2T0;
const stP = P.integrateSim(w0, park.r, park.v, M2T0, tIgn, {});
console.log('规划态 |Δr| vs 实飞 = ' + fmt(V.dist(stP.r, f.r), 4) + ' km  |Δv| = '
  + fmt(V.mag(V.sub(stP.v, f.v)) * 1000, 3) + ' m/s\n');

function solveAim(r, v, t, tof, label) {
  const plan = new P.Craft({ id: 'PLAN', r: r.slice(), v: v.slice(), modules: mods(), mode: 'prograde', primary: 'EARTH' });
  plan.stageIndex = 2;
  const w = new P.World(); w.t = t;
  const aim = w.lunarAimPoint(plan, tof, 111);
  if (!aim || aim.failed) {
    console.log(label + ' → ✘ ' + (aim && aim.failed) + ' periAlt=' + fmt(aim && aim.periAlt, 2)
      + ' periErr=' + fmt(aim && aim.periErr, 2) + ' vInf=' + fmt(aim && aim.vInf, 4));
  } else {
    console.log(label + ' → ✔ peri=' + fmt(aim.periAlt, 2) + ' km  plane=' + fmt(aim.planeDeg, 4)
      + '°  v∞=' + fmt(aim.vInf, 4) + '  dv=' + fmt(aim.dv * 1000, 0) + ' m/s  corr='
      + fmt(aim.smallCorrection.dv * 1000, 2) + ' m/s  T=' + fmt(aim.cut.T, 1) + ' s');
  }
  return aim;
}

console.log('=== 两个 aim ===');
const aimReal = solveAim(f.r, f.v, tIgn, TOF, 'A) 实飞态上重解（burnTLI 现在做的）');
const aimPlan = solveAim(stP.r, stP.v, tIgn, TOF, 'B) 规划态上解（solveTLI 选中的 pick.aim）');

// ---- 扫预算 ----
const COMBOS = [
  { name: '默认（现状）',                    o: {} },
  { name: 'A: tries 3 / evals 150',          o: { aTries: 3, aMaxEvals: 150, aMaxIters: 60 } },
  { name: 'B: 只加 B 预算 400/150',          o: { bMaxEvals: 400, bMaxIters: 150 } },
  { name: 'C: A+B 都加',                     o: { aTries: 3, aMaxEvals: 150, aMaxIters: 60, bMaxEvals: 400, bMaxIters: 150 } },
  { name: 'D: C + tries 5 / A evals 300',    o: { aTries: 5, aMaxEvals: 300, aMaxIters: 100, bMaxEvals: 400, bMaxIters: 150 } },
];

function runCombo(aim, label, opts) {
  if (!aim || aim.failed) { console.log('  ' + label + ' → 跳过（aim 失败）'); return null; }
  // 每个组合都用独立的世界 + 独立克隆的飞行器（互不污染）
  const w = new P.World(); w.t = tIgn; w.running = false;
  const c = new P.Craft({ id: 'CSM', r: f.r.slice(), v: f.v.slice(),
    modules: P.buildSaturnVStack().filter(m => m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA'),
    mode: 'prograde' });
  c.stageIndex = 2; w.addCraft(c);
  const t = Date.now();
  const res = w.startLunarTransfer(c, aim, opts);
  const ms = Date.now() - t;
  const ok = !!(res && res.ok);
  console.log('  ' + (ok ? '✔' : '✘') + ' ' + label + '  (' + (ms / 1000).toFixed(1) + ' s, evals A='
    + (res && res.evalsA) + ' B=' + (res && res.evalsB) + ')');
  if (res) {
    console.log('      T=' + fmt(res.T, 2) + ' s  a=' + fmt(res.a * 180 / Math.PI, 3) + '°  b='
      + fmt(res.b * 180 / Math.PI, 3) + '°  peri=' + fmt(res.periAlt, 2) + ' km (err '
      + fmt(res.periErr, 2) + ')  plane=' + fmt(res.planeDeg, 4) + '°  v∞=' + fmt(res.vInf, 4)
      + '  corrEq=' + fmt(res.corrEq * 1000, 2) + ' m/s');
    if (res.stageA) console.log('      stageA |d|=' + fmt(res.stageA.d, 2) + ' km  T='
      + fmt(res.stageA.T, 2) + ' s');
    if (res.failed) console.log('      failed=' + res.failed);
  }
  return res;
}

for (const aimCase of [['实飞态 aim', aimReal], ['规划态 aim', aimPlan]]) {
  console.log('\n=== 用「' + aimCase[0] + '」跑预算组合 ===');
  for (const cb of COMBOS) {
    console.log('[' + cb.name + ']');
    runCombo(aimCase[1], cb.name, cb.o);
  }
}
