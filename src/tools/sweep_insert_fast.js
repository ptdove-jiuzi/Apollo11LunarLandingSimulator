// 入轨参数扫描（轻量版，Node-only，秒级/组）：只跑「发射 → 停泊轨道关机」，
// 对每组 (insertT, insertKD) 报告 S-IVB 关机时的剩油与停泊轨道。
// 用法：node tools/sweep_insert_fast.js . "8,2;8,1.2;7,1.2;6,1.5"
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const combos = (process.argv[3] || '8,2').split(';').map(s => s.split(',').map(Number));
const webdata = path.join(dir, 'apollo11', 'webdata');
const ctx = { console, Math, isFinite, Number, JSON, Date };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(webdata, 'js', f), 'utf8'), ctx, { filename: f });
const { V, M, Astro: A, Physics: P, BODY, SITE } = ctx.APL;

console.log('T   KD   关机t  剩油(t)   peri×apo(km)    i(deg)');
for (const [T, KD] of combos) {
  const w = new P.World(); w.running = true; w.t = 0;
  w.autoStage = true;
  w.insertT = T; w.insertKD = KD; w.insertH = 0.05;
  const mods = P.buildSaturnVStack();
  const st = A.siteState(0, SITE.lat, SITE.lon, 0.02);
  const c = new P.Craft({ id: 'AS', r: st.r.slice(), v: st.v.slice(), modules: mods, mode: 'launch' });
  c.primary = 'EARTH'; c.throttleCmd = 1;
  w.addCraft(c);
  let guard = 0, cutoffT = null;
  w.warp = 100;
  while (guard++ < 2500) {
    w.advance(1 / 60);
    if (w.t > 600 && (c.throttleCmd || 0) === 0) { cutoffT = w.t; break; }
    if (c.crashed) break;
  }
  const sivb = c.modules.find(m => m.id === 'S-IVB');
  const el = M.elements(BODY.EARTH.mu, c.r.slice(), c.v.slice());
  const peri = isFinite(el.periapsis) ? el.periapsis - BODY.EARTH.radius : NaN;
  const apo = isFinite(el.apoapsis) ? el.apoapsis - BODY.EARTH.radius : NaN;
  console.log(String(T).padStart(3) + String(KD).padStart(5) +
    (cutoffT ? String(cutoffT.toFixed(0)).padStart(8) : '   ---') +
    String((sivb ? sivb.prop / 1000 : -1).toFixed(2)).padStart(10) +
    String((isFinite(peri) ? peri.toFixed(1) + 'x' + apo.toFixed(1) : '?')).padStart(15) +
    String((el.i * 180 / Math.PI).toFixed(3)).padStart(9));
}
