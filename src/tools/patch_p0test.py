# -*- coding: utf-8 -*-
# 修正 test_physics_p0.js 里三处测试设计缺陷（不动被测代码）
import io, sys
p = 'tools/test_physics_p0.js'
s = io.open(p, encoding='utf-8').read()

# ---- T1：地心是地球项的奇点，改成"距地心 1 km"处用差分法分离月球项 ----
old1 = """const w = new P.World(); w.t = T0;
const a0 = w.gravity(T0, [0, 0, 0]);
const a0m = V.mag(a0);
console.log('  |a(地心)| = ' + a0m.toExponential(3) + ' km/s²');
// 旧公式（只有直接项）在地心的值
const ms0 = A.moonState(T0);
const oldTerm = V.mul(ms0.r, BODY.MOON.mu / Math.pow(V.mag(ms0.r), 3));
console.log('  缺间接项时本应出现的虚假加速度 |μ_m·r_m/|r_m|³| = ' +
  V.mag(oldTerm).toExponential(3) + ' km/s²');
check('地心处合加速度 ≈ 0', a0m < 1e-13, '(阈值 1e-13)');
check('虚假加速度已消除', a0m / V.mag(oldTerm) < 1e-5,
  '(残余占比 ' + (a0m / V.mag(oldTerm)).toExponential(1) + ')');"""
new1 = """const w = new P.World(); w.t = T0;
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
  '(残余占比 ' + (a0m / V.mag(oldTerm)).toExponential(1) + ')');"""
assert old1 in s; s = s.replace(old1, new1)

# ---- T2：潮汐应投影到地月连线方向（局部径向在两侧都朝外，判据写错了）----
old2 = """const moonNear = V.sub(gNear, earthOnly(near));
const moonFar = V.sub(gFar, earthOnly(far));
const rHat = (r) => V.unit(r);
console.log('  月球项·径向（靠月侧） = ' + (V.dot(moonNear, rHat(near)) * 1e9).toFixed(3) + ' e-9 km/s²');
console.log('  月球项·径向（背月侧） = ' + (V.dot(moonFar, rHat(far)) * 1e9).toFixed(3) + ' e-9 km/s²');
check('靠月侧被拉向月球（径向分量 > 0）', V.dot(moonNear, rHat(near)) > 0);
check('两侧潮汐反号（差 ≈ 4μMr/R³）', V.dot(moonNear, rHat(near)) - V.dot(moonFar, rHat(far)) > 0);
const tidalTheory = 4 * BODY.MOON.mu * 7000 / Math.pow(R, 3);
check('潮汐差与理论 4μ_m·r/R³ 同量级',
  Math.abs((V.dot(moonNear, rHat(near)) - V.dot(moonFar, rHat(far))) / tidalTheory - 1) < 0.15,
  '(实测 ' + ((V.dot(moonNear, rHat(near)) - V.dot(moonFar, rHat(far))) / tidalTheory).toFixed(3) + ' × 理论)');"""
new2 = """const moonNear = V.sub(gNear, earthOnly(near));
const moonFar = V.sub(gFar, earthOnly(far));
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
  '(' + ((nNear - nFar) / (2 * tidalTheory)).toFixed(3) + ' × 理论)');"""
assert old2 in s; s = s.replace(old2, new2)

# ---- T3：跑 3 天，并与解析二体基准对比（给出"位置误差"口径）----
old3 = """  const H = 10;
  for (let t = 0; t < 86400; t += H) {"""
new3 = """  const H = 10;
  for (let t = 0; t < 3 * 86400; t += H) {"""
assert old3 in s; s = s.replace(old3, new3)
old3b = """console.log('\\n=== T3 300 km 圆轨道跑一天（86400 s，10 s 步长）===');"""
new3b = """console.log('\\n=== T3 300 km 圆轨道跑 3 天（259200 s，10 s 步长）===');"""
assert old3b in s; s = s.replace(old3b, new3b)
old3c = """const pNone = runOrbitDay('none');
const pOld = runOrbitDay('old');
const pNew = runOrbitDay('new');
const errOld = V.dist(pOld, pNone), errNew = V.dist(pNew, pNone);
console.log('  一天后位置：旧公式偏离基准 ' + (errOld).toFixed(1) + ' km；修复后偏离基准 '
  + (errNew).toFixed(2) + ' km');
check('修复后的偏差降到个位数 km 量级', errNew < 10, '(' + errNew.toFixed(2) + ' km)');
check('比旧公式显著改善', errOld / Math.max(errNew, 1e-6) > 5,
  '(改善 ' + (errOld / Math.max(errNew, 1e-6)).toFixed(1) + ' 倍)');"""
