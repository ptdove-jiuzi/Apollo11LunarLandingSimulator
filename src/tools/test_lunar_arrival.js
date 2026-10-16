// tools/test_lunar_arrival.js
// ---------------------------------------------------------------------------
// 地月转移**到达几何**分项验证台（lunarAimError + World.prototype.lunarAimPoint）。
//
//   · 只加载四个基础模块（00/01/02/03），用 P.World 的**真实引力**
//     （地球 μ+J2、月球 μ+J2、太阳第三体、大气阻力），不替换任何模型。
//   · 到达目标（AGENT_HANDOFF/08 §1）**只此三项**：
//       ① 真近月点高度 111 km
//       ② 到达轨道面含着陆点方向（面角 ≤ 0.1°）
//       ③ 到达 v∞ ∈ 0.83 ~ 0.90 km/s
//   · 初始 Craft 由"真实停泊轨道 + 最小 Δv 相位"构造（**仅测试构造允许直接设 r/v**）；
//     求解之后**绝不**再手动改 craft.r/v 去凑结果。
//   · 断言：
//       T1 lunarAimError 实积分到**真近月点**（与独立 closestApproach 一致），
//          且与"20 000 km 处瞬时根数"的**假近点**明显不同（旧实现 bug）；
//       T2 lunarAimPoint 全模型修正 ≤ 20 m/s、近月点 111±20 km、面 ≤0.1°、v∞ 在窗口；
//          返回结构兼容 startFiniteManeuver 的 TLI 用法；
//       T3 可行窗口（tof 92h / 98h）都能成功；
//       T4 不可行窗口（tof 64h → v∞≈1.29）必须 failed，**绝不放宽阈值**；
//       T5 非法参数 / 极端输入返回 failed 且不抛异常、不 null deref。
//
// 用法：  node tools/test_lunar_arrival.js .
// ---------------------------------------------------------------------------
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const ctx = { console, Math, isFinite, isNaN, Number, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, 'apollo11', 'webdata', 'js', f), 'utf8'),
    ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY } = ctx.APL;
const RE = BODY.EARTH.radius, MUE = BODY.EARTH.mu;
const RM = BODY.MOON.radius, MUM = BODY.MOON.mu;
const T0 = 250000;
const SITE = ctx.APL.LANDING_SITE;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? '   ' + detail : ''));
}
function fmt(x, n) { return (x === undefined || x === null || !isFinite(x)) ? '-' : x.toFixed(n === undefined ? 1 : n); }

// --------------------------------------------------------------- 几何工具
// 月心相对的双曲线：由 (v∞, 近月点高度, 远端半径) 反解真近点角 ν<0 处的位置/速度
function hyperAt(vinf, rpAlt, rFar) {
  const rp = RM + rpAlt, e = 1 + rp * vinf * vinf / MUM, p = rp * (1 + e);
  const h = Math.sqrt(MUM * p);
  let cv = (p / rFar - 1) / e;
  cv = Math.max(-1, Math.min(1, cv));
  const nu = -Math.acos(cv);
  const r = p / (1 + e * Math.cos(nu));
  const pos = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const vel = V.mul([-Math.sin(nu), e + Math.cos(nu), 0], MUM / h);
  return { pos: pos, vel: vel, nu: nu, rp: rp, e: e, p: p };
}
// 双曲线开普勒：近月点 → 真近点角 ν 的时间（ν<0 → 负值）
function hypT(mu, p, e, nu) {
  const denom = 1 + e * Math.cos(nu);
  const sh = Math.sqrt(Math.max(0, e * e - 1)) * Math.sin(nu) / denom;
  const H = Math.log(sh + Math.sqrt(sh * sh + 1));
  const a = p / (1 - e * e), n = Math.sqrt(mu / (-a * -a * -a));
  return (e * Math.sinh(H) - H) / n;
}

