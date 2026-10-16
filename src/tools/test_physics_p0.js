// P0 物理修复验收（对照「错误需要修改/03-修改边界与验收.md」的条款）
//   T1 地心自洽：r=0 处总引力必须 ≈ 0（缺间接项时是 ~3.3e-8 km/s² 的虚假加速度）
//   T2 月球项方向：近月侧指向月球；地心两侧呈潮汐反号
//   T3 300 km 圆轨道跑一天：位置偏差应从中等百公里级降到个位数 km
//   T4 再入伞：主伞低空平衡速度 8~10 m/s，峰值过载不得出现数百 g
//   T5 太阳速度：|v|≈29.8 km/s，且与位置中心差分一致
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const ctx = { console, Math, isFinite, Number, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, 'apollo11', 'webdata', 'js', f), 'utf8'), ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY } = ctx.APL;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '   ' + detail : ''));
}
const T0 = 250000;   // 任意历元

console.log('\n=== T1 地心自洽（间接项）===');
const w = new P.World(); w.t = T0;
w.gravityModel = { earthJ2: false, moonJ2: false, sun: false, drag: false };
// 地心是地球项的奇点，取"距地心 1 km"的测试点；月球项用"全量 − 地球项"分离
const eps = [1, 0, 0];
const ms0 = A.moonState(T0);
function earthPure(r) {
  const rr = V.mag(r), f = -BODY.EARTH.mu / (rr * rr * rr);
  return [r[0] * f, r[1] * f, r[2] * f];
}
const a0m = V.mag(V.sub(w.gravity(T0, eps), earthPure(eps)));
const oldTerm = V.mul(ms0.r, BODY.MOON.mu / Math.pow(V.mag(ms0.r), 3));
console.log('  |月球项(距地心 1 km)| = ' + a0m.toExponential(3) + ' km/s²');
console.log('  缺间接项时会出现的虚假加速度 |μ_m·r_m/|r_m|³| = ' +
  V.mag(oldTerm).toExponential(3) + ' km/s²');
check('地心附近月球项只剩潮汐量级（≈2μ_m·r/R³ = ' +
  (2 * BODY.MOON.mu * 1 / Math.pow(V.mag(ms0.r), 3)).toExponential(1) + '）',
  a0m < 1e-12, '(实测 ' + a0m.toExponential(2) + ')');
check('虚假加速度已消除', a0m / V.mag(oldTerm) < 1e-3,
  '(残余占比 ' + (a0m / V.mag(oldTerm)).toExponential(1) + ')');

console.log('\n=== T2 月球项方向（潮汐特征）===');
const dmDir = V.unit(ms0.r);
const R = V.mag(ms0.r);
const near = V.mul(dmDir, 7000);            // 地月连线靠月一侧
const far = V.mul(dmDir, -7000);            // 背月一侧
const gNear = w.gravity(T0, near), gFar = w.gravity(T0, far);
// 只看月球贡献：减去地球 μ 项（世界已把 earthJ2 关掉，参考项就用 earthPure）
const moonNear = V.sub(gNear, earthPure(near));
const moonFar = V.sub(gFar, earthPure(far));
// 潮汐特征要沿"地月连线方向"投影：靠月侧被拉向月球（+），背月侧被推开（−）
const nNear = V.dot(moonNear, dmDir), nFar = V.dot(moonFar, dmDir);
console.log('  月球项·沿地月连线（靠月侧） = ' + (nNear * 1e9).toFixed(3) + ' e-9 km/s²');
console.log('  月球项·沿地月连线（背月侧） = ' + (nFar * 1e9).toFixed(3) + ' e-9 km/s²');
check('靠月侧被拉向月球', nNear > 0);
check('背月侧被推开', nFar < 0);
const tidalTheory = 2 * BODY.MOON.mu * 7000 / Math.pow(R, 3);
check('|靠月侧| 与理论 2μ_m·r/R³ 相符（±15%）',
  Math.abs(Math.abs(nNear) / tidalTheory - 1) < 0.15,
  '(' + (Math.abs(nNear) / tidalTheory).toFixed(3) + ' × 理论)');
