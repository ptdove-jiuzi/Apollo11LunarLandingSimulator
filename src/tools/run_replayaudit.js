// tools/run_replayaudit.js
// ---------------------------------------------------------------------------
// 跑回放验收探针（tools/make_replayaudit_probe.js 生成的 _replayaudit.html），
// 取回 <pre id="rpa"> 的逐项结果，并断言 AGENT_HANDOFF/07 的红线：
//   · 播放期间 World.advance 调用数 = 0（B-NOINTEGRATE）
//   · 全程 World.advance 调用总数 = 0（B-TOTAL）
//   · 同一 t 三次 seek 状态完全一致（C-IDEMPOTENT）
//   · 回放值与样本线性插值一致（C-VS-JSON）
// 用法： node tools/run_replayaudit.js . [M1|M2|M3|M4|M5]
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {pathToFileURL} = require('url');
const {chromium} = require('C:/Users/user/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core');

const root = path.resolve(process.argv[2] || '.');
const mission = process.argv[3] || 'M2';
const out = path.join(root, 'outputs', 'route08');

async function main() {
  // 1) 生成探针 HTML
  const gen = spawnSync(process.execPath, [path.join(root, 'tools', 'make_replayaudit_probe.js'), root], {encoding: 'utf8'});
  process.stdout.write(gen.stdout || '');
  if (gen.status !== 0) { console.error(gen.stderr); process.exitCode = 1; return; }
  const probeFile = path.join(root, 'apollo11', 'webdata', '_replayaudit.html');

  // 2) 无头浏览器跑它
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--allow-file-access-from-files']
  });
  const report = {mission, items: {}, raw: '', verdict: null};
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const url = pathToFileURL(probeFile).href + '?m=' + mission;
    await page.goto(url);
    await page.waitForFunction(() => {
      const el = document.getElementById('rpa');
      return !!el && /PROBE-DONE/.test(el.textContent);
    }, {timeout: 60000});
    report.raw = await page.evaluate(() => document.getElementById('rpa').textContent);
    report.errors = errors;
  } catch (e) {
    report.error = String(e);
    try { report.raw = await (await browser.pages())[0].evaluate(() => {
      const el = document.getElementById('rpa'); return el ? el.textContent : '';
    }); } catch (e2) {}
  } finally { await browser.close(); }

  // 3) 解析
  for (const line of report.raw.split('\n')) {
    const m = /^\[([A-Z0-9\-]+)\]\s*(.*)$/.exec(line.trim());
    if (m) report.items[m[1]] = m[2];
  }
  const num = (s) => { const m = /=\s*(\d+)/.exec(s || ''); return m ? parseInt(m[1], 10) : null; };
  const checks = [];
  const advPlay = num(report.items['B-NOINTEGRATE']);
  const advTotal = num(report.items['B-TOTAL']);
  checks.push(['B-NOINTEGRATE 播放期 advance 调用 = 0', advPlay === 0, report.items['B-NOINTEGRATE']]);
  checks.push(['B-TOTAL 全程 advance 调用 = 0', advTotal === 0, report.items['B-TOTAL']]);
  checks.push(['C-IDEMPOTENT 同一 t 三次取状态一致',
    /完全一致/.test(report.items['C-IDEMPOTENT'] || ''), report.items['C-IDEMPOTENT']]);
  checks.push(['C-VS-JSON 与样本插值一致',
    /一致/.test(report.items['C-VS-JSON'] || '') && !/不一致/.test(report.items['C-VS-JSON'] || ''),
    report.items['C-VS-JSON']]);
  checks.push(['A-MODE 回放模式标识', !!report.items['A-MODE'], report.items['A-MODE']]);
  checks.push(['LOAD 轨迹加载成功', /加载=true/.test(report.items['LOAD'] || ''), report.items['LOAD']]);
  checks.push(['D-EXIT 退出回 live', !!report.items['D-EXIT'], report.items['D-EXIT']]);

  console.log('\n--- 回放审计 ' + mission + ' ---');
  let bad = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) bad++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '   ' + detail : ''));
  }
  if (report.errors && report.errors.length) {
    bad++;
    console.log('  ❌ 页面异常 ' + report.errors.length + ' 条：' + report.errors.slice(0, 3).join(' | '));
  }
  report.verdict = bad ? 'FAIL(' + bad + ')' : 'PASS';
  console.log(bad ? '\n★ 回放审计不达标：' + bad + ' 项' : '\n★ 回放审计通过');
  fs.writeFileSync(path.join(out, 'replayaudit-' + mission + '.txt'),
    report.raw + '\n\n--- 判定 ---\n' + checks.map(c => (c[1] ? 'OK   ' : 'FAIL ') + c[0] + '  ' + (c[2] || '')).join('\n')
    + '\nverdict=' + report.verdict + '\n');
  fs.writeFileSync(path.join(out, 'replayaudit-' + mission + '.json'), JSON.stringify(report, null, 2));
  process.exitCode = bad ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
