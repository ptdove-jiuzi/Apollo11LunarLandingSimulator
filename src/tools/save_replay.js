// 从 _replay_probe.html 的 dump 中提取轨迹 JSON → apollo11/webdata/traj/<M>.json
// 并生成「真实阿波罗 11 号目标」偏差报告；超限时以非零码退出（生成器失败）。
// 用法：node tools/save_replay.js <dump.html> <M1|M2|M3|M4|M5>
const fs = require('fs'), path = require('path'), vm = require('vm');

const dump = process.argv[2];
const M = process.argv[3] || 'M1';
const dir = process.argv[4] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');

// ---- 载入模块（用于轨道根数 / 经纬度换算）----
const ctx = { console, Math, isFinite, Number, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(webdata, 'js', f), 'utf8'), ctx, { filename: f });
const { V, M: MM, Astro: A, Physics: P, BODY } = ctx.APL;

const html = fs.readFileSync(dump, 'utf8');
function grab(tag) {
  const m = html.match(new RegExp('<pre id="' + tag + '"[^>]*>([\\s\\S]*?)</pre>'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
}
const metaTxt = grab('metainfo');
const tj = grab('trajout');
if (!tj) { console.error('❌ dump 里没有 trajout（生成失败？）'); console.log(metaTxt); process.exit(1); }
const traj = JSON.parse(tj);
const logs = metaTxt.split('\n').filter(l => l.startsWith('[LOG]'));

// ---- 写文件 ----
const trajDir = path.join(webdata, 'traj');
fs.mkdirSync(trajDir, { recursive: true });
const outFile = path.join(trajDir, M + '.json');
fs.writeFileSync(outFile, JSON.stringify(traj));
console.log('✅ 轨迹已写入 ' + outFile + '  (' + (fs.statSync(outFile).size / 1024).toFixed(0) + ' KB, ' +
  traj.samples.length + ' 样本, ' + traj.events.length + ' 事件)');

// ---- 偏差报告 ----
const gates = [];
function gate(name, target, actual, tol, unit) {
  const ok = actual !== null && isFinite(actual) && Math.abs(actual - target) <= tol;
  gates.push({ name, target, actual, tol, unit, ok });
  return ok;
}
function gateAbs(name, actual, tol, unit) {   // 上界型
  const ok = actual !== null && isFinite(actual) && actual <= tol;
  gates.push({ name, target: '≤' + tol, actual, tol, unit, ok });
  return ok;
}
const S = traj.samples;
function craftAt(s, i) { return s.c[i]; }
function heroIdx(s) { return (s.hv !== undefined && s.hv >= 0 && s.hv < s.c.length) ? s.hv : 0; }
function lastSample() { return S[S.length - 1]; }
function findFirst(pred) { for (let i = 0; i < S.length; i++) if (pred(S[i], i)) return i; return -1; }

console.log('\n--- ' + M + ' 偏差报告（对照真实阿波罗 11 号）---');
console.log('  末端 t = ' + lastSample().t.toFixed(1) + ' s (' + (lastSample().t / 3600).toFixed(2) + ' h)');

// 停泊轨道（M1/M2/M5）：取"入轨"事件之后的第一个样本
if (['M1', 'M2', 'M5'].includes(M)) {
  // 取"入轨关机之后"的第一个样本：油门为 0 且近地点已抬到 150 km 以上
  let pIdx = -1;
  for (let i = 0; i < S.length; i++) {
    const c0 = craftAt(S[i], 0);
    if (c0.th > 0.001) continue;
    const e0 = MM.elements(BODY.EARTH.mu, at(c0.r), at(c0.v));
    if (isFinite(e0.periapsis) && e0.periapsis - BODY.EARTH.radius > 150) { pIdx = i; break; }
  }
  if (pIdx >= 0) {
    const s = S[pIdx];
    const c = craftAt(s, 0);
    const el = MM.elements(BODY.EARTH.mu, at(c.r), at(c.v));
    gate('停泊轨道近地点高度', 183.2, el.periapsis - BODY.EARTH.radius, 5, 'km');
    gate('停泊轨道远地点高度', 185.9, el.apoapsis - BODY.EARTH.radius, 5, 'km');
    gate('停泊轨道倾角', 32.521, el.i * 180 / Math.PI, 0.2, '°');
    console.log('  （入轨样本 t=' + s.t.toFixed(0) + ' s：' +
      (el.periapsis - BODY.EARTH.radius).toFixed(1) + ' × ' + (el.apoapsis - BODY.EARTH.radius).toFixed(1) +
      ' km, i=' + (el.i * 180 / Math.PI).toFixed(3) + '°）');
  }
}
// TLI：从日志里抠 Δv（本模拟器自己的记录）
const tliLog = logs.find(l => /TLI 点火完成|TLI burn complete|TLI.*Δv/.test(l));
if (tliLog) {
  const m2 = tliLog.match(/Δv\s*=\s*([\d.]+)\s*km\/s/);
  if (m2) gate('TLI 速度增量', 3.05, parseFloat(m2[1]), 0.05, 'km/s');
}
// 着陆点（M4/M5）
const ldIdx = findFirst(s => s.c.some(c => c.ld === 1 && c.pr === 'MOON'));
if (ldIdx >= 0) {
  const s = S[ldIdx], c = s.c.find(c => c.ld === 1 && c.pr === 'MOON');
  const ll = A.moonLatLon(s.t, at(c.r));
  const dLat = (ll.lat - 0.674) * 111.32;
  const dLon = (ll.lon - 23.473) * 111.32 * Math.cos(0.674 * Math.PI / 180);
  const dist = Math.hypot(dLat, dLon);
  gateAbs('着陆点偏差', dist, 1, 'km');
  console.log('  （着陆 t=' + s.t.toFixed(0) + ' s：' + ll.lat.toFixed(4) + '°N ' + ll.lon.toFixed(4) +
    '°E，偏差 ' + (dist * 1000).toFixed(0) + ' m）');
}
// 溅落（M5）
const spIdx = findFirst(s => s.c.some(c => c.ld === 1 && c.pr === 'EARTH'));
if (spIdx >= 0) {
  const s = S[spIdx], c = s.c.find(c => c.ld === 1 && c.pr === 'EARTH');
  const ll = A.earthLatLon(s.t, at(c.r));
  const dLat = (ll.lat - 13.317) * 111.32;
  const dLon = (ll.lon + 169.150) * 111.32 * Math.cos(13.317 * Math.PI / 180);
  const dist = Math.hypot(dLat, dLon);
  gateAbs('溅落点偏差', dist, 100, 'km');
  console.log('  （溅落 t=' + s.t.toFixed(0) + ' s：' + ll.lat.toFixed(3) + '°N ' + ll.lon.toFixed(3) +
    '°E，偏差 ' + dist.toFixed(0) + ' km）');
}
if (M === 'M5') {
  const teiLog = logs.find(l => /TEI/.test(l) && /Δv/.test(l));
  if (teiLog) console.log('  TEI：' + teiLog.replace('[LOG] ', ''));
  const totalTarget = 195 * 3600 + 18 * 60 + 35;      // 703 115 s
  console.log('  总任务时长：' + lastSample().t.toFixed(0) + ' s / 目标 ' + totalTarget + ' s');
}
// 生成模式失败记录
const failures = metaTxt.split('\n').filter(l => /生成模式：/.test(l) || /DRIVE-ERR|FATAL/.test(l));

console.log('\n--- 闸门 ---');
let bad = 0;
for (const g of gates) {
  if (!g.ok) bad++;
  console.log((g.ok ? '  ✅ ' : '  ❌ ') + g.name + '：目标 ' + g.target +
    (g.unit ? ' ' + g.unit : '') + '，实际 ' +
    (g.actual === null ? 'N/A' : Number(g.actual).toFixed(3)));
}
if (failures.length) {
  bad += failures.length;
  console.log('  ❌ 生成期失败记录 ' + failures.length + ' 条：');
  failures.slice(0, 8).forEach(f => console.log('      ' + f.trim()));
}
console.log(bad ? '\n★ 生成失败：' + bad + ' 项不达标（禁止用"演示同步"掩盖）' :
  '\n★ 生成通过：全部闸门达标');
process.exit(bad ? 2 : 0);

function at(a) { return [a[0], a[1], a[2]]; }