check('两侧差 ≈ 4μ_m·r/R³',
  Math.abs((nNear - nFar) / (2 * tidalTheory) - 1) < 0.15,
  '(' + ((nNear - nFar) / (2 * tidalTheory)).toFixed(3) + ' × 理论)');

console.log('\n=== T3 300 km 圆轨道跑 3 天（259200 s，10 s 步长）===');
function runOrbitDay(mode) {
  const w2 = new P.World(); w2.t = T0; w2.running = true;
  w2.gravityModel = { earthJ2: false, moonJ2: false, sun: false, drag: false };
  const muE = BODY.EARTH.mu, r0 = BODY.EARTH.radius + 300;
  const vc = Math.sqrt(muE / r0);
  const mods = P.buildSaturnVStack().filter(m => m.id === 'CM');
  const c = new P.Craft({ id: 'X', r: [r0, 0, 0], v: [0, vc, 0], modules: mods, mode: 'prograde' });
  c.primary = 'EARTH';
  if (mode === 'old') {
    // 旧公式：只有直接项（缺 -μ_m r_m/|r_m|³）
    w2.gravity = function (t, r) {
      const rr = V.mag(r), f = -BODY.EARTH.mu / (rr * rr * rr);
      let a = [r[0] * f, r[1] * f, r[2] * f];
      const ms = A.moonState(t);
      const dm = V.sub(ms.r, r), dmm = V.mag(dm);
      a = V.scaleAdd(a, dm, BODY.MOON.mu / (dmm * dmm * dmm));
      return a;
    };
  } else if (mode === 'none') {
    w2.gravity = function (t, r) {
      const rr = V.mag(r), f = -BODY.EARTH.mu / (rr * rr * rr);
      return [r[0] * f, r[1] * f, r[2] * f];
    };
  }
  const H = 10;
  for (let t = 0; t < 3 * 86400; t += H) {
    c.ambientP = 0;
    w2.stepCraft(c, H); w2.t += H;
  }
  return c.r.slice();
}
const pNone = runOrbitDay('none');
const pOld = runOrbitDay('old');
const pNew = runOrbitDay('new');
// 解析二体基准（同初值）
const muE = BODY.EARTH.mu, r0 = BODY.EARTH.radius + 300;
const ref = M.propagate(muE, [r0, 0, 0], [0, Math.sqrt(muE / r0), 0], 3 * 86400).r;
const errOld = V.dist(pOld, ref), errNew = V.dist(pNew, ref), errNone = V.dist(pNone, ref);
console.log('  3 天后位置误差（相对解析二体基准）：无月球项 ' + errNone.toFixed(3) +
  ' km；旧公式 ' + errOld.toFixed(1) + ' km；修复后 ' + errNew.toFixed(2) + ' km');
check('修复后的偏差降到个位数 km 量级', errNew < 10, '(' + errNew.toFixed(2) + ' km)');
check('比旧公式显著改善', errOld / Math.max(errNew, 1e-6) > 5,
  '(改善 ' + (errOld / Math.max(errNew, 1e-6)).toFixed(1) + ' 倍)');

console.log('\n=== T4 再入伞（CM 5560 kg，8 km 起降）===');
function dropTest(oldChute, v0Down) {
  const w3 = new P.World(); w3.t = T0; w3.running = true;
  const mods = P.buildSaturnVStack().filter(m => m.id === 'CM');
  const r0 = BODY.EARTH.radius + 8;
  const om = BODY.EARTH.omega;
  const c = new P.Craft({
    id: 'CM', r: [r0, 0, 0],
    v: [0, om * r0 - (v0Down || 0), 0],   // 与自转同速 + 向下的径向速度（−y 即向下）
    modules: mods, mode: 'retrograde'
  });
  c.primary = 'EARTH';
  if (oldChute) {
    w3.effCdA = function (cc, altKm) {
      if (altKm < 1500) return 2500;
      if (altKm < 8000) return 320;
      return 40;
    };
  }
  let peakA = 0, tSim = 0, impactV = 0;
  const H = 0.02;
  while (!c.landed && !c.crashed && tSim < 3000) {
    c.ambientP = w3.ambientPressure(c.r);
    // 记录"阻力加速度"（不含重力）作为过载来源：过载 = |a_drag| / g
    const aD = w3.dragAccel(w3.t, c.r, c.v, c.mass(), c);
    peakA = Math.max(peakA, V.mag(aD) * 1000);
    w3.stepCraft(c, H); w3.t += H; tSim += H;
    // ★ snapToSurface 会把速度改成海面速度，必须在 checkSurface 之前取"触地速度"
    const vrel = V.sub(c.v, [-om * c.r[1], om * c.r[0], 0]);
    if (V.mag(c.r) - BODY.EARTH.radius < 0.06) impactV = V.mag(vrel) * 1000;
    w3.checkSurface(c);
  }
  return { landed: c.landed, crashed: c.crashed, v: impactV, peakG: peakA / 9.80665, t: tSim };
}
// 场景 = 真实再入末段：8 km 高度上以 100 m/s 下降（减速伞刚开）
const newDrop = dropTest(false, 0.1);
console.log('  修复后：落地=' + newDrop.landed + '  触地速度=' + newDrop.v.toFixed(2) +
  ' m/s  峰值阻力过载=' + newDrop.peakG.toFixed(1) + ' g  用时=' + newDrop.t.toFixed(0) + ' s');
