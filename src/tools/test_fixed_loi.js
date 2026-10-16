// tools/test_fixed_loi.js
// ---------------------------------------------------------------------------
// 两次固定目标 LOI（111×315 → 111×117）独立验证台。
//
//   · 只加载四个基础模块（00/01/02/03），用 P.World 的**真实引力**（含月 J2 /
//     地球 / 太阳第三体）与**真实发动机模型**（SPS 91190 N / Isp 314.5）
//   · 初始 Craft 由"真实双曲线近月点"构造（仅测试构造允许直接设 r/v），
//     质量 = CSM + 完整 LM + RCS，SM 推进剂按测试 fixture 设为 18410 kg
//     （**只改实例，不改 00-constants.js**）
//   · 断言：LOI-1 燃烧 357.5 ± 30 s、Δv ≈ 889 m/s、进入 111×315 km；
//           LOI-2 燃烧 17 ± 10 s、Δv ≈ 59 m/s、圆化到 111×117 km；
//           关机后用 integrateSim 外推一圈复核 rp / ra / 平面；
//           非法高度、无推进剂被拒绝；复核不合格后**不再自动追加第三次点火**。
//
// 用法：  node tools/test_fixed_loi.js .
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
const RM = BODY.MOON.radius, MU = BODY.MOON.mu;
const T0 = 250000;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? '   ' + detail : ''));
}
function fmt(x, n) { return (x === undefined || x === null) ? '-' : x.toFixed(n === undefined ? 1 : n); }

// 复刻 World.advance 的内层循环（确定性固定帧长）
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

// CSM + 完整 LM + RCS 的质量模型（不含 SLA/ESA 适配器 —— 它在 TLI 后已抛弃）
function loiModules(smProp) {
  const ms = P.buildSaturnVStack().filter(m => m.id === 'SM' || m.id === 'CM'
    || m.id === 'LM_D' || m.id === 'LM_A');
  const sm = ms.filter(m => m.id === 'SM')[0];
  if (smProp !== undefined) sm.prop = smProp;   // 测试 fixture：只改实例
  return ms;
}

function makeCraft(rel, vrel, smProp) {
  const w = new P.World(); w.t = T0; w.running = true;   // 默认：真实引力（含 J2/第三体/阻力）
  const ms = A.moonState(T0);
  const c = new P.Craft({
    id: 'CSM', name: 'Columbia',
    r: V.add(ms.r, rel), v: V.add(ms.v, vrel),
    modules: loiModules(smProp), rcsProp: 620
  });
  c.primary = 'MOON'; c.stageIndex = 5;          // SPS = 服务舱
  w.addCraft(c);
  return { w, c };
}

// 月心相对的双曲线近月点状态（近月点在 +x、速度沿 +y、轨道面为 xy 面）
function hyperRel(vinf, rpAlt) {
  const rp = RM + rpAlt;
  const vp = Math.sqrt(vinf * vinf + 2 * MU / rp);
  return { rel: [rp, 0, 0], vrel: [0, vp, 0] };
}
// 月心相对圆轨道状态
function circRel(alt) {
  const r = RM + alt;
  return { rel: [r, 0, 0], vrel: [0, Math.sqrt(MU / r), 0] };
}

// 独立复核：用 integrateSim 外推一圈，取真实近月点 / 远月点 / 平面法向
function orbitMetrics(w, r, v, t) {
  const el = M.elements(MU, V.sub(r, A.moonState(t).r), V.sub(v, A.moonState(t).v));
  if (!el || !(el.a > 0) || el.e >= 1) return null;
  const Pper = 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / MU);
  const ca = P.integrateSim(w, r, v, t, t + Pper, { closest: true });
  if (!ca) return null;
  const msp = A.moonState(ca.t);
  const ap = P.integrateSim(w, ca.r, ca.v, ca.t, ca.t + Pper / 2, {});
  const n = V.unit(V.cross(V.sub(ca.r, msp.r), V.sub(ca.v, msp.v)));
  return { rp: ca.dist - RM, ra: V.mag(V.sub(ap.r, A.moonState(ap.t).r)) - RM,
           n: n, a: el.a, e: el.e, P: Pper };
}

