// tools/diag_coast_fidelity.js
// ---------------------------------------------------------------------------
// 量化滑行段的"块截断"误差：同样从 TLI 关机状态出发，
//   A) integrateSim（打靶/验证用的积分器，步长 = stepForAlt）
//   B) advance(1/60) × warp 50000（演示滑行段的真实驱动方式，块边界会把步长夹到 remain）
// 比较到达月球附近的真近月点。若 B 与 A 差上百 km，就说明滑行段也必须用
// 引擎自然步长驱动（或把 warp 降到让块远小于自然步长）。
//
// 用法： node tools/diag_coast_fidelity.js .
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
const D2R = Math.PI / 180;

const M2T0 = 700, TOF = 100 * 3600;
const rp = RE + SITE.parkingPerigee, ra = RE + SITE.parkingApogee;
const incP = SITE.parkingInclination * D2R, tofP = 96 * 3600;
const uArr = V.unit(A.moonState(M2T0 + tofP).r), rMid = (rp + ra) / 2;
const raanP = M.raanCandidates(incP, uArr)[1];
const nP = M.orbitNormal(incP, raanP);
const depP = V.unit(V.sub(uArr, V.mul(nP, V.dot(uArr, nP))));
const rDep = V.mul(depP, -rMid);
const vDep = V.mul(V.unit(V.cross(nP, rDep)), Math.sqrt(MUE / rMid));
const mods = () => P.buildSaturnVStack().filter(m => m.stage >= 2 && m.id !== 'S-IC' && m.id !== 'S-II' && m.id !== 'ESA');

// 粗扫 wait
const el0 = M.elements(MUE, rDep, vDep);
const period = 2 * Math.PI * Math.sqrt(el0.a ** 3 / MUE);
let best = null;
for (let k = 0; k <= 120; k++) {
  const wait = k * period / 25;
  const st1 = M.propagate(MUE, rDep, vDep, wait);
  const tg = A.moonState(M2T0 + wait + TOF);
  const Lb = M.lambert(MUE, st1.r, tg.r, TOF, true);
  if (!Lb) continue;
  const score = V.mag(V.sub(Lb.v1, st1.v)) + Math.abs(V.mag(V.sub(Lb.v2, tg.v)) - 0.87);
  if (!best || score < best.score) best = { wait, score };
}
const tIgn = M2T0 + best.wait;
console.log('t_ign = ' + fmt(tIgn, 3) + ' s   tof = ' + (TOF / 3600) + ' h\n');

// 实飞态（精确停）
const w = new P.World(); w.t = M2T0; w.warp = 2000; w.running = true;
const c = new P.Craft({ id: 'CSM', r: rDep.slice(), v: vDep.slice(), modules: mods(), mode: 'prograde' });
c.stageIndex = 2; w.addCraft(c);
w._advanceStopAt = tIgn;
let g = 0; while (w.t < tIgn && g++ < 200000) w.advance(1 / 60);
w._advanceStopAt = null;

const aim = w.lunarAimPoint(c, TOF, 111);
if (!aim || aim.failed) { console.log('aim 失败 ' + (aim && aim.failed)); process.exit(1); }
console.log('aim：peri=' + fmt(aim.periAlt, 2) + ' km  plane=' + fmt(aim.planeDeg, 4)
  + '°  v∞=' + fmt(aim.vInf, 4) + '  dv=' + fmt(aim.dv * 1000, 0) + ' m/s');

const res = w.startLunarTransfer(c, aim);
if (!res || !res.ok) { console.log('startLunarTransfer 失败 ' + (res && res.failed)); process.exit(1); }
console.log('打靶：T=' + fmt(res.T, 2) + ' s  peri=' + fmt(res.periAlt, 2) + ' km  plane='
  + fmt(res.planeDeg, 4) + '°  v∞=' + fmt(res.vInf, 4) + '  corrEq=' + fmt(res.corrEq * 1000, 2) + ' m/s');

