// 导出 M5 的 TLI 原始数据包：给外部火箭/轨道专家复算用。
//   从最新的 M5 生成 dump 里取"点火时刻的停泊轨道状态"，然后导出：
//     · 停泊轨道根数（a/e/i/RAAN/argp/真近点角）与 r/v 向量
//     · 月球在点火时刻与各候选到达时刻的状态（r/v）
//     · 对 TOF ∈ {75.9, 80, 88, 92, 96, 100, 104} h 的两体兰伯特解：
//       Δv、到达 v∞、到达面与着陆点方向夹角、到达近月点（两体近似）
//   用法：node tools/dump_tli_pack.js . [dump 文件名]
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const dumpFile = process.argv[3] || '.tmp/gen5e.html';
const webdata = path.join(dir, 'apollo11', 'webdata');

const ctx = { console, Math, isFinite, Number, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['00-constants.js', '01-math.js', '02-astro.js', '03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(webdata, 'js', f), 'utf8'), ctx, { filename: f });
const { V, M, Astro: A, BODY, SITE, LANDING_SITE } = ctx.APL;

// ---- 取 dump 里最后一个样本（= TLI 点火时刻的卡车状态）----
const html = fs.readFileSync(dumpFile, 'utf8');
const m = html.match(/<pre id="trajout"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) { console.error('dump 里没有 trajout：' + dumpFile); process.exit(1); }
const traj = JSON.parse(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
const last = traj.samples[traj.samples.length - 1];
const c = last.c[0];
const t0 = last.t;
const r0 = c.r.slice(), v0 = c.v.slice();
const mu = BODY.EARTH.mu;

const el = M.elements(mu, r0, v0);
const ms0 = A.moonState(t0);

console.log('===== M5 TLI 原始数据包 =====');
console.log('点火时刻 t = ' + t0.toFixed(1) + ' s（世界时间；发射为 t=0）');
console.log('全堆质量 = ' + c.m + ' kg；模块推进剂 = ' + JSON.stringify(c.mo));
console.log('停泊轨道根数：a=' + (el.a).toFixed(3) + ' km（高度当量 ' + (el.a - BODY.EARTH.radius).toFixed(3) +
  ' km） e=' + el.e.toExponential(6) + ' i=' + (el.i * 180 / Math.PI).toFixed(4) + '° RAAN=' +
  (el.raan * 180 / Math.PI).toFixed(4) + '° argp=' + (el.argp * 180 / Math.PI).toFixed(4) + '°');
console.log('r0 (ECI, km) = [' + r0.map(x => x.toFixed(6)).join(', ') + ']');
console.log('v0 (ECI, km/s) = [' + v0.map(x => x.toFixed(9)).join(', ') + ']');
console.log('月球 @ t0: r=[' + ms0.r.map(x => x.toFixed(3)).join(', ') + '] |r|=' + V.mag(ms0.r).toFixed(3) +
  ' km  v=[' + ms0.v.map(x => x.toFixed(6)).join(', ') + '] |v|=' + V.mag(ms0.v).toFixed(6) + ' km/s');
// 月球轨道面（对黄道/赤道的倾角）
const hM = V.cross(ms0.r, ms0.v), nH = V.unit(hM);
console.log('月球轨道面法向（ECI）= [' + nH.map(x => x.toFixed(6)).join(', ') + ']  与赤道面夹角=' +
  (Math.acos(Math.abs(nH[2])) * 180 / Math.PI).toFixed(3) + '°');
console.log('停泊轨道面法向      = [' + V.unit(V.cross(r0, v0)).map(x => x.toFixed(6)).join(', ') + ']');
const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(V.unit(V.cross(r0, v0)), nH)))) * 180 / Math.PI;
console.log('停泊面 ↔ 月球轨道面夹角 = ' + ang.toFixed(3) + '°');

console.log('\n---- 各候选飞行时间的两体兰伯特解（从 t0 的停泊状态出发，瞄准月心）----');
console.log('TOF(h)   Δv(m/s)  到达v∞(km/s)  到达面vs站点(°)  两体近月点(km)  |月球|(km)');
const tofs = [75.9, 80, 84, 88, 92, 96, 100, 104];
for (const th of tofs) {
  const tof = th * 3600;
  const tg = A.moonState(t0 + tof);
  const Lb = M.lambert(mu, r0, tg.r, tof, true);
  if (!Lb) { console.log(th.toFixed(1).padStart(6) + '   （兰伯特无解/需多圈）'); continue; }
  const dv = V.mag(V.sub(Lb.v1, v0)) * 1000;
  const vInf = V.mag(V.sub(Lb.v2, tg.v));
  // 到达面 = 转移轨道在到达处的平面（法向 = r2 × v2），站点方向 = 月面点到月心
  const nT = V.unit(V.cross(tg.r, Lb.v2));
  const sp = A.moonSurfacePoint(t0 + tof, LANDING_SITE.lat, LANDING_SITE.lon, 0);
  const sHat = V.unit(V.sub(sp.r, tg.r));
  const planeDeg = Math.asin(Math.min(1, Math.abs(V.dot(nT, sHat)))) * 180 / Math.PI;
  // 两体近月点：用相对月球的双曲线近似（用到达点的相对位置/速度）
  const relR = V.sub(tg.r, tg.r), relV = V.sub(Lb.v2, tg.v);
  let peri = NaN;
  const muM = BODY.MOON.mu;
  const vv = V.mag(relV);
  if (vv > 1e-9) {
    const rM = V.mag(V.sub(tg.r, tg.r));   // 到达点在月心的相对位置≈0（我们瞄的是月心）→ 近似用 v∞ 与 B 面
    const hh = V.mag(V.cross(V.sub(r0, tg.r), V.sub(Lb.v1, tg.v)));  // 近似角动量（用出发点相对月球）
    peri = hh * hh / muM / 1e3;  // 近似
  }
  console.log(th.toFixed(1).padStart(6) + '  ' + dv.toFixed(0).padStart(8) + '  ' + vInf.toFixed(4).padStart(11) +
    '  ' + planeDeg.toFixed(4).padStart(15) + '  ' + (isFinite(peri) ? peri.toFixed(0) : '?').padStart(13) +
    '  ' + V.mag(tg.r).toFixed(0).padStart(10));
}
console.log('\n（说明：两体解只用于给专家对照；我们的求解器用全模型 + 有限弧打靶，' +
  '结果见 AGENT_HANDOFF/10。近月点一列是粗略近似，只看数量级。）');
