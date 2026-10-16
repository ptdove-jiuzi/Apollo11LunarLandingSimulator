// 任务卡片【自动演示】按钮状态探针：验证 traj/manifest.json 生效后，
// 无轨迹任务（当前是 M5）的按钮被置灰并写明原因。
// 用法：node tools/make_picker_probe.js . → apollo11/webdata/_picker_probe.html
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const webdata = path.join(dir, 'apollo11', 'webdata');
let html = fs.readFileSync(path.join(webdata, 'index.html'), 'utf8');

const probe = [
  '<pre id="pkout" style="display:none"></pre>',
  '<script>',
  '(function () {',
  '  var el = document.getElementById("pkout"); var f = 0;',
  '  function rep(s) { el.textContent += String(s) + "\\n"; }',
  '  var t = setInterval(function () {',
  '    f++;',
  '    if (!window.APLApp || !window.APL || !APL.Replay) return;',
  '    if (f === 40) { if (APLApp.showMissionPicker) APLApp.showMissionPicker(); }',
  '    if (f === 90) {',
  '      var cards = document.querySelectorAll("#missionList .mcard");',
  '      rep("卡片数=" + cards.length);',
  '      Array.prototype.forEach.call(cards, function (c) {',
  '        var b = c.querySelector("button.demo");',
  '        rep(c.dataset.mid + ": " + (b ? ("\\"" + b.textContent + "\\" disabled=" + b.disabled) : "无按钮"));',
  '      });',
  '      rep("manifest.available=" + JSON.stringify(APL.Replay.available));',
  '      clearInterval(t);',
  '    }',
  '  }, 8);',
  '})();',
  '<\/script>'
].join('\n');

html = html.replace('</body>', probe + '</body>');
fs.writeFileSync(path.join(webdata, '_picker_probe.html'), html);
console.log('wrote', path.join(webdata, '_picker_probe.html'));