// ---- A) 预测弧：finiteBurnArc（startLunarTransfer 内部已经算过，用 res.arc）----
const arc = res.arc;
console.log('\n=== 关机状态同构性 ===');
console.log('  预测弧关机 t=' + fmt(arc.t, 3) + '  r=' + arc.r.map(x => fmt(x, 1)).join(',')
  + '  |v|=' + fmt(V.mag(arc.v), 6));

// ---- B) 实飞：引擎自然步长 ----
w.advanceBurnToEnd(c);
console.log('  实飞关机   t=' + fmt(w.t, 3) + '  r=' + c.r.map(x => fmt(x, 1)).join(',')
  + '  |v|=' + fmt(V.mag(c.v), 6) + '  步数=' + (c.burn ? c.burn.steps : '?'));
// 引擎会多走一个"无推力滑行步"，把预测弧滑到同一时刻再比
const stSame = P.integrateSim(w, arc.r, arc.v, arc.t, w.t, {});
console.log('  |Δr| = ' + fmt(V.dist(c.r, stSame.r), 6) + ' km   |Δv| = '
  + fmt(V.mag(V.sub(c.v, stSame.v)) * 1000, 6) + ' m/s   （应≈0）');

// ---- 两条滑行路径 ----
const siteDir = V.unit(V.sub(A.moonSurfacePoint(aim.tArr, LSITE.lat, LSITE.lon, 0).r, A.moonState(aim.tArr).r));
const r0 = c.r.slice(), v0 = c.v.slice(), t0 = w.t;
const tEnd = aim.tArr + 6 * 3600;

console.log('\n=== 滑行到月球：A) integrateSim（验证用） ===');
const tA = Date.now();
const caA = P.integrateSim(w, r0, v0, t0, tEnd, { closest: true, stopKm: RM + 1, maxSteps: 600000 });
const aerrA = P.lunarAimError(w, r0, v0, t0, tEnd, 111, LSITE.lat, LSITE.lon, siteDir);
console.log('  用时 ' + ((Date.now() - tA) / 1000).toFixed(1) + ' s  真近月点 = '
  + fmt(caA && caA.dist - RM, 2) + ' km   t=' + fmt(caA && caA.t, 1)
  + '   plane=' + fmt(aerrA && aerrA.planeDeg, 4) + '°  v∞=' + fmt(aerrA && aerrA.vInf, 4));

console.log('\n=== 滑行到月球：B) advance(1/60) × warp 50000（演示真实驱动） ===');
for (const warp of [50000, 5000, 500]) {
  const w2 = new P.World(); w2.t = t0; w2.warp = warp; w2.running = true;
  const c2 = new P.Craft({ id: 'CSM', r: r0.slice(), v: v0.slice(), modules: mods(), mode: 'prograde' });
  c2.stageIndex = 5; w2.addCraft(c2);
  const tB = Date.now();
  let frames = 0;
  while (w2.t < tEnd && frames < 600000) { w2.advance(1 / 60); frames++; }
  const caB = P.integrateSim(w2, c2.r, c2.v, w2.t, tEnd, { closest: true, stopKm: RM + 1, maxSteps: 600000 });
  const aerrB = P.lunarAimError(w2, c2.r, c2.v, w2.t, tEnd, 111, LSITE.lat, LSITE.lon, siteDir);
  console.log('  warp=' + warp + '：' + frames + ' 帧，' + ((Date.now() - tB) / 1000).toFixed(1)
    + ' s，滑到 t=' + fmt(w2.t, 0) + ' s   |Δr| vs A = ' + fmt(V.dist(c2.r, caA ? caA.r : c2.r), 2)
    + ' km   |Δv| = ' + fmt(V.mag(V.sub(c2.v, caA ? caA.v : c2.v)) * 1000, 2) + ' m/s');
  console.log('       ⇒ 真近月点 = ' + fmt(caB && caB.dist - RM, 2) + ' km（A 为 '
    + fmt(caA && caA.dist - RM, 2) + ' km，差 ' + fmt((caB && caB.dist - RM) - (caA && caA.dist - RM), 2)
    + ' km）  plane=' + fmt(aerrB && aerrB.planeDeg, 4) + '°  v∞=' + fmt(aerrB && aerrB.vInf, 4));
}