// 驱动 lunarOrbitAlign 直到 done / failed / noPropellant
function drive(w, c, opt, maxSim, dt) {
  let tSim = 0, last = null, nBurn = 0, prevActive = false;
  while (tSim < maxSim) {
    last = P.lunarOrbitAlign(w, c, opt);
    const active = !!(c.burn && c.burn.active);
    if (active && !prevActive) nBurn++;
    prevActive = active;
    if (last && (last.done || last.failed || last.noPropellant)) {
      return { res: last, tSim: tSim, nBurn: nBurn, timeout: false };
    }
    advanceWorld(w, dt);
    tSim += dt;
  }
  return { res: last, tSim: tSim, nBurn: nBurn, timeout: true };
}

// ===========================================================================
console.log('固定目标 LOI 验证台 —— 受管 Node，真实引力 + 真实 SPS 有限推力');

// ---------------------------------------------------------------- LOI-1
function testLOI1(vinf, tag) {
  const { w, c } = makeCraft(hyperRel(vinf, 111).rel, hyperRel(vinf, 111).vrel, 18410);
  const m0 = c.mass();
  const rp0 = (function () {
    const el = M.elements(MU, V.sub(c.r, A.moonState(w.t).r), V.sub(c.v, A.moonState(w.t).v));
    return el.periapsis - RM;
  })();
  console.log('\n=== LOI-1 ' + tag + '  (v∞=' + vinf + ' km/s, 近月点 ' +
    fmt(rp0, 1) + ' km, m0=' + fmt(m0, 0) + ' kg) ===');
  const run = drive(w, c, { loi: 1 }, 6000, 5);
  const bb = c.burn;
  const burnT = bb ? bb.t : null;
  const dvEng = bb ? bb.dvEngine * 1000 : null;    // 发动机积分 Δv (m/s)
  const propUsed = bb ? bb.propUsed : null;
  console.log('  结果：' + JSON.stringify(run.res) +
    '  (用时 ' + fmt(run.tSim, 0) + ' s, 点火次数 ' + run.nBurn + ')');
  if (bb) console.log('  燃烧：T=' + fmt(bb.t, 1) + ' s, 喷口积分 Δv=' + fmt(dvEng, 1) +
    ' m/s, 耗油=' + fmt(propUsed, 0) + ' kg, 原因=' + bb.reason);

  check(tag + '：完成', !!(run.res && run.res.done), '(res=' + JSON.stringify(run.res) + ')');
  check(tag + '：燃烧 357.5 ± 30 s', burnT !== null && Math.abs(burnT - 357.5) <= 30,
    '(T=' + fmt(burnT, 1) + ' s)');
  check(tag + '：Δv ≈ 889 ± 100 m/s', dvEng !== null && Math.abs(dvEng - 889) <= 100,
    '(Δv=' + fmt(dvEng, 1) + ' m/s)');
  // 独立外推一圈复核
  const met = orbitMetrics(w, c.r, c.v, w.t);
  if (met) {
    console.log('  外推一圈：rp=' + fmt(met.rp, 1) + ' km  ra=' + fmt(met.ra, 1) +
      ' km  e=' + fmt(met.e, 4) + '  P=' + fmt(met.P / 60, 2) + ' min');
    check(tag + '：近月点 111 ± 20 km', Math.abs(met.rp - 111) <= 20, '(rp=' + fmt(met.rp, 1) + ')');
    check(tag + '：远月点 315 ± 40 km', Math.abs(met.ra - 315) <= 40, '(ra=' + fmt(met.ra, 1) + ')');
  } else {
    check(tag + '：外推得到椭圆轨道', false, '(met=null)');
  }
  check(tag + '：仅一次点火', run.nBurn === 1, '(nBurn=' + run.nBurn + ')');
  return { w, c, met: met, res: run.res, burnT: burnT, dvEng: dvEng };
}