new3c = """const pNone = runOrbitDay('none');
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
  '(改善 ' + (errOld / Math.max(errNew, 1e-6)).toFixed(1) + ' 倍)');"""
assert old3c in s; s = s.replace(old3c, new3c)

# ---- T4：改成"真实到达速度 100 m/s @ 8 km"，并在 snap 之前取落地速度 ----
old4 = """function dropTest(oldChute) {
  const w3 = new P.World(); w3.t = T0; w3.running = true;
  const mods = P.buildSaturnVStack().filter(m => m.id === 'CM');
  const r0 = BODY.EARTH.radius + 8;
  const om = BODY.EARTH.omega;
  const c = new P.Craft({
    id: 'CM', r: [r0, 0, 0],
    v: [0, om * r0, 0],            // 与自转同速，相对海面静止
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
  let peakA = 0, tSim = 0;
  const H = 0.02;
  while (!c.landed && !c.crashed && tSim < 3000) {
    c.ambientP = w3.ambientPressure(c.r);
    const aD = w3.dragAccel(w3.t, c.r, c.v, c.mass(), c);
    const aG = 9.80665;                       // 近地重力，用来看过载量级
    peakA = Math.max(peakA, V.mag(V.add(aD, [0, 0, -aG / 1000])) * 1000);
    w3.stepCraft(c, H); w3.t += H; tSim += H;
    w3.checkSurface(c);
  }
  const alt = V.mag(c.r) - BODY.EARTH.radius;
  const vrel = V.sub(c.v, [-BODY.EARTH.omega * c.r[1], BODY.EARTH.omega * c.r[0], 0]);
  return { landed: c.landed, crashed: c.crashed, v: V.mag(vrel) * 1000, peakG: peakA / 9.80665, t: tSim };
}"""
new4 = """function dropTest(oldChute, v0Down) {
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
}"""
assert old4 in s; s = s.replace(old4, new4)

old5 = """const newDrop = dropTest(false);
console.log('  修复后：落地=' + newDrop.landed + '  溅落速度=' + newDrop.v.toFixed(2) +
  ' m/s  峰值过载=' + newDrop.peakG.toFixed(1) + ' g  用时=' + newDrop.t.toFixed(0) + ' s');
check('成功溅落（未坠毁）', newDrop.landed && !newDrop.crashed);
check('溅落速度 8~10 m/s 且低于 15 m/s 判据', newDrop.v > 7.5 && newDrop.v < 10.5);
check('峰值过载 < 12 g（无数百 g 假冲击）', newDrop.peakG < 12);
const oldDrop = dropTest(true);
console.log('  旧 2500 m² 对照：溅落速度=' + oldDrop.v.toFixed(2) + ' m/s  峰值过载=' +
  oldDrop.peakG.toFixed(0) + ' g');
check('旧值确实会产生数百 g（对照组）', oldDrop.peakG > 50, '(' + oldDrop.peakG.toFixed(0) + ' g)');"""
new5 = """// 场景 = 真实再入末段：8 km 高度上以 100 m/s 下降（减速伞刚开）
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
  '(' + (aRefNew / aRefOld).toFixed(2) + ' × 旧值)');"""
assert old5 in s; s = s.replace(old5, new5)

# ---- T5：7 月地球接近远日点，速度约 29.3 km/s ----
old6 = """check('|v| 在 29.8~30.3 km/s', V.mag(s1.v) > 29.8 && V.mag(s1.v) < 30.3);"""
new6 = """// 1969 年 7 月地球接近远日点，公转速度约 29.3 km/s（近/远日点 30.3/29.3）
check('|v| 在 29.0~30.5 km/s（7 月接近远日点）', V.mag(s1.v) > 29.0 && V.mag(s1.v) < 30.5);"""
assert old6 in s; s = s.replace(old6, new6)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched', p)
