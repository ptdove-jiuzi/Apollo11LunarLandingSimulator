// 生成 _bughunt2_probe.html：把 index.html 复制一份并注入 bughunt2.js，
// 用无头 Edge --dump-dom 抓 __APOLLO_BUGHUNT2__ 的结果。
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');
const hunt = fs.readFileSync(path.join(dir, 'tools', 'bughunt2.js'), 'utf8');
const probe = `
<pre id="hunt2out" style="display:none"></pre>
<script>
setTimeout(function () {
  try { document.getElementById('hunt2out').textContent = window.__APOLLO_BUGHUNT2__ || '(尚未完成)'; }
  catch (e) { document.getElementById('hunt2out').textContent = 'ERR ' + e.message; }
}, 25000);
</script>
<script>
${hunt}
</script>
`;
html = html.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(webdata, '_bughunt2_probe.html'), html);
console.log('wrote _bughunt2_probe.html');