// --------------------------------------------------------------- 停泊轨道
// 以月球 tArr 方向定轨道面（保证出发方向指向月球），θ 为相位
function parkState(t0, rPark, theta) {
  const ms = A.moonState(t0);
  const n = V.unit(V.cross(ms.r, ms.v));
  const e1 = V.unit(ms.r), e2 = V.unit(V.cross(n, e1));
  const u = V.add(V.mul(e1, Math.cos(theta)), V.mul(e2, Math.sin(theta)));
  return { r: V.mul(u, rPark), v: V.mul(V.unit(V.cross(n, u)), Math.sqrt(MUE / rPark)) };
}
// 该 tof 下两体最小 Δv 相位（真近点角 → 出发速度最小）
function minDvPhase(tof) {
  let best = null;
  for (let k = 0; k < 360; k++) {
    const th = 2 * Math.PI * k / 360;
    const s = parkState(T0, RE + 185, th);
    const tg = A.moonState(T0 + tof);
    const L = M.lambert(MUE, s.r, tg.r, tof, true);
    if (!L) continue;
    const dv = V.mag(V.sub(L.v1, s.v));
    if (!best || dv < best.dv) best = { dv: dv, th: th, vinf: V.mag(V.sub(L.v2, tg.v)) };
  }
  return best;
}
// 构造测试用 Craft（仅初始化允许设 r/v；之后绝不改动）
function newWorld() {
  const w = new P.World(); w.t = T0; w.running = true;   // 真实引力
  return w;
}
function makeCraft(tofH) {
  const tof = tofH * 3600;
  const ph = minDvPhase(tof);
  const s = parkState(T0, RE + 185, ph.th);
  const w = newWorld();
  const c = new P.Craft({ id: 'CSM', name: 'Columbia', r: s.r.slice(), v: s.v.slice(),
    modules: P.buildSaturnVStack().filter(m => m.id === 'SM'), rcsProp: 620 });
  c.primary = 'EARTH'; c.stageIndex = 5;
  w.addCraft(c);
  return { w: w, c: c, ph: ph };
}

// ===========================================================================
console.log('地月转移到达几何验证台 —— 受管 Node，真实引力（地球/月球 μ+J2 + 太阳第三体）');
console.log('到达目标：真近月点 111 km、到达面含着陆点（≤0.1°）、v∞ ∈ 0.83~0.90\n');

// ---------------------------------------------------------------- T1 真近点
(function testTruePeriapsis() {
  console.log('=== T1  lunarAimError 实积分到真近月点（不是 20k 瞬时根数） ===');
  const ms0 = A.moonState(T0);

  // T1a 近月端构造（8000 km 入点）：潮汐漂移小，真近点应≈构造值
  const hy8 = hyperAt(0.85, 111, 8000);
  const r8 = V.add(ms0.r, hy8.pos), v8 = V.add(ms0.v, hy8.vel);
  const tof8 = Math.abs(hypT(MUM, hy8.p, hy8.e, hy8.nu)) + 3600;
  const a8 = P.lunarAimError(newWorld(), r8, v8, T0, T0 + tof8, 111, SITE.lat, SITE.lon);
  check('T1a 近月端构造：真近点 ≈ 111 km（±1）', !!a8 && Math.abs(a8.peri - 111) < 1,
    '(peri=' + fmt(a8 && a8.peri, 3) + ' km, 入点 ν=' + fmt(hy8.nu * 180 / Math.PI, 1) + '°, 偏差=物理潮汐)');
  check('T1a 近月端构造：v∞ ≈ 0.85（±0.01）', !!a8 && Math.abs(a8.vInf - 0.85) < 0.01,
    '(v∞=' + fmt(a8 && a8.vInf, 4) + ')');

  // T1b 20 000 km 入点：地球潮汐使**真**近点显著偏离"瞬时根数"的假近点
  const hy20 = hyperAt(0.85, 111, 20000);
  const r20 = V.add(ms0.r, hy20.pos), v20 = V.add(ms0.v, hy20.vel);
  const tof20 = Math.abs(hypT(MUM, hy20.p, hy20.e, hy20.nu)) + 3600;
  const w = newWorld();
  const a20 = P.lunarAimError(w, r20, v20, T0, T0 + tof20, 111, SITE.lat, SITE.lon);
  const el20 = M.elements(MUM, hy20.pos, hy20.vel);          // 旧实现：入点瞬时根数
  const fakePeri = el20.periapsis - RM;                       // 假近点
  const gt = P.integrateSim(w, r20, v20, T0, T0 + tof20, { closest: true });  // 独立真积分
  const gtPeri = gt.dist - RM;
  console.log('   20k 入点（ν=' + fmt(hy20.nu * 180 / Math.PI, 1) + '°, 飞行 ' +
    fmt(tof20 / 3600, 2) + ' h）：瞬时根数假近点=' + fmt(fakePeri, 3) +
    ' km，真积分近点=' + fmt(gtPeri, 3) + ' km，lunarAimError=' + fmt(a20 && a20.peri, 3) + ' km');
  check('T1b 20k 瞬时根数是**假近点**（与真值差 > 5 km）',
    !!a20 && Math.abs(a20.peri - fakePeri) > 5,
    '(|真−假|=' + fmt(a20 && Math.abs(a20.peri - fakePeri), 2) + ' km)');
  check('T1b lunarAimError 与独立 closestApproach 一致（< 0.5 km）',
    !!a20 && Math.abs(a20.peri - gtPeri) < 0.5,
    '(|Δ|=' + fmt(a20 && Math.abs(a20.peri - gtPeri), 4) + ' km)');
})();

