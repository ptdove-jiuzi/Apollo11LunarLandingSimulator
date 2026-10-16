// TEI 单元级复现与验证：从 M5 轨迹取 TEI 前的环月轨道状态，调用
// transEarthInjection，然后把"点火后的目标速度"当脉冲打进去，积分 3 天
// 看地心轨道（近地点是否落在再入走廊）。
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
const ctx = { console, Math, isFinite, Number, JSON, Date };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(webdata, 'js', f), 'utf8'), ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY, SITE } = ctx.APL;

// 取 M5 轨迹里 TEI 前最后一个样本（TEI 在 T+331 564 点火，前一个样本 ~329 200）
const j = JSON.parse(fs.readFileSync(path.join(webdata, 'traj', 'M5.json'), 'utf8'));
let smp = null;
for (const s of j.samples) { if (s.t >= 329000 && s.t <= 331000) smp = s; }
if (!smp) { console.error('没找到 TEI 前样本'); process.exit(1); }
const cs = smp.c.find(c => c.mo.some(m => m[0] === 'SM'));
console.log('样本 t=' + smp.t.toFixed(0) + '  飞行器 ' + cs.id + '  质量 ' + cs.m.toFixed(0) + ' kg');

// 造世界与飞船
const w = new P.World(); w.t = smp.t; w.running = true;
const all = P.buildSaturnVStack();
const mods = cs.mo.map(m => { const d = all.find(x => x.id === m[0]); return d ? JSON.parse(JSON.stringify(d)) : null; }).filter(Boolean);
mods.forEach(m => { const e = cs.mo.find(x => x[0] === m.id); if (e) m.prop = e[1]; });
const c = new P.Craft({ id: 'CSM', r: cs.r.slice(), v: cs.v.slice(), modules: mods, mode: 'prograde' });
c.primary = 'MOON'; c.stageIndex = 5; c.flags.isLM = false;
w.addCraft(c);

const ms = A.moonState(w.t);
const rel = V.sub(c.r, ms.r), vrel = V.sub(c.v, ms.v);
console.log('环月高度 ' + (V.mag(rel) - BODY.MOON.radius).toFixed(1) + ' km，v_rel ' +
  V.mag(vrel).toFixed(4) + ' km/s，相位判据 dot(vrel,moonV)=' +
  V.dot(V.unit(vrel), V.unit(ms.v)).toFixed(3) + '（需 < -0.55）');

const r = P.transEarthInjection(w, c, 0.997);
console.log('求解返回：' + JSON.stringify({ dv: r.dv, failed: r.failed, reason: r.reason, burning: !!r.burning }));

// 若返回了 burn，把求解器装到飞船上的目标速度当脉冲打进去再积分 3 天
if (r && r.burning && !r.failed) {
  console.log('burn 对象字段: ' + Object.keys(c.burn || {}).join(','));
  var vImp = (c.burn && (c.burn.target || c.burn.vImp)) ? (c.burn.target || c.burn.vImp) : null;
  console.log('目标速度 = [' + (vImp ? vImp.map(function(x){return x.toFixed(5);}).join(', ') : '?') + ']（当前 [' +
    c.v.map(function(x){return x.toFixed(5);}).join(', ') + ']）');
  const st = P.integrateSim(w, c.r, vImp || c.v, w.t, w.t + 3 * 86400, {});
  if (st) {
    const el = M.elements(BODY.EARTH.mu, st.r, st.v);
    console.log('3 天后：|r|=' + V.mag(st.r).toFixed(0) + ' km，地心 peri=' +
      (el.periapsis - BODY.EARTH.radius).toFixed(0) + ' km，apo=' +
      (isFinite(el.apoapsis) ? (el.apoapsis - BODY.EARTH.radius).toFixed(0) : 'inf') + ' km');
    console.log('returnIsValid=' + P.returnIsValid(w, c));
  }
}
