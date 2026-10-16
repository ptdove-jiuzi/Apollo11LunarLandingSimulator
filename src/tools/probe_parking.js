// 跑到 S-IVB 关机，打印停泊轨道根数（对比不同入轨制导参数）
// 用法: node tools/probe_parking.js "T,KD,H[,ResT];..."
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const root = path.resolve('.');
const combos = (process.argv[2] || '30,1.5,0.2').split(';').map(s => s.split(',').map(Number));
async function main() {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--allow-file-access-from-files']});
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[FATAL] ' + e));
  await page.goto(pathToFileURL(path.join(root, 'apollo11', 'webdata', 'index.html')).href);
  await page.waitForFunction(() => window.APLApp && typeof APLApp.startMission === 'function' && window.APL && APL.Demo);
  console.log('T\tKD\tH\tResT\t关机t\talt\tperi/apo\ti(deg)\traan(deg)\targp(deg)\tnu(deg)\tS-IVB剩');
  for (const [T, KD, H, ResT] of combos) {
    const r = await page.evaluate(async (p) => {
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
      let prevTh = 0, seen = false, out = null, frames = 0;
      while (APL.Demo.isActive() && frames < 400000) {
        const c = w.crafts[0]; const th = c.throttleCmd || 0;
        if (c.attitude.mode === 'vgo' && th > 0) seen = true;
        if (seen && !out && th === 0 && prevTh > 0) {
          const el = c.orbitRelative('EARTH', w);
          const D = 180 / Math.PI;
          out = { t: w.t, alt: (Math.hypot(c.r[0], c.r[1], c.r[2]) - 6378.137),
            peri: el.periapsis - 6378.137, apo: el.apoapsis - 6378.137,
            i: el.i * D, raan: el.raan * D, argp: el.argp * D, nu: el.nu * D,
            sivb: (c.modules.find(m => m.id === 'S-IVB') || {}).prop };
        }
        prevTh = th;
        const t0 = w.t; w.advance(1 / 60); APL.Demo.tick(Math.max(0, w.t - t0));
        frames++;
        if (frames % 2000 === 0) await new Promise(r => setTimeout(r, 0));
        if (APL.Demo.state.failure) break;
      }
      return out;
    }, {T, KD, H, ResT});
    if (!r) { console.log([T, KD, H, (ResT || '-'), '-'].join('\t')); continue; }
    console.log([T, KD, H, (ResT || '-'), r.t.toFixed(1), r.alt.toFixed(2),
      r.peri.toFixed(2) + '/' + r.apo.toFixed(2), r.i.toFixed(4), r.raan.toFixed(3),
      r.argp.toFixed(3), r.nu.toFixed(3), Math.round(r.sivb)].join('\t'));
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
