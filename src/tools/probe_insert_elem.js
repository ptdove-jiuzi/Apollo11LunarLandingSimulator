// 采样 S-IVB 入轨段并拆解 residual 三项 + 打印瞬时密切轨道根数。
// 目的：判定"残余抖振"具体卡在哪个通道（位置项 / 径向项 / 切向项）。
// 用法: node tools/probe_insert_elem.js [T] [KD] [H] [ResT]
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const root = path.resolve('.');
const T = parseFloat(process.argv[2] || '0'), KD = parseFloat(process.argv[3] || '0'),
      H = parseFloat(process.argv[4] || '0'), ResT = parseFloat(process.argv[5] || '0');
async function main() {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--allow-file-access-from-files']});
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[FATAL] ' + e));
  await page.goto(pathToFileURL(path.join(root, 'apollo11', 'webdata', 'index.html')).href);
  await page.waitForFunction(() => window.APLApp && typeof APLApp.startMission === 'function' && window.APL && APL.Demo);
  const res = await page.evaluate(async (p) => {
    APLApp.driverExternal = true; APLApp.paused = true;
    APL.setLang('zh');
    APLApp.startMission('M5');
    APLApp.driverExternal = true;
    APL.Demo.state.noAssist = true;
    APL.Demo.start('M5');
    APLApp.paused = true; APLApp.driverExternal = true;
    const w = APLApp.world;
    if (p.T) w.insertT = p.T; if (p.KD) w.insertKD = p.KD;
    if (p.H) w.insertH = p.H; if (p.ResT) w.insertResT = p.ResT;
    const V = APL.V, B = APL.BODY, M = APL.M;
    const out = [];
    let frames = 0, lastSamp = -1e9, prevTh = 0, cutoff = null;
    while (APL.Demo.isActive() && frames < 400000) {
      const c = w.crafts[0];
      const th = c.throttleCmd || 0;
      const sivb = (c.modules.find(m => m.id === 'S-IVB') || {});
      if (th > 0 && sivb.prop > 0 && c.attitude.mode === 'vgo' && w.t - lastSamp >= 8) {
        lastSamp = w.t;
        const rel = V.sub(c.r, w.primaryPos('EARTH'));
        const vrel = V.sub(c.v, w.primaryVel('EARTH'));
        const mu = B.EARTH.mu, rt = B.EARTH.radius + (w.targetAlt || 184.55);
        const r = V.mag(rel), v = V.mag(vrel);
        const el = M.elements(mu, rel, vrel);
        const up = V.unit(rel);
        const vr = V.dot(vrel, up);
        const vt = Math.sqrt(Math.max(v * v - vr * vr, 0));
        const vCirc = Math.sqrt(mu / rt);
        const Tr = (w.insertResT || w.insertT || 12);
        const pTerm = (r - rt) / Tr;
        out.push({ t: w.t, alt: r - B.EARTH.radius, a: el.a - B.EARTH.radius,
          e: el.e, vr: vr * 1000, vt: vt * 1000, vCirc: vCirc * 1000,
          pTerm: pTerm * 1000, prop: sivb.prop,
          res: APL.Physics.vgoResidual(w, c) });
      }
      if (cutoff === null && th === 0 && prevTh > 0 && sivb.prop !== undefined) cutoff = { t: w.t, prop: sivb.prop };
      prevTh = th;
      const t0 = w.t; w.advance(1 / 60); APL.Demo.tick(Math.max(0, w.t - t0));
      frames++;
      if (frames % 2000 === 0) await new Promise(r => setTimeout(r, 0));
      if (APL.Demo.state.failure) break;
    }
    return { rows: out, cutoff };
  }, {T, KD, H, ResT});
  console.log('t\talt(km)\ta(km)\te\tvr(m/s)\tvt(m/s)\tvc(m/s)\tposTerm(m/s)\tres(m/s)\tS-IVB(t)');
  for (const r of res.rows) {
    console.log([r.t.toFixed(1), r.alt.toFixed(3), r.a.toFixed(3), r.e.toExponential(2),
      r.vr.toFixed(2), r.vt.toFixed(2), r.vCirc.toFixed(2), r.pTerm.toFixed(1),
      r.res.toFixed(2), (r.prop / 1000).toFixed(2)].join('\t'));
  }
  console.log('\n关机 t=' + (res.cutoff ? res.cutoff.t.toFixed(1) : '-')
    + '  剩油=' + (res.cutoff ? (res.cutoff.prop / 1000).toFixed(2) + ' t' : '-'));
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