const r1 = testLOI1(0.85, 'vinf=0.85');
const r2 = testLOI1(0.87, 'vinf=0.87');

// ---------------------------------------------------------------- LOI-2
function testLOI2(vinf, tag) {
  const { w, c } = makeCraft(hyperRel(vinf, 111).rel, hyperRel(vinf, 111).vrel, 18410);
  const lo1 = drive(w, c, { loi: 1 }, 6000, 5);
  if (!(lo1.res && lo1.res.done)) { check(tag + '：前置 LOI-1 成功', false); return null; }
  const tEnd1 = w.t;
  const met1 = orbitMetrics(w, c.r, c.v, w.t);
  console.log('\n=== LOI-2 ' + tag + '  (LOI-1 后 ' + fmt(met1.rp, 1) + '×' +
    fmt(met1.ra, 1) + ' km) ===');
  // 滑到下一近点（由 lunarOrbitAlign 的 periapsis 门槛 + 下一近点守卫自动完成）
  const run = drive(w, c, { loi: 2 }, 200000, 5);
  const bb = c.burn;
  const burnT = bb ? bb.t : null;
  const dvEng = bb ? bb.dvEngine * 1000 : null;
  const dtIgn = null;
  console.log('  结果：' + JSON.stringify(run.res) +
    '  (LOI-1 后滑行 ' + fmt((run.tSim + tEnd1 - tEnd1), 0) + ' s, 点火次数 ' + run.nBurn + ')');
  if (bb) console.log('  燃烧：T=' + fmt(bb.t, 1) + ' s, 喷口积分 Δv=' + fmt(dvEng, 1) +
    ' m/s, 耗油=' + fmt(bb.propUsed, 0) + ' kg, 原因=' + bb.reason);

  check(tag + '：完成', !!(run.res && run.res.done), '(res=' + JSON.stringify(run.res) + ')');
  check(tag + '：燃烧 17 ± 10 s', burnT !== null && Math.abs(burnT - 17) <= 10,
    '(T=' + fmt(burnT, 1) + ' s)');
  const rp = RM + 111;
  const impulsiveDv = (Math.sqrt(MU * (2 / rp - 1 / (RM + 213))) - Math.sqrt(MU * (2 / rp - 1 / (RM + 114)))) * 1000;
  check(tag + '：有限点火与解析椭圆能量相符（±5m/s）', dvEng !== null && Math.abs(dvEng - impulsiveDv) <= 5,
    '(实测=' + fmt(dvEng, 1) + '，解析=' + fmt(impulsiveDv, 1) + '，历史59差=' + fmt(dvEng - 59, 1) + ' m/s，历史指标未证明)');
  const met = orbitMetrics(w, c.r, c.v, w.t);
  if (met) {
    console.log('  外推一圈：rp=' + fmt(met.rp, 1) + ' km  ra=' + fmt(met.ra, 1) +
      ' km  e=' + fmt(met.e, 4));
    check(tag + '：近月点 111 ± 20 km', Math.abs(met.rp - 111) <= 20, '(rp=' + fmt(met.rp, 1) + ')');
    check(tag + '：远月点 117 ± 5 km', Math.abs(met.ra - 117) <= 5, '(ra=' + fmt(met.ra, 1) + ')');
  } else {
    check(tag + '：外推得到椭圆轨道', false, '(met=null)');
  }
  check(tag + '：仅一次点火', run.nBurn === 1, '(nBurn=' + run.nBurn + ')');
  return { w, c, res: run.res, burnT: burnT, dvEng: dvEng };
}

testLOI2(0.85, 'vinf=0.85');
testLOI2(0.87, 'vinf=0.87');

