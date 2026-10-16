// 诊断 M5：打印飞船构成与原始状态向量
const fs = require('fs');
const J = JSON.parse(fs.readFileSync(process.argv[2] || 'outputs/route08/M5-run.json', 'utf8'));
const tr = J.traj || J;
const S = tr.samples;
console.log('样本数=' + S.length + '  事件=' + (tr.events || []).length);
console.log('\n--- 事件(步骤) ---');
for (const e of (tr.events || [])) console.log('  T+' + e.t.toFixed(0) + ' i=' + e.i + ' ' + e.zh);
console.log('\n--- wlog ---');
for (const e of (tr.wlog || [])) console.log('  T+' + e.t.toFixed(0) + ' [' + e.tag + '] ' + e.text);
function dump(i) {
  const s = S[i];
  console.log('\n=== sample #' + i + '  t=' + s.t + ' ===');
  s.c.forEach((c, k) => {
    console.log('  craft[' + k + '] id=' + c.id + ' st=' + c.st + ' pr=' + c.pr + ' lm=' + c.lm + ' ld=' + c.ld + ' cr=' + c.cr +
      ' th=' + c.th + ' m=' + c.m);
    console.log('     r=' + JSON.stringify(c.r) + ' |r|=' + Math.hypot(c.r[0], c.r[1], c.r[2]).toFixed(1) + ' km');
    console.log('     v=' + JSON.stringify(c.v) + ' |v|=' + Math.hypot(c.v[0], c.v[1], c.v[2]).toFixed(4) + ' km/s');
    console.log('     mo=' + JSON.stringify(c.mo));
  });
}
dump(0);
// 找 t 接近 480 / 552 / 860 / 941 / 1009
for (const tt of [480, 552, 700, 860, 900, 941, 980, 1009]) {
  let best = 0; for (let i = 0; i < S.length; i++) if (Math.abs(S[i].t - tt) < Math.abs(S[best].t - tt)) best = i;
  const s = S[best]; const c = s.c[0];
  console.log('t~' + tt + ' -> #' + best + ' t=' + s.t.toFixed(2) +
    ' |v|=' + Math.hypot(c.v[0], c.v[1], c.v[2]).toFixed(5) +
    ' alt=' + (Math.hypot(c.r[0], c.r[1], c.r[2]) - 6378.137).toFixed(2) +
    ' th=' + c.th + ' st=' + c.st + ' S-IVB=' + (c.mo.find(x => x[0] === 'S-IVB') || ['', '-'])[1]);
}
