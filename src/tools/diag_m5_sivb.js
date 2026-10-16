// 诊断 M5 入轨段 S-IVB 空烧：逐样本打印 t / 速度 / 高度 / 油门 / S-IVB 推进剂 / 姿态模式
// 用法: node tools/diag_m5_sivb.js outputs/route08/M5-run.json [t0] [t1]
const fs = require('fs');
const path = process.argv[2] || 'outputs/route08/M5-run.json';
const t0 = parseFloat(process.argv[3] || '480');
const t1 = parseFloat(process.argv[4] || '1050');
const J = JSON.parse(fs.readFileSync(path, 'utf8'));
const tr = J.traj || J;
const S = tr.samples;
const Rm = 1737.4, muE = 398600.4418;
function speed(s) { const c = s.c[0]; return Math.hypot(c.v[0], c.v[1], c.v[2]); }
function rad(s) { const c = s.c[0]; return Math.hypot(c.r[0], c.r[1], c.r[2]); }
function sivb(s) { const m = s.c[0].mo.find(x => x[0] === 'S-IVB'); return m ? m[1] : null; }
console.log('t\tv(km/s)\talt(km)\tth\tS-IVB(kg)\tstage\tmode');
let prev = null;
for (const s of S) {
  if (s.t < t0 || s.t > t1) continue;
  const c = s.c[0];
  const v = speed(s), r = rad(s), alt = r - 6378.137;
  console.log([
    s.t.toFixed(2), (v / 1000).toFixed(5), alt.toFixed(2),
    (c.th === undefined ? '?' : c.th.toFixed(3)), (sivb(s) === null ? '-' : sivb(s)),
    c.st, (c.at ? 'att' : '-')
  ].join('\t'));
}
console.log('\n--- 平台检测（|dv/dt| < 0.5 m/s² 且 th>0.5）---');
let inPlateau = false, pStart = null, pEnd = null;
for (let i = 1; i < S.length; i++) {
  const a = S[i - 1], b = S[i];
  if (b.t < t0 || b.t > t1) continue;
  const dv = Math.abs(speed(b) - speed(a));
  const dt = b.t - a.t;
  const acc = dt > 0 ? dv / dt : 0;
  const th = b.c[0].th || 0;
  const isP = (acc < 0.5 && th > 0.5);
  if (isP && !inPlateau) { inPlateau = true; pStart = b.t; }
  if (!isP && inPlateau) {
    inPlateau = false; pEnd = b.t;
    const dProp = (sivb(S.find(x => x.t >= pStart)) || 0) - (sivb(b) || 0);
    console.log('平台 ' + pStart.toFixed(2) + ' → ' + pEnd.toFixed(2) + ' s (' + (pEnd - pStart).toFixed(1) + ' s) 耗 S-IVB ' + dProp.toFixed(0) + ' kg');
  }
}
