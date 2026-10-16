// 教程槽位验证：跑 nav 教程前 3 步，报告卡片位置与焦点按钮。
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');
const probe = [
  '<pre id="tsout" style="display:none"></pre>',
  '<script>',
  '(function () {',
  '  var el = document.getElementById("tsout"); var f = 0;',
  '  var t = setInterval(function () {',
  '    f++;',
  '    if (!window.APL || !APL.Tutorial) return;',
  '    if (f === 40) { APL.Tutorial.startTrack("nav"); APL.Tutorial.go(1); }',
  '    if (f === 60 || f === 90 || f === 120) {',
  '      var c = document.getElementById("tutCard");',
  '      var nb = document.activeElement;',
  '      el.textContent += "step " + APL.Tutorial.index + ": card@" + c.style.left + "," + c.style.top',
  '        + "  focus=" + (nb ? nb.id : "none") + "\\n";',
  '      if (APL.Tutorial.index < 2) APL.Tutorial.go(APL.Tutorial.index + 1);',
  '    }',
  '    if (f === 150) { clearInterval(t); }',
  '  }, 10);',
  '})();',
  '<\/script>'
].join('\n');
html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_tut_probe.html'), html);
console.log('wrote _tut_probe.html');
