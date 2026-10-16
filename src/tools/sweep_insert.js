// 整定入轨圆化制导：跑完整 M5，报告
//   · S-IVB 关机（mode 离开 vgo）时刻 t 与此时轨道/剩余推进剂
//   · 入轨段消耗的 S-IVB 推进剂
//   · TLI 是否成功（failMsg）
// 用法: node tools/sweep_insert.js "T,KD,H[,ResT];T,KD,H[,ResT];..."
//   例: node tools/sweep_insert.js "30,1.5,0.2;15,2,0.05;12,2,0.05"
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
  console.log('T\tKD\tH\tResT\t关机t\t入轨耗S-IVB(kg)\t关机时peri/apo/i\tS-IVB剩\t结果');
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
      if (p.T) w.insertT = p.T;
      if (p.KD) w.insertKD = p.KD;
      if (p.H) w.insertH = p.H;
      if (p.ResT) w.insertResT = p.ResT;
      const sivb0 = (() => { const m = w.crafts[0].modules.find(m => m.id === 'S-IVB'); return m ? m.prop : 0; })();
      let cutT = null, cutOrb = null, sivbAtCut = null, prevTh = 0, seenBurn = false;
      let frames = 0;
      while (APL.Demo.isActive() && frames < 400000) {
        const c = w.crafts[0];
        const md = c.attitude && c.attitude.mode;
        const th = c.throttleCmd || 0;
        if (md === 'vgo' && th > 0) seenBurn = true;
        if (seenBurn && cutT === null && md === 'vgo' && th === 0 && prevTh > 0) {
          cutT = w.t;
          sivbAtCut = (c.modules.find(m => m.id === 'S-IVB') || {}).prop;
          try { const el = c.orbitRelative('EARTH', w); cutOrb = { peri: el.periapsis - 6378.137, apo: el.apoapsis - 6378.137, inc: el.inclination * 180 / Math.PI }; } catch (e) {}
        }
        prevTh = th;
        const t0 = w.t;
        w.advance(1 / 60);
        APL.Demo.tick(Math.max(0, w.t - t0));
        frames++;
        if (frames % 2000 === 0) await new Promise(r => setTimeout(r, 0));
        if (APL.Demo.state.failure) break;
      }
      const c = w.crafts[0];
      return {
        cutT, cutOrb, sivbAtCut, sivb0, sivbEnd: (c.modules.find(m => m.id === 'S-IVB') || {}).prop,
        fail: APL.Demo.state.failMsg ? APL.Demo.state.failMsg.zh : null, frames, t: w.t
      };
    }, {T, KD, H, ResT});
    const used = r.sivbAtCut !== null ? (r.sivb0 - r.sivbAtCut) : null;
    const orb = r.cutOrb ? (r.cutOrb.peri.toFixed(1) + '/' + r.cutOrb.apo.toFixed(1) + '/' + r.cutOrb.inc.toFixed(3)) : '-';
    const res = r.fail ? ('FAIL: ' + r.fail.slice(0, 90)) : 'OK(t=' + r.t.toFixed(0) + ')';
    console.log([T, KD, H, (ResT || '-'), (r.cutT === null ? '-' : r.cutT.toFixed(1)),
      (used === null ? '-' : used.toFixed(0)), orb,
      (r.sivbEnd === undefined ? '-' : Math.round(r.sivbEnd)), res].join('\t'));
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