// -------------------------------------------------------- T2 全模型到达瞄准
function arrivalChecks(tag, aim) {
  check(tag + '：未失败（有解）', !!(aim && !aim.failed),
    '(failed=' + (aim && aim.failed) + ')');
  if (!aim || aim.failed) return false;
  const peri = aim.periAlt, plane = aim.planeDeg, vinf = aim.vInf;
  const corrMs = aim.smallCorrection ? aim.smallCorrection.dv * 1000 : NaN;
  console.log('   解：peri=' + fmt(peri, 2) + ' km  plane=' + fmt(plane, 4) + '°  v∞=' + fmt(vinf, 4) +
    '  corr=' + fmt(corrMs, 2) + ' m/s  (it=' + fmt(aim.smallCorrection && aim.smallCorrection.iterations, 0) +
    ', ev=' + fmt(aim.smallCorrection && aim.smallCorrection.evals, 0) + ')');
  check(tag + '：近月点 111 ± 20 km', Math.abs(peri - 111) <= 20, '(peri=' + fmt(peri, 2) + ')');
  check(tag + '：到达面 ≤ 0.1°', plane <= 0.1, '(plane=' + fmt(plane, 4) + '°)');
  check(tag + '：v∞ ∈ [0.83, 0.90]', vinf >= 0.83 && vinf <= 0.90, '(v∞=' + fmt(vinf, 4) + ')');
  check(tag + '：全模型修正 ≤ 20 m/s', corrMs <= 20 + 1e-6, '(corr=' + fmt(corrMs, 2) + ' m/s)');
  return true;
}

function structuralChecks(tag, aim) {
  const keys = ['v1', 'aim', 'tArr', 'T', 'half', 'orbit'];
  const missing = keys.filter(k => aim[k] === undefined || aim[k] === null);
  check(tag + '：返回结构含 ' + keys.join('/'), missing.length === 0, '(缺=' + missing.join(',') + ')');
  const cutOk = aim.cut && isFinite(aim.cut.T) && isFinite(aim.cut.half) &&
    aim.cut.rImp && aim.cut.vImp && aim.cut.vPre;
  check(tag + '：aim.cut 供 startFiniteManeuver TLI 用', !!cutOk,
    '(T=' + fmt(aim.cut && aim.cut.T, 1) + ' s, half=' + fmt(aim.cut && aim.cut.half, 1) + ' s)');
  const fin = aim.v1.every(isFinite) && aim.aim.every(isFinite) && isFinite(aim.tArr) &&
    isFinite(aim.T) && isFinite(aim.half) && isFinite(aim.dv);
  check(tag + '：关键量有限（无 NaN/Inf）', fin, '(v1=[' + aim.v1.map(x => x.toFixed(3)).join(',') + '])');
  const sc = aim.smallCorrection;
  const scOk = sc && sc.seedV1 && sc.numericV1 && isFinite(sc.dv) && isFinite(sc.patchedErr) &&
    Math.abs(sc.dv - V.mag(V.sub(sc.numericV1, sc.seedV1))) < 1e-9;
  check(tag + '：smallCorrection 记录解析种子 vs 数值解', !!scOk,
    '(解析种子残差 patchedErr=' + fmt(sc && sc.patchedErr, 4) + ' km/s, 修正=' + fmt(sc && sc.dv * 1000, 2) + ' m/s)');
}

