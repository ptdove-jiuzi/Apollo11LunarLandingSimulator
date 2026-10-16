// 生成 _bughunt_probe.html：把 index.html 复制一份并注入 bughunt.js，
// 用无头 Edge --dump-dom 抓 __APOLLO_BUGHUNT__ 的结果。
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');
const hunt = fs.readFileSync(path.join(dir, 'tools', 'bughunt.js'), 'utf8');
const files = ['00-constants.js','01-math.js','02-astro.js','03-physics.js','04-agc.js',
               '05-asm.js','06-render.js','07-app.js','08-programs.js','09-i18n.js',
               '10-tutorial.js','11-demo.js'];
const probe = `
<pre id="huntout" style="display:none"></pre>
<script>
window.__APOLLO_SRC__ = [];
var _files = ${JSON.stringify(files)};
var _left = _files.length;
_files.forEach(function (f) {
  fetch('js/' + f).then(function (r) { return r.text(); }).then(function (t) {
    window.__APOLLO_SRC__.push(t);
  }).catch(function () {}).then(function () {
    if (--_left === 0) runHunt();
  });
});
function runHunt() {
  setTimeout(function () {
    try { ${''} } catch (e) {}
    try {
      (function(){ ${hunt} })();
      document.getElementById('huntout').textContent = window.__APOLLO_BUGHUNT__ || '(空)';
    } catch (e) {
      document.getElementById('huntout').textContent = 'HUNT-ERROR: ' + ((e && e.stack) || e);
    }
  }, 1400);
}
<\/script>
`;
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_bughunt_probe.html'), html);
console.log('wrote _bughunt_probe.html');
