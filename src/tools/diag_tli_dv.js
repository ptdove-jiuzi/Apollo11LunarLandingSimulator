// tools/diag_tli_dv.js
// ---------------------------------------------------------------------------
// 判定 TLI Δv 的四个数字哪个是对的（AGENT_HANDOFF/09 §5 盲区 2）：
//   aim.dv = 3680 m/s（lunarAimPoint 的脉冲解）
//   两体兰伯特（瞄月心）= 3204 m/s
//   有限点火实收（弦长）= 3319 m/s
//   文档目标 = 3050 m/s
//
// 思路：把 aim 解出来的 (pre.v, v1) 直接摊开看 ——
//   · |v1|、|pre.v|、两者夹角 → 反推 C3、地心轨道类型、到达月球 SOI 的时间
//   · lunarAimError 报出的真近月点时刻 t 与 tArr 的差 → 转移到底多长
//   · 再单独算一条"不含到达面约束"的兰伯特，看平面约束值多少 m/s
//
// 用法： node tools/diag_tli_dv.js .
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
const RE = BODY.EARTH.radius, MUE = BODY.EARTH.mu, MUM = BODY.MOON.mu, RM = BODY.MOON.radius;
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

// 粗扫 wait（每 1/25 圈）
function coarseWait() {
  const el = M.elements(MUE, rDep, vDep);
  const period = 2 * Math.PI * Math.sqrt(el.a ** 3 / MUE);
  let best = null;
  for (let k = 0; k <= 120; k++) {
    const wait = k * period / 25;
    const st1 = M.propagate(MUE, rDep, vDep, wait);
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
console.log('t_ign = ' + fmt(tIgn, 3) + ' s   tof = ' + (TOF / 3600) + ' h   tArr = ' + fmt(tIgn + TOF, 1) + ' s\n');

// 实飞态（精确停）
const w = new P.World(); w.t = M2T0; w.warp = 2000; w.running = true;
const c = new P.Craft({ id: 'CSM', r: rDep.slice(), v: vDep.slice(), modules: mods(), mode: 'prograde' });
c.stageIndex = 2; w.addCraft(c);
w._advanceStopAt = tIgn;
let g = 0; while (w.t < tIgn && g++ < 200000) w.advance(1 / 60);
console.log('实飞态 t=' + fmt(w.t, 6) + '  r=' + c.r.map(x => fmt(x, 1)).join(',') + '  |v|=' + fmt(V.mag(c.v), 6));

const aim = w.lunarAimPoint(c, TOF, 111);
if (!aim || aim.failed) { console.log('aim 失败：' + (aim && aim.failed)); process.exit(1); }

const muE = MUE;
const rel0 = V.sub(c.r, w.primaryPos('EARTH'));
const vrel0 = V.sub(c.v, w.primaryVel('EARTH'));
const preV = aim.cut.vPre, v1 = aim.v1;
const dvVec = V.sub(v1, preV);
const dv = V.mag(dvVec);
const ang = Math.acos(V.clamp(V.dot(V.unit(v1), V.unit(preV)), -1, 1)) * 180 / Math.PI;
const vEsc = Math.sqrt(2 * muE / V.mag(aim.rImp));
const C3 = V.dot(v1, v1) - 2 * muE / V.mag(aim.rImp);

console.log('\n=== ① 脉冲解的速度账 ===');
console.log('  脉冲点 |r| = ' + fmt(V.mag(aim.rImp), 1) + ' km（高度 ' + fmt(V.mag(aim.rImp) - RE, 1) + ' km）');
console.log('  点火前 |v| = ' + fmt(V.mag(preV), 6) + ' km/s');
console.log('  点火后 |v1| = ' + fmt(V.mag(v1), 6) + ' km/s');
console.log('  |Δv| = ' + fmt(dv * 1000, 1) + ' m/s   方向与点火前速度夹角 = ' + fmt(ang, 3) + '°');
console.log('  该半径逃逸速度 = ' + fmt(vEsc, 6) + ' km/s   ⇒ C3 = ' + fmt(C3, 3) + ' km²/s²'
  + (C3 > 0 ? '（**地心双曲线，会逃逸**）' : '（地心椭圆）'));
console.log('  dvEst（瞄月心的两体兰伯特）= ' + fmt(cw.dv * 1000, 0) + ' m/s  v∞E = ' + fmt(cw.vInfE, 4));

// === ② 转移到底多长：aim 解出来的真近月点时刻 ===
const siteDir = V.unit(V.sub(A.moonSurfacePoint(aim.tArr, LSITE.lat, LSITE.lon, 0).r, A.moonState(aim.tArr).r));
const aerr = P.lunarAimError(w, aim.rImp, v1, aim.cut.tImp, aim.tArr + 6 * 3600, 111,
  LSITE.lat, LSITE.lon, siteDir);
console.log('\n=== ② 转移时长（用同一套引力实积分到真近月点） ===');
if (aerr) {
  console.log('  真近月点高度 = ' + fmt(aerr.peri, 2) + ' km   到达面 = ' + fmt(aerr.planeDeg, 4)
    + '°   v∞ = ' + fmt(aerr.vInf, 4));
  console.log('  真近月点时刻 t = ' + fmt(aerr.t, 1) + ' s   tArr = ' + fmt(aim.tArr, 1)
    + ' s   ⇒ 实际转移 ' + fmt((aerr.t - tIgn) / 3600, 2) + ' h（设计 tof = ' + (TOF / 3600) + ' h）');
  console.log('  t - tArr = ' + fmt(aerr.t - aim.tArr, 1) + ' s');
} else console.log('  lunarAimError 返回 null');

// === ③ 平面约束值多少：兰伯特瞄"月心"（无面约束）vs 瞄"含站点的到达面" ===
console.log('\n=== ③ 到达面约束的代价 ===');
const Lc = M.lambert(muE, rel0, A.moonState(tIgn + TOF).r, TOF, true);
if (Lc) {
  const vArrC = V.sub(Lc.v2, A.moonState(tIgn + TOF).v);
  const periC = 2 * MUM / V.dot(vArrC, vArrC) * 0;   // 占位
  console.log('  瞄月心兰伯特：Δv = ' + fmt(V.mag(V.sub(Lc.v1, vrel0)) * 1000, 0) + ' m/s，v∞ = '
    + fmt(V.mag(vArrC), 4) + ' km/s（无到达面约束）');
}
console.log('  aim（含"到达面包含着陆点"约束）：Δv = ' + fmt(dv * 1000, 0) + ' m/s，v∞ = ' + fmt(aim.vInf, 4));
console.log('  ⇒ 面约束代价 ≈ ' + fmt((dv - cw.dv) * 1000, 0) + ' m/s（= 3708 与 3204 之差）');

// === ④ 站点方向 vs 月球赤道：判断到达面是否"天然"含站点 ===
console.log('\n=== ④ 几何背景 ===');
const ms = A.moonState(aim.tArr);
console.log('  着陆点纬度 ' + LSITE.lat + '°，经度 ' + LSITE.lon + '°（几乎在月赤道上）');
console.log('  月球轨道面法向 = ' + V.unit(V.cross(ms.r, ms.v)).map(x => fmt(x, 4)).join(','));
console.log('  站点方向（月心系）= ' + siteDir.map(x => fmt(x, 4)).join(','));
console.log('  停车轨道面法向 = ' + V.unit(V.cross(rel0, vrel0)).map(x => fmt(x, 4)).join(','));