const aim98 = (function testAim() {
  console.log('\n=== T2  lunarAimPoint 全模型到达瞄准（tof=98h, v∞目标=0.87） ===');
  const { w, c } = makeCraft(98);
  const t1 = Date.now();
  const aim = w.lunarAimPoint(c, 98 * 3600, 111, { targetVInf: 0.87 });
  const ms = Date.now() - t1;
  console.log('   求解用时 ' + ms + ' ms');
  const ok = arrivalChecks('T2', aim);
  if (ok) structuralChecks('T2', aim);
  return aim;
})();

// ---------------------------------------------------------------- T3 窗口扫描
(function testWindows() {
  console.log('\n=== T3  可行窗口扫描（tof 92h / 98h 都应收敛） ===');
  for (const tofH of [92, 98]) {
    const { w, c } = makeCraft(tofH);
    const t1 = Date.now();
    const aim = w.lunarAimPoint(c, tofH * 3600, 111, { targetVInf: 0.87 });
    const ms = Date.now() - t1;
    console.log('   tof ' + tofH + 'h (' + ms + ' ms)：' + (aim && !aim.failed
      ? 'peri=' + fmt(aim.periAlt, 2) + ' plane=' + fmt(aim.planeDeg, 4) + '° v∞=' + fmt(aim.vInf, 4) +
        ' corr=' + fmt(aim.smallCorrection.dv * 1000, 2) + ' m/s'
      : 'failed=' + (aim && aim.failed)));
    const ok = aim && !aim.failed && Math.abs(aim.periAlt - 111) <= 20 && aim.planeDeg <= 0.1 &&
      aim.vInf >= 0.83 && aim.vInf <= 0.90 && aim.smallCorrection.dv <= 0.020 + 1e-9;
    check('T3 tof ' + tofH + 'h 收敛且达标', !!ok,
      '(peri=' + fmt(aim && aim.periAlt, 2) + ', plane=' + fmt(aim && aim.planeDeg, 4) +
      ', v∞=' + fmt(aim && aim.vInf, 4) + ')');
  }
})();

// ---------------------------------------------------------------- T4 不可行
(function testInfeasible() {
  console.log('\n=== T4  不可行窗口必须明确 failed（tof=64h，v∞ 物理上≈1.29） ===');
  const { w, c } = makeCraft(64);
  const t1 = Date.now();
  const aim = w.lunarAimPoint(c, 64 * 3600, 111, { targetVInf: 0.87 });
  const ms = Date.now() - t1;
  console.log('   (' + ms + ' ms) 结果：' + JSON.stringify({
    failed: aim && aim.failed, vInf: aim && aim.vInf, peri: aim && aim.periAlt, corr: aim && aim.corr }));
  check('T4 tof 64h：明确 failed', !!(aim && aim.failed),
    '(failed=' + (aim && aim.failed) + ')');
  check('T4 tof 64h：v∞ 未被"偷偷提高/降低"到窗口内',
    !(aim && !aim.failed) || (aim.vInf >= 0.83 && aim.vInf <= 0.90),
    '(v∞=' + fmt(aim && aim.vInf, 4) + ')');
})();

