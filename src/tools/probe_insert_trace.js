// 逐段采样 S-IVB 入轨段：t / 速度 / 高度 / S-IVB 剩油 / 油门 / 制导模式 / vgoResidual
// 目的：判断"入轨烧掉 ~55 t"到底是(a)残余抖振空烧 还是(b)S-II 交班速度本来就低。
// 用法: node tools/probe_insert_trace.js [T] [KD] [H] [ResT]
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
  const rows = await page.evaluate(async (p) => {
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
    const out = [];
    let frames = 0, lastSamp = -1e9, prevTh = 0, burnStart = null, cutoff = null;
    const V = APL.V, B = APL.BODY, P = APL.Physics;
    while (APL.Demo.isActive() && frames < 400000) {
      const c = w.crafts[0];
      const th = c.throttleCmd || 0;
      const sivb = (c.modules.find(m => m.id === 'S-IVB') || {});
      // 采样：S-IVB 段内每 10 s 一行
      if (sivb.prop !== undefined && th > 0 && sivb.prop > 0) {
        if (burnStart === null) burnStart = w.t;
        if (w.t - lastSamp >= 10) {
          lastSamp = w.t;
          const rel = V.sub(c.r, w.primaryPos('EARTH'));
          const vrel = V.sub(c.v, w.primaryVel('EARTH'));
          const alt = V.mag(rel) - B.EARTH.radius;
          const spd = V.mag(vrel);
          let res = null, vRad = null;
          try { if (P.vgoResidual) res = P.vgoResidual(w, c); } catch (e) {}
          out.push({ t: w.t, spd: spd, alt: alt, prop: sivb.prop, th: th,
                     mode: c.attitude.mode, stage: c.stageIndex,
                     res: (typeof res === 'number' ? res : (res && res.res) || null) });
        }
      }
      if (burnStart !== null && cutoff === null && th === 0 && prevTh > 0) cutoff = { t: w.t, prop: sivb.prop };
      prevTh = th;
      const t0 = w.t; w.advance(1 / 60); APL.Demo.tick(Math.max(0, w.t - t0));
      frames++;
      if (frames % 2000 === 0) await new Promise(r => setTimeout(r, 0));
      if (APL.Demo.state.failure) break;
    }
    return { rows: out, burnStart, cutoff };
  }, {T, KD, H, ResT});
  console.log('t\tspeed(km/s)\talt(km)\tS-IVB剩(t)\tthrottle\tmode\tresidual(m/s)');
  for (const r of rows.rows) {
    console.log([r.t.toFixed(1), r.spd.toFixed(4), r.alt.toFixed(1),
      (r.prop / 1000).toFixed(2), r.th.toFixed(2), r.mode,
      (r.res === null ? '-' : r.res.toFixed(3))].join('\t'));
  }
  console.log('\n点火 t=' + (rows.burnStart ? rows.burnStart.toFixed(1) : '-')
    + '  关机 t=' + (rows.cutoff ? rows.cutoff.t.toFixed(1) : '-')
    + '  关机剩油=' + (rows.cutoff ? (rows.cutoff.prop / 1000).toFixed(2) + ' t' : '-'));
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