check('成功溅落（未坠毁）', newDrop.landed && !newDrop.crashed);
check('溅落速度 8~10 m/s 且低于 15 m/s 判据', newDrop.v > 7.5 && newDrop.v < 10.5,
  '(' + newDrop.v.toFixed(2) + ' m/s)');
check('峰值阻力过载 < 12 g（无数百 g 假冲击）', newDrop.peakG < 12);
// 审查记录给的"量级"参考点：1 km 高度、100 m/s 时的阻力加速度
const wRef = new P.World();
const cmRef = new P.Craft({ id: 'C', r: [BODY.EARTH.radius + 1, 0, 0], v: [0, 0, 0],
  modules: P.buildSaturnVStack().filter(m => m.id === 'CM') });
const aRefNew = V.mag(wRef.dragAccel(0, [BODY.EARTH.radius + 1, 0, 0], [0, 0.1, 0], 5560, cmRef)) * 1000 / 9.80665;
const oldFn = function (cc, altKm) { return altKm < 1500 ? 2500 : (altKm < 8000 ? 320 : 40); };
wRef.effCdA = oldFn;
const aRefOld = V.mag(wRef.dragAccel(0, [BODY.EARTH.radius + 1, 0, 0], [0, 0.1, 0], 5560, cmRef)) * 1000 / 9.80665;
console.log('  参考点（1 km / 100 m/s 瞬时）：旧 CdA=2500 → ' + aRefOld.toFixed(0) +
  ' g；新 CdA≈1131 → ' + aRefNew.toFixed(0) + ' g');
check('旧 CdA 在该参考点确实给出数百 g', aRefOld > 100, '(' + aRefOld.toFixed(0) + ' g)');
check('新 CdA 把该参考点的冲击量级降到一半以下', aRefNew < aRefOld * 0.55,
  '(' + (aRefNew / aRefOld).toFixed(2) + ' × 旧值)');

console.log('\n=== T5 太阳速度 ===');
const s1 = A.sunState(T0);
console.log('  |v_sun| = ' + V.mag(s1.v).toFixed(3) + ' km/s   r·v = ' +
  (V.dot(s1.r, s1.v) / (V.mag(s1.r) * V.mag(s1.v))).toExponential(1));
const h = 300;
const sp1 = A.sunState(T0 + h).r, sp2 = A.sunState(T0 - h).r;
const fd = V.mul(V.sub(sp1, sp2), 1 / (2 * h));
// 1969 年 7 月地球接近远日点，公转速度约 29.3 km/s（近/远日点 30.3/29.3）
check('|v| 在 29.0~30.5 km/s（7 月接近远日点）', V.mag(s1.v) > 29.0 && V.mag(s1.v) < 30.5);
check('非零向量', V.mag(s1.v) > 1);
check('与中心差分一致（<1e-3 相对）', V.dist(fd, s1.v) / V.mag(s1.v) < 1e-3,
  '(相对差 ' + (V.dist(fd, s1.v) / V.mag(s1.v)).toExponential(1) + ')');

console.log('\n===== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