// ---------------------------------------------------------------- T5 非法输入
(function testInvalid() {
  console.log('\n=== T5  非法参数 / 极端输入：返回 failed 且不抛异常、不 null deref ===');
  const { w, c } = makeCraft(92);
  // [名称, 调用, 期望]：期望 'failed' = 必须明确失败；'any' = 只要不崩
  const cases = [
    ['tof=0', () => w.lunarAimPoint(c, 0, 111, {}), 'failed'],
    ['tof=300（<600）', () => w.lunarAimPoint(c, 300, 111, {}), 'failed'],
    ['tof=NaN', () => w.lunarAimPoint(c, NaN, 111, {}), 'failed'],
    ['tof=null', () => w.lunarAimPoint(c, null, 111, {}), 'failed'],
    ['v∞ 目标=5（不可达）', () => w.lunarAimPoint(c, 92 * 3600, 111, { targetVInf: 5, maxEvals: 16 }), 'failed'],
    ['近月点=-500 km（月面以下，非法）', () => w.lunarAimPoint(c, 92 * 3600, -500, { maxEvals: 16 }), 'failed'],
    ['近月点=5000 km（合法但高）', () => w.lunarAimPoint(c, 92 * 3600, 5000, { maxEvals: 40 }), 'any'],
    ['站点纬度 89.9°', () => w.lunarAimPoint(c, 92 * 3600, 111, { siteLat: 89.9, maxEvals: 40 }), 'any']
  ];
  for (const [name, fn, expect] of cases) {
    let res = null, threw = null;
    try { res = fn(); } catch (e) { threw = e; }
    const detail = threw ? '(抛异常: ' + threw.message + ')' : '(返回 ' + JSON.stringify(res && (res.failed || 'ok')) +
      (res && res.failed ? '' : ', peri=' + fmt(res && res.periAlt, 1)) + ')';
    check('T5 ' + name + '：不抛异常且返回对象', !threw && !!res && typeof res === 'object', detail);
    if (expect === 'failed') check('T5 ' + name + '：明确 failed', !!(res && res.failed), detail);
  }
})();

