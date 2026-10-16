// 在真实浏览器里跑 M5，逐秒记录 S-IVB 入轨段的制导状态：
//   vgoResidual / targetAlt / throttleCmd / throttle / mode / 速度 / 高度 / 推力方向
// 用法: node tools/probe_m5_sivb.js [t0] [t1]
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const root = path.resolve('.');
const t0 = parseFloat(process.argv[2] || '540'), t1 = parseFloat(process.argv[3] || '1020');
const P = { T: parseFloat(process.argv[4] || '0'), KD: parseFloat(process.argv[5] || '0'), H: parseFloat(process.argv[6] || '0'), ResT: parseFloat(process.argv[7] || '0') };
async function main() {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--allow-file-access-from-files']});
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[FATAL] ' + e));
  await page.goto(pathToFileURL(path.join(root, 'apollo11', 'webdata', 'index.html')).href);
  await page.waitForFunction(() => window.APLApp && typeof APLApp.startMission === 'function' && window.APL && APL.Demo);
  const out = await page.evaluate(async ({t0, t1, P}) => {
    APLApp.driverExternal = true; APLApp.paused = true;
    APL.setLang('zh');
    APLApp.startMission('M5');
    APLApp.driverExternal = true;
    APL.Demo.state.noAssist = true;
    APL.Demo.start('M5');
    APLApp.paused = true; APLApp.driverExternal = true;
    const w0 = APLApp.world;
    if (P.T) w0.insertT = P.T; if (P.KD) w0.insertKD = P.KD;
    if (P.H) w0.insertH = P.H; if (P.ResT) w0.insertResT = P.ResT;
    const rows = [];
    let frames = 0, lastT = -1e9;
    while (APL.Demo.isActive() && frames < 240000) {
      const w = APLApp.world;
      const tt = w.t;
      const c = w.crafts[0];
      if (tt >= t0 && tt <= t1 && tt - lastT > 1.0) {
        lastT = tt;
        let res = null;
        try { res = APL.Physics.vgoResidual(w, c); } catch (e) { res = 'ERR:' + e; }
        let tg = null;
        try { tg = (APL.Physics.vgoEarthTarget ? APL.Physics.vgoEarthTarget(w, c) : null); } catch (e) { tg = 'ERR'; }
        const am = c.activeModule();
        let el = null;
        try { el = c.orbitRelative(c.primary, w); } catch (e) { el = null; }
        // 手工复算 vgoEarthTarget + dvE（vgoEarthTarget 未导出）
        let vgo = null;
        try {
          const f = APL.Physics.localFrame(w, c);
          const rel = f.rel, vrel = f.vrel, up = f.up;
          const r = Math.hypot(rel[0], rel[1], rel[2]);
          const rt = 6378.137 + (w.targetAlt || 184.55);
          const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const u = v => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
          const h = cr(rel, vrel), hz = u(h), tand = u(cr(hz, up));
          const vTang = Math.sqrt(398600.4418 / rt);
          const vrNow = vrel[0] * up[0] + vrel[1] * up[1] + vrel[2] * up[2];
          let vRad = (rt - r) / 30 - 1.5 * vrNow;
          if (vRad > 0.30) vRad = 0.30; if (vRad < -0.30) vRad = -0.30;
          const vDes = [tand[0] * vTang + up[0] * vRad, tand[1] * vTang + up[1] * vRad, tand[2] * vTang + up[2] * vRad];
          const dvE = [vDes[0] - vrel[0], vDes[1] - vrel[1], vDes[2] - vrel[2]];
          vgo = { vrNow, vRad, dvE: dvE.map(x => Math.round(x * 1e4) / 1e4), vrel: vrel.map(x => Math.round(x * 1e4) / 1e4), up: up.map(x => Math.round(x * 1e3) / 1e3), tand: tand.map(x => Math.round(x * 1e3) / 1e3), dvmag: Math.round(Math.hypot(dvE[0], dvE[1], dvE[2]) * 1e4) / 1e4 };
        } catch (e) { vgo = 'ERR:' + e; }
        rows.push({
          t: Math.round(tt * 100) / 100,
          v: Math.hypot(c.v[0], c.v[1], c.v[2]),
          vv: c.v.map(x => Math.round(x * 1e6) / 1e6),
          alt: (Math.hypot(c.r[0], c.r[1], c.r[2]) - 6378.137),
          th: c.throttle, thCmd: c.throttleCmd, mode: c.attitude.mode,
          st: c.stageIndex, m: Math.round(c.mass()),
          res: (typeof res === 'number' ? Math.round(res * 1000) / 1000 : res),
          rt: tg && tg.rt, r: tg && tg.r,
          peri: el ? el.periapsis - 6378.137 : null, apo: el ? el.apoapsis - 6378.137 : null,
          thrust: c.currentThrust(), dir: c.attitude.vec ? c.attitude.vec.map(x => Math.round(x * 1e4) / 1e4) : null,
          am: am && am.module.id, tgtAlt: w.targetAlt, vgo
        });
      }
      const ta = w.t;
      w.advance(1 / 60);
      APL.Demo.tick(Math.max(0, w.t - ta));
      frames++;
      if (frames % 1000 === 0) await new Promise(r => setTimeout(r, 0));
      if (APL.Demo.state.failure) break;
    }
    return {rows, frames, fail: APL.Demo.state.failMsg, t: APLApp.world.t};
  }, {t0, t1, P});
  console.log('t\talt\tperi\tapo\tm\tth\tres(m/s)\t|dvE|\t dvE\t vrel\t up\t tand');
  for (const r of out.rows) {
    const g = (typeof r.vgo === 'object' && r.vgo) ? r.vgo : {};
    console.log([r.t, r.alt.toFixed(2),
      (r.peri === null ? '-' : r.peri.toFixed(1)), (r.apo === null ? '-' : r.apo.toFixed(1)), r.m,
      r.th, r.res,
      (g.dvmag === undefined ? '-' : g.dvmag),
      '[' + (g.dvE || []).join(',') + ']',
      '[' + (g.vrel || []).join(',') + ']',
      '[' + (g.up || []).join(',') + ']',
      '[' + (g.tand || []).join(',') + ']'].join('\t'));
  }
  console.log('\nframes=' + out.frames + ' endT=' + out.t);
  if (out.fail) console.log('FAIL: ' + JSON.stringify(out.fail));
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
