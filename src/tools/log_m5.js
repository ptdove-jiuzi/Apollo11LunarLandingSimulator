// 跑 M5 并打印全部日志（重点看"转移窗口候选"复核/验收记录）
// 用法: node tools/log_m5.js [T] [KD] [H] [ResT]
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');
const root = path.resolve('.');
const T = parseFloat(process.argv[2] || '0'), KD = parseFloat(process.argv[3] || '0'), H = parseFloat(process.argv[4] || '0'), ResT = parseFloat(process.argv[5] || '0');
async function main() {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--allow-file-access-from-files']});
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[FATAL] ' + e));
  await page.goto(pathToFileURL(path.join(root, 'apollo11', 'webdata', 'index.html')).href);
  await page.waitForFunction(() => window.APLApp && typeof APLApp.startMission === 'function' && window.APL && APL.Demo);
  const out = await page.evaluate(async (p) => {
    const logs = [];
    const log0 = APLApp.logLine;
    APLApp.logLine = function (kind, text, ...a) { logs.push('T+' + Math.round(APLApp.world ? APLApp.world.t : 0) + ' [' + kind + '] ' + text); return log0.call(this, kind, text, ...a); };
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
    let frames = 0;
    let lastT = -1e9, stuck = 0, stuckAt = null;
    while (APL.Demo.isActive() && frames < 1200000) {
      const t0 = w.t;
      w.advance(1 / 60);
      APL.Demo.tick(Math.max(0, w.t - t0));
      frames++;
      if (w.t === lastT) { stuck++; if (stuck > 300 && stuckAt === null) stuckAt = { t: w.t, i: APL.Demo.state.index, stop: w._advanceStopAt }; }
      else { stuck = 0; lastT = w.t; }
      if (frames % 2000 === 0) await new Promise(r => setTimeout(r, 0));
      if (APL.Demo.state.failure) break;
    }
    const st = APL.Demo.state.script[APL.Demo.state.index];
    return { logs, fail: APL.Demo.state.failMsg ? APL.Demo.state.failMsg.zh : null, t: w.t, frames,
      active: APL.Demo.isActive(), index: APL.Demo.state.index, stepText: st ? st.text.zh : '(end)',
      stopAt: w._advanceStopAt, stuckAt };
  }, {T, KD, H, ResT});
  console.log(out.logs.join('\n'));
  console.log('\n--- fail: ' + out.fail + '  t=' + out.t.toFixed(0) + ' frames=' + out.frames
    + ' active=' + out.active + ' index=' + out.index + ' step=' + out.stepText
    + ' stopAt=' + out.stopAt + ' stuck=' + JSON.stringify(out.stuckAt));
  await browser.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