// ===========================================================================
// 真实 M2（地月转移）集成 —— 以 07-app.js 的**真实停车状态 + 真实 SIVB 质量**校准
// ---------------------------------------------------------------------------
// 复现 07-app.js buildScenario('parking')（M2：w.t=700，停车 183.2×185.9 km、
// i=32.521°）的真实模块与质量：S-IVB(106400) + LM_D(8200) + LM_A(3000) +
// SM(24000) + CM。比原 T2/T3 的"只有 SM"fixture 重 5.7 倍（172.8 t vs 30.2 t），
// 有限点火 T 也从 ~650 s（SPS）变成 ~390 s（S-IVB）—— 这才是"真实质量/TLI 半点"。
//
// 停车面的 RAAN 有两个候选（raanCandidates 给出、都含 t+96h 的月球方向）；07 用
// 两体兰伯特 Δv 排序。但 M2 的出发点恰好与月球方向成 **180°**，兰伯特在该退化点
// 返回 null（dnu=π ⇒ A=sin π·…=0），两个候选都失败 ⇒ 07 落到"第一个候选"
// （RAAN=187.896°，与浏览器实测一致）。两候选与月球轨道面的夹角：
//   cand0(187.896°) = 60.82°（07 实际用的，错）
//   cand1(359.340°) =  4.01°（= |32.521 − 28.52|，32.521° 倾角下能达到的最小夹角）
// 共面才是低成本转移：cand0 的到达 v∞ 里含 0.875 km/s 的离面分量 ⇒ v∞ 恒 > 0.90，
// 88~100 h 内物理上没有可行窗口；cand1 则能落进 0.83~0.90。
// 这组测试把"lunarAimPoint 本身没问题、问题在停车面"钉死成可复跑的断言。
// ===========================================================================
const M2T0 = 700;
const SITE0 = ctx.APL.SITE;                       // 发射场（含 parkingInclination）
function m2PlaneAngle(nPark, tRef) {
  const ms = A.moonState(tRef);
  const nMoon = V.unit(V.cross(ms.r, ms.v));
  return Math.acos(V.clamp(V.dot(V.unit(nPark), nMoon), -1, 1)) * 180 / Math.PI;
}
// 07 buildScenario('parking') 的停车状态 + 真实模块（raanIdx：0=07 实际选中，1=共面候选）
function m2ParkCraft(raanIdx) {
  const rp = RE + SITE0.parkingPerigee, ra = RE + SITE0.parkingApogee;
  const incP = SITE0.parkingInclination * M.D2R, tofP = 96 * 3600;
  const uArr = V.unit(A.moonState(M2T0 + tofP).r), rMid = (rp + ra) / 2;
  const raanP = M.raanCandidates(incP, uArr)[raanIdx];
  const nP = M.orbitNormal(incP, raanP);
  const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
  const rDep = V.mul(depP, -rMid);
  const vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(MUE / rMid));
  const w = newWorld(); w.t = M2T0;
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
// 在 t0+wait−shift 处建规划副本，tof 相应 +shift（**保持同一目标 tArr**，不改飞行器 r/v）
function m2Aim(raanIdx, tofH, shiftSec) {
  const tof = tofH * 3600, shift = shiftSec || 0;
  const { w, c } = m2ParkCraft(raanIdx);
  const cw = m2CoarseWait(c, tof);
  if (!cw) return { failed: 'coarse' };
  const tIgn = M2T0 + cw.wait - shift;
  const st = P.integrateSim(w, c.r, c.v, M2T0, tIgn);
  if (!st || !st.r) return { failed: 'coast' };
  const plan = new P.Craft({ id: 'PLAN', r: st.r, v: st.v, modules: c.modules, mode: 'prograde', primary: 'EARTH' });
  plan.stageIndex = c.stageIndex;
  const tSave = w.t; w.t = tIgn;
  let aim = null;
  try { aim = w.lunarAimPoint(plan, tof + shift, 111); } finally { w.t = tSave; }
  return aim || { failed: 'null' };
}

// ---------------------------------------------------------------- T6 停车面几何
(function testM2PlaneGeometry() {
  console.log('\n=== T6  真实 M2 停车面：07 候选退化 → 面偏 60.8°（根因，纯几何，快） ===');
  const rp = RE + SITE0.parkingPerigee, ra = RE + SITE0.parkingApogee;
  const incP = SITE0.parkingInclination * M.D2R, tofP = 96 * 3600;
  const uArr = V.unit(A.moonState(M2T0 + tofP).r), uMt = A.moonState(M2T0 + tofP).r, rMid = (rp + ra) / 2;
  // 07 排序用的兰伯特：出发点 rDep = −rMid·uArr 与月球方向正好 180° ⇒ 退化返回 null
  const deg = M.raanCandidates(incP, uArr).map(function (raanP) {
    const nP = M.orbitNormal(incP, raanP);
    const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
    const rDep = V.mul(depP, -rMid);
    const Lb = M.lambert(MUE, rDep, uMt, tofP, true);
    return { raan: raanP, ang: m2PlaneAngle(nP, M2T0 + tofP), lambertNull: !Lb };
  });
  console.log('   候选 RAAN=' + deg.map(d => fmt(d.raan * M.R2D, 3) + '°(面偏 ' + fmt(d.ang, 2) + '°)').join('  '));
  check('T6 两个 RAAN 候选的兰伯特都退化（180° 转移）→ 07 落到第一个',
    deg.length === 2 && deg[0].lambertNull && deg[1].lambertNull, '(null=' + deg.map(d => d.lambertNull).join(',') + ')');
  check('T6 07 实际选中 cand0 的面偏 ≈ 60.8°', Math.abs(deg[0].ang - 60.82) < 0.5, '(cand0=' + fmt(deg[0].ang, 2) + '°)');
  check('T6 共面候选 cand1 的面偏 ≈ 4.0°（32.521° 倾角下的最小值）',
    Math.abs(deg[1].ang - 4.01) < 0.5, '(cand1=' + fmt(deg[1].ang, 2) + '°)');
})();

