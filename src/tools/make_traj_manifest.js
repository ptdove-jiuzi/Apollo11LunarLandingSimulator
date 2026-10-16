// 生成 apollo11/webdata/traj/manifest.json：列出哪些任务已有合格离线轨迹。
// 播放器（12-replay.js）用它把"暂无轨迹"的任务【自动演示】按钮置灰，
// 免得玩家点了才看到红色报错。每次生成/删改 traj/*.json 后跑一次即可。
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const trajDir = path.join(dir, 'apollo11', 'webdata', 'traj');
const files = fs.readdirSync(trajDir).filter(f => /^M\d+\.json$/.test(f));
const available = files.map(f => f.replace(/\.json$/, '')).sort();
const info = {};
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(trajDir, f), 'utf8'));
    const last = j.samples && j.samples.length ? j.samples[j.samples.length - 1] : null;
    info[f.replace(/\.json$/, '')] = {
      samples: j.samples ? j.samples.length : 0,
      spanS: last ? Math.round(last.t) : 0
    };
  } catch (e) { /* 坏文件不进 manifest */ }
}
const out = { available, info, generated: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(path.join(trajDir, 'manifest.json'), JSON.stringify(out, null, 1));
console.log('manifest:', JSON.stringify(out.available), JSON.stringify(info));