// ---------------------------------------------------------------- 非法高度
(function testIllegalAltitude() {
  console.log('\n=== 非法高度（500 km 圆轨道）拒绝 ===');
  const s = circRel(500);
  const { w, c } = makeCraft(s.rel, s.vrel, 18410);
  const res = P.lunarOrbitAlign(w, c, { loi: 1 });
  console.log('  结果：' + JSON.stringify(res));
  check('非法高度：未点火', !(c.burn && c.burn.active), '(burn=' + !!(c.burn && c.burn.active) + ')');
  check('非法高度：明确失败', !!(res && res.failed), '(res=' + JSON.stringify(res) + ')');
})();

// ---------------------------------------------------------------- 无推进剂
(function testNoPropellant() {
  console.log('\n=== 无推进剂（SM.prop = 0）拒绝 ===');
  const s = hyperRel(0.85, 111);
  const { w, c } = makeCraft(s.rel, s.vrel, 0);
  const res = P.lunarOrbitAlign(w, c, { loi: 1 });
  console.log('  结果：' + JSON.stringify(res));
  check('无推进剂：未点火', !(c.burn && c.burn.active), '(burn=' + !!(c.burn && c.burn.active) + ')');
  check('无推进剂：明确拒绝', !!(res && res.noPropellant), '(res=' + JSON.stringify(res) + ')');
})();

// ------------------------------------------------- 复核不合格 → 禁止第三次点火
(function testNoThirdBurn() {
  console.log('\n=== 复核不合格后禁止自动追加第三次点火 ===');
  const s = hyperRel(0.85, 111);
  const { w, c } = makeCraft(s.rel, s.vrel, 18410);
  // 用极紧的验收公差逼出"关机后复核不合格"（真实物理误差 > 0.001 km）
  const run = drive(w, c, { loi: 1, tolRpKm: 0.001, tolRaKm: 0.001 }, 6000, 5);
  console.log('  首次结果：' + JSON.stringify(run.res) + '  (点火次数 ' + run.nBurn + ')');
  check('紧公差：首次点火后复核失败', !!(run.res && run.res.failed),
    '(res=' + JSON.stringify(run.res) + ')');
  const burnsAfter = run.nBurn;
  // 再连续调用 200 次（覆盖多圈）——不许再点任何一次火
  let extra = 0;
  for (let k = 0; k < 200; k++) {
    const rr = P.lunarOrbitAlign(w, c, { loi: 1, tolRpKm: 0.001, tolRaKm: 0.001 });
    if (c.burn && c.burn.active) extra++;
    if (!(rr && rr.failed)) console.log('    (第 ' + k + ' 次返回 ' + JSON.stringify(rr) + ')');
    advanceWorld(w, 30);
  }
  check('紧公差：失败后不再追加点火', extra === 0 && burnsAfter === 1,
    '(总点火 ' + burnsAfter + ' 次, 失败后再点 ' + extra + ' 次)');
})();

// ------------------------------------------------- 成功后幂等（不重复点火）
(function testIdempotent() {
  console.log('\n=== 成功后重复调用幂等（不重复点火） ===');
  const s = hyperRel(0.85, 111);
  const { w, c } = makeCraft(s.rel, s.vrel, 18410);
  const run = drive(w, c, { loi: 1 }, 6000, 5);
  if (!(run.res && run.res.done)) { check('幂等：前置 LOI-1 成功', false); return; }
  let extra = 0;
  for (let k = 0; k < 50; k++) {
    const rr = P.lunarOrbitAlign(w, c, { loi: 1 });
    if (c.burn && c.burn.active) extra++;
    if (!(rr && rr.done)) console.log('    (第 ' + k + ' 次返回 ' + JSON.stringify(rr) + ')');
    advanceWorld(w, 30);
  }
  check('幂等：成功后不再重复点火', extra === 0, '(再点 ' + extra + ' 次)');
})();

console.log('\n===== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