// ------------------------------------------------- T7 共面停车面 + 真实 SIVB 质量
(function testM2CorrectPlane() {
  console.log('\n=== T7  真实 SIVB 质量 + 共面停车面（cand1）→ 收敛（tof=98h） ===');
  const { c } = m2ParkCraft(1);
  console.log('   模块=' + c.modules.map(m => m.id + '(' + m.prop + ')').join(' ') + '  m0=' + fmt(c.mass(), 0) + ' kg');
  check('T7 真实 SIVB 质量 ≈ 172.8 t（>150 t）', c.mass() > 150000 && c.mass() < 200000, '(m0=' + fmt(c.mass(), 0) + ' kg)');
  const t1 = Date.now();
  const aim = m2Aim(1, 98, 0);
  console.log('   求解用时 ' + (Date.now() - t1) + ' ms');
  arrivalChecks('T7', aim);
  if (aim && !aim.failed) structuralChecks('T7', aim);
})();

// ------------------------------------------------- T8 07 实际停车面 + 真实质量
let m2DemoBase = null;
(function testM2DemoPlane() {
  console.log('\n=== T8  07 实际停车面（cand0，面偏 60.8°）+ 真实 SIVB 质量 → 必须 failed ===');
  const t1 = Date.now();
  m2DemoBase = m2Aim(0, 96, 0);
  console.log('   tof=96h 求解用时 ' + (Date.now() - t1) + ' ms');
  const a = m2DemoBase;
  console.log('   结果：failed=' + (a && a.failed) + ' peri=' + fmt(a && a.periAlt, 2) +
    ' v∞=' + fmt(a && a.vInf, 4) + ' plane=' + fmt(a && a.planeDeg, 4) +
    ' corr=' + fmt(a && (a.smallCorrection ? a.smallCorrection.dv * 1000 : a.corr * 1000), 2) + ' m/s');
  check('T8 明确 failed（绝不放宽 v∞ 窗口糊过去）', !!(a && a.failed), '(failed=' + (a && a.failed) + ')');
  check('T8 v∞ 出窗（> 0.90，面偏导致）', !!(a && a.vInf > 0.90), '(v∞=' + fmt(a && a.vInf, 4) + ')');
  check('T8 近月点也出 111±20 km', !!(a && Math.abs((a.periAlt || a.peri) - 111) > 20),
    '(peri=' + fmt(a && (a.periAlt || a.peri), 2) + ')');
})();

// --------------------------------------- T9 ±halfT 候选构造（真实 SIVB 质量）
(function testM2HalfBurn() {
  console.log('\n=== T9  ±halfT 候选构造：点火提前 half（tof +half，tArr 不变） ===');
  const tof = 96 * 3600;
  const { c } = m2ParkCraft(0);
  const cw = m2CoarseWait(c, tof);
  const act = c.activeModule(), isp = c.ispNow(act.module), ve = isp * 9.80665 / 1000;
  const mdot = act.module.thrust / (isp * 9.80665), m0 = c.mass();
  const half = V.clamp((m0 - m0 / Math.exp(cw.dv / ve)) / mdot, 0.5, 3000) / 2;
  console.log('   粗扫 wait=' + fmt(cw.wait, 1) + 's  两体 Δv=' + fmt(cw.dv, 4) + '  估 half=' + fmt(half, 1) + 's');
  const early = m2Aim(0, 96, half);
  const b = m2DemoBase, e = early;
  const bp = b && (b.periAlt !== undefined ? b.periAlt : b.peri);
  const ep = e && (e.periAlt !== undefined ? e.periAlt : e.peri);
  console.log('   base(shift 0)   peri=' + fmt(bp, 2) + ' plane=' + fmt(b && b.planeDeg, 4) + ' v∞=' + fmt(b && b.vInf, 4));
  console.log('   提前 half        peri=' + fmt(ep, 2) + ' plane=' + fmt(e && e.planeDeg, 4) + ' v∞=' + fmt(e && e.vInf, 4));
  check('T9 提前 half 后 |peri−111| 明显变小（粗扫相位差 half 确实存在）',
    !!b && !!e && isFinite(bp) && isFinite(ep) && Math.abs(ep - 111) < Math.abs(bp - 111) - 20,
    '(|Δ| ' + fmt(Math.abs(bp - 111), 1) + ' → ' + fmt(Math.abs(ep - 111), 1) + ' km)');
  check('T9 但 v∞ 仍出窗 —— 相位差不是 M2 失败的根因，面偏才是',
    !!(b && b.vInf > 0.90) && !!(e && e.vInf > 0.90),
    '(v∞ ' + fmt(b && b.vInf, 4) + ' → ' + fmt(e && e.vInf, 4) + ')');
})();

