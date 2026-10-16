// 动力下降自动制导验证：正确的「经过着陆点上空」下降轨道 + descentGuidance
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2];
const ctx = { console, Math, isFinite }; ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, 'apollo11', 'webdata', 'js', f), 'utf8'), ctx, { filename: f });
const { V, Astro: A, Physics: P, BODY, LANDING_SITE } = ctx.APL;
const RM = BODY.MOON.radius;

const T0 = Number(process.argv[3] || 362000);
const w = new P.World(); w.running = true; w.t = T0;
const orb = P.orbitOverSite(w, 111);
const lmMods = P.buildSaturnVStack().filter(m => m.group === 'LM');
const c = new P.Craft({ id: 'LM', r: orb.r.slice(), v: orb.v.slice(), modules: lmMods, mode: 'prograde' });
c.primary = 'MOON'; c.stageIndex = 3; c.flags.isLM = true; w.addCraft(c);
const D = lmMods.find(m => m.id === 'LM_D');
const massDry = c.mass() - D.prop;

const msA = A.moonState(w.t);
const sp0 = A.moonSurfacePoint(w.t, LANDING_SITE.lat, LANDING_SITE.lon, 0).r;
console.log('初始: alt', (V.dist(c.r, msA.r) - RM).toFixed(2), 'km  range',
  V.dist(c.r, sp0).toFixed(0), 'km  站点对面夹角',
  (Math.acos(V.clamp(V.dot(V.unit(V.sub(c.r, msA.r)), V.unit(V.sub(sp0, msA.r))), -1, 1)) * 180 / Math.PI).toFixed(2) + '°');

const de = P.deorbitTo(w, c, 15);
console.log('下降轨道 Δv =', de ? (de.dv * 1000).toFixed(1) + ' m/s' : '无需', ' 剩余推进剂', D.prop.toFixed(0), 'kg');

let tSim = 0, phase = 'coast', logT = 0, minAlt = 1e9, pdiT = 0;
const PDI_R = Number(process.argv[4] || 520);
const STEP = 0.1;
console.log('   t     alt(km)  range(km)   vh     vlat   vd    vdReq   aH     aV    thr   prop');
while (tSim < 9000 && !c.landed && !c.crashed) {
  const ms = A.moonState(w.t);
  const altKm = V.dist(c.r, ms.r) - RM;
  const sp = A.moonSurfacePoint(w.t, LANDING_SITE.lat, LANDING_SITE.lon, 0).r;
  let G = null;
  if (phase === 'coast') {
    c.throttleCmd = 0; c.attitude.mode = 'prograde';
    if (V.dist(c.r, sp) < PDI_R && altKm < 32) {
      phase = 'descent'; pdiT = tSim;
      console.log(`--- PDI @ t=+${tSim.toFixed(0)}s  alt=${altKm.toFixed(2)}km  range=${V.dist(c.r, sp).toFixed(0)}km ---`);
    }
  } else {
    G = P.descentGuidance(w, c, { tauV: Number(process.argv[5]||14), flareAlt: Number(process.argv[6]||120), vBias: Number(process.argv[7]||1.6), hGate: Number(process.argv[8]||300), tauSmax: Number(process.argv[9]||8) });
    if (G && G.h < minAlt) minAlt = G.h;
    if (tSim - logT >= 40 || (tSim - pdiT > 560 && tSim - logT >= 5)) {
      logT = tSim;
      console.log(` ${tSim.toFixed(0).padStart(5)}  ${altKm.toFixed(2).padStart(7)}  ${(V.dist(c.r, sp) / 1000).toFixed(1).padStart(8)}  ${(G ? G.vh : 0).toFixed(0).padStart(6)}  ${(G ? G.vlat : 0).toFixed(1).padStart(6)}  ${(G ? G.vd : 0).toFixed(1).padStart(6)}  ${(G ? G.vdReq : 0).toFixed(1).padStart(6)}  ${(G ? G.aH : 0).toFixed(2).padStart(5)}  ${(G ? G.aV : 0).toFixed(2).padStart(5)}  s=${(G ? G.s : 0).toFixed(0).padStart(6)} tgo=${(G ? G.tgo : 0).toFixed(0).padStart(4)} req=${(G ? (G.vh*G.vh/(2*Math.max(G.s,1))).toFixed(2) : 0).padStart(5)}  ${c.throttleCmd.toFixed(2)}  ${D.prop.toFixed(0)}`);
    }
  }
  c.ambientP = 0; c.ignite(STEP); w.stepCraft(c, STEP); w.t += STEP; tSim += STEP;
  w.checkSurface(c);
}
const sp = A.moonSurfacePoint(w.t, LANDING_SITE.lat, LANDING_SITE.lon, 0).r;
console.log('\n结果:', c.landed ? '✅ 成功着陆' : (c.crashed ? '❌ 坠毁' : '⏱ 未结束'), ' 用时', tSim.toFixed(0), 's');
console.log('落点偏差', (V.dist(c.r, sp) * 1000).toFixed(0), 'm  剩余推进剂', D.prop.toFixed(0),
  'kg（初始 8200）  最低高度', (minAlt / 1000).toFixed(3), 'km');
if (c.landed) {
  const vr = V.sub(c.v, A.moonState(w.t).v);
  console.log('接地相对速度', (V.mag(vr) * 1000).toFixed(2), 'm/s');
  const dv = D.isp * 9.80665 * Math.log((massDry + 8200) / (massDry + D.prop));
  console.log('下降段 Δv =', dv.toFixed(0), 'm/s  可用', (D.isp * 9.80665 * Math.log((massDry + 8200) / massDry)).toFixed(0), 'm/s');
}