// --------------------- T10 真实有限 TLI（startFiniteManeuver）能否打到 111 km
(function testM2FiniteTLI() {
  console.log('\n=== T10 真实有限 TLI：startFiniteManeuver（固定惯性方向 + 速度关机）打不到 111 ===');
  const tof = 98 * 3600;
  const { w, c } = m2ParkCraft(1);                 // 共面停车面 + 真实 SIVB 质量
  const cw = m2CoarseWait(c, tof);
  const tBurn0 = M2T0 + cw.wait;
  const st = P.integrateSim(w, c.r, c.v, M2T0, tBurn0);
  c.r = st.r.slice(); c.v = st.v.slice(); w.t = tBurn0; w.running = true; w.warp = 1;
  const plan = new P.Craft({ id: 'PLAN', r: st.r.slice(), v: st.v.slice(), modules: c.modules, mode: 'prograde', primary: 'EARTH' });
  plan.stageIndex = c.stageIndex;
  const aim = w.lunarAimPoint(plan, tof, 111);
  if (!aim || aim.failed) { check('T10 aim 收敛', false, '(failed=' + (aim && aim.failed) + ')'); return; }
  // ① 理想脉冲（在燃烧中心施加 vImp）—— 必须复现 aim
  const tB = w.t + aim.half;
  const preI = P.integrateSim(w, c.r, c.v, w.t, tB);
  const caI = P.integrateSim(w, preI.r, aim.cut.vImp, tB, tB + tof + 6 * 3600, { closest: true, stopKm: RM + 1, maxSteps: 400000 });
  const periI = caI ? caI.dist - RM : NaN;
  // ② 真实有限点火（burnTLI 的做法：固定惯性方向 + 速度关机）
  w.startFiniteManeuver(c, aim.orbit, { label: 'TLI', maxT: 1800, dir: V.sub(aim.cut.vImp, aim.cut.vPre) });
  let g = 0; while (c.burn && c.burn.active && g++ < 200000) w.advance(0.5);
  const bt = c.burn ? c.burn.t : 0, prop = c.burn ? (c.burn.propUsed || 0) : 0;
  const caF = P.integrateSim(w, c.r, c.v, w.t, w.t + tof + 6 * 3600, { closest: true, stopKm: RM + 1, maxSteps: 400000 });
  const periF = caF ? caF.dist - RM : NaN;
  console.log('   aim 预测=' + fmt(aim.periAlt, 2) + ' km | 理想脉冲=' + fmt(periI, 2) +
    ' km | 真实有限（燃烧 ' + fmt(bt, 1) + ' s，耗油 ' + fmt(prop, 0) + ' kg）=' + fmt(periF, 2) + ' km');
  check('T10 理想脉冲复现 aim（|Δ|<2 km）', Math.abs(periI - aim.periAlt) < 2,
    '(|Δ|=' + fmt(Math.abs(periI - aim.periAlt), 3) + ' km)');
  check('T10 真实有限 TLI 达不到 111±20 km（固定方向 + 速度关机的固有偏差；startFiniteManeuver 未闭环）',
    isFinite(periF) && Math.abs(periF - 111) > 20, '(peri=' + fmt(periF, 1) + ' km)');
})();

console.log('\n===== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);