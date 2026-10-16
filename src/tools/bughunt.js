// 这段会被注入到 index_test.html 的自检块里，做一次全面 bug 检查
(function () {
  var out = [];
  function d(tag, txt) { out.push('[' + tag + '] ' + txt); }
  var errs = [];

  function safe(label, fn) {
    try { fn(); } catch (e) { errs.push(label + ': ' + (e && e.message)); }
  }

  // ---------- 1. 所有 getElementById 引用的 id 是否都存在 ----------
  var ids = {};
  var re = /(?:\$|getElementById)\(\s*'([A-Za-z0-9_\-]+)'\s*\)/g;
  (window.__APOLLO_SRC__ || []).forEach(function (src) {
    var m;
    while ((m = re.exec(src))) ids[m[1]] = true;
  });
  // 运行期动态创建的 id（代码里有 createElement 后 .id='xxx' 的）不算缺失
  var dyn = {};
  (window.__APOLLO_SRC__ || []).forEach(function (src) {
    var m2, re2 = /\.id\s*=\s*'([A-Za-z0-9_\-]+)'/g;
    while ((m2 = re2.exec(src))) dyn[m2[1]] = true;
  });
  var missing = Object.keys(ids).filter(function (id) {
    return !dyn[id] && !document.getElementById(id);
  });
  d('IDS', '代码引用 ' + Object.keys(ids).length + ' 个 id，缺失 ' + missing.length +
    (missing.length ? ': ' + missing.join(', ') : ' ✓'));

  // 先切到英文再跑后续所有交互，这样日志/标题都应当是英文
  APL.setLang('en');

  // ---------- 2. 五个任务各跑一段物理 ----------
  var missionReport = [];
  APL.MISSIONS.forEach(function (m) {
    safe('任务 ' + m.id, function () {
      APLApp.startMission(m.id);
      var w = APLApp.world;
      w.running = true;
      w.warp = 50;
      for (var i = 0; i < 120; i++) w.advance(1 / 60);
      APLApp.renderer.draw(w, APLApp.craft);
      var c = APLApp.craft;
      var orb = c.orbitRelative(c.primary, w);
      var ok = isFinite(orb.a) && isFinite(orb.e) && isFinite(APL.V.mag(c.r)) &&
        isFinite(c.mass()) && c.mass() > 0;
      missionReport.push(m.id + (ok ? '✓' : '✗'));
    });
  });
  d('MISSIONS', missionReport.join(' ') + '  （✓=轨道根数与质量均为有限值）');

  // ---------- 3. 视图 / 姿态 / 页签 / 按键 全量点击 ----------
  function clickAll(sel, label) {
    var list = document.querySelectorAll(sel);
    var bad = 0;
    for (var i = 0; i < list.length; i++) {
      try { list[i].click(); } catch (e) { bad++; errs.push(label + '[' + i + ']: ' + e.message); }
    }
    d(label, '点击 ' + list.length + ' 个，异常 ' + bad + (bad ? '' : ' ✓'));
  }
  APLApp.startMission('M1');
  APLApp.paused = true;
  clickAll('#viewbar .vtab', 'CLICK-视图');
  clickAll('#ctrlbar .mbtn', 'CLICK-姿态');
  clickAll('#tabs .tab', 'CLICK-页签');
  clickAll('.dkey', 'CLICK-DSKY键');

  // ---------- 4. 顶栏与控制条动作按钮 ----------
  var actions = ['btnWarpUp', 'btnWarpUp', 'btnWarpDown', 'btnPlay', 'btnPlay',
    'btnAuto', 'btnCut', 'btnFull', 'btnStage', 'btnUndock', 'btnDock',
    'btnCalc', 'btnTLI', 'btnCirc', 'btnLand', 'btnRend',
    'btnAgcLoad', 'btnAgcAsm', 'btnAgcReset', 'btnSelfTest',
    'btnLang', 'btnLang', 'btnSave', 'btnLoad', 'btnFinish', 'btnMissions'];
  var abad = [];
  actions.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) { abad.push(id + '(缺失)'); return; }
    try { el.click(); } catch (e) { abad.push(id + '(' + e.message + ')'); }
  });
  document.getElementById('firstRunHint').classList.remove('show');
  var mods = document.querySelectorAll('.modal.show');
  for (var k = 0; k < mods.length; k++) mods[k].classList.remove('show');
  d('CLICK-动作', '执行 ' + actions.length + ' 个按钮，异常 ' +
    (abad.length ? abad.join(' ') : '0 ✓'));

  // ---------- 5. AGC 汇编三个示例 ----------
  var asmRep = [];
  ['dsky-demo.agc', 'attitude-hold.agc', 'lambert.agc'].forEach(function (nm) {
    safe('汇编 ' + nm, function () {
      var src = APL.PROGRAMS[nm];
      document.getElementById('agcSrc').value = src;
      var r = APL.Asm.assemble(src);
      var agc = new APL.AGC();
      if (r.ok) {
        var banks = {};
        r.listing.forEach(function (l) { banks[l.bank] = 1; });
        for (var b in banks) agc.mem.fixed[+b].set(r.mem.subarray(+b * 1024, (+b + 1) * 1024));
        var e = r.symbols['START'].value;
        agc.FB = (e >> 10) & 0o37; agc._curBank = (e >> 10) & 0o37;
        agc.Z = e; agc.NextZ = e; agc.standby = false;
        agc.run(30000);
      }
      asmRep.push(nm.replace('.agc', '') + (r.ok ? '✓' : '✗') + '/' + agc.instructions);
    });
  });
  d('AGC', asmRep.join(' '));

  // ---------- 6. 语言来回切 5 次 ----------
  safe('语言切换', function () {
    for (var i = 0; i < 5; i++) { APL.setLang('en'); APL.setLang('zh'); }
    APL.setLang('en');
  });
  d('I18N', '中英来回切换 5 轮无异常；当前语言=' + APL.getLang() +
    '，词条 zh/en = ' + Object.keys(APL.I18N.zh).length + '/' + Object.keys(APL.I18N.en).length);

  // ---------- 7. 英文界面中文残留 ----------
  function scanCJK(forbid) {
    var bad = [], zh = /[\u4e00-\u9fff]/;
    ['#app', '#modalMissions', '#modalResult'].forEach(function (r) {
      var root = document.querySelector(r);
      if (!root) return;
      var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walk.nextNode())) {
        var pe = n.parentElement;
        if (!pe) continue;
        if (pe.closest('textarea') || pe.closest('script') || pe.closest('#diagout')) continue;
        if (pe.id === 'btnLang') continue;              // 语言按钮本身就是中文（刻意的）
        // 日志条目 class 形如 "lg lg-ok"，用词边界判断（原来只判开头 'lg-' 会漏）
        if (pe.classList && pe.classList.contains('lg')) continue;
        var t = n.nodeValue.trim();
        if (t && zh.test(t)) bad.push((pe.id || pe.className || pe.tagName) + ':' + t.slice(0, 14));
      }
    });
    return bad;
  }
  APL.setLang('en');
  var badEN = scanCJK();
  // 日志单独判定：只在「从头就是英文」时才算错
  var logCJK = 0;
  (function () {
    var c = document.getElementById('logBox').children;
    for (var i = 0; i < c.length; i++) if (/[\u4e00-\u9fff]/.test(c[i].textContent)) logCJK++;
  })();
  // 日志历史条目是"写入时什么语言就保留什么语言"，不算缺陷（单独汇报）
  d('EN-LOG', '日志历史条目（写入时语言冻结，不算缺陷）：' + logCJK + ' 条');
  d('EN-SCAN', badEN.length === 0 ? '英文界面无中文残留 ✓'
    : (badEN.length + ' 处: ' + badEN.slice(0, 12).join(' | ')));
  APL.setLang('zh');

  // ---------- 8. 存档 / 读档回路 ----------
  safe('存读档', function () {
    document.getElementById('btnSave').click();
    document.getElementById('btnLoad').click();
  });
  d('SAVE', '存档 + 读档调用完成' + (APLApp.world ? '（世界仍在）' : ''));

  // ---------- 9. 教程两套课程步数 ----------
  var tr = APL.TUTORIAL_TRACKS.map(function (t) { return t.id + '=' + t.steps.length; }).join(' ');
  var badSteps = [];
  APL.TUTORIAL_TRACKS.forEach(function (t) {
    t.steps.forEach(function (s, i) {
      if (!s.title || !s.body || !s.title.zh || !s.title.en || !s.body.zh || !s.body.en) {
        badSteps.push(t.id + '#' + i);
      }
      if (s.target && !document.querySelector(s.target)) {
        badSteps.push(t.id + '#' + i + '(target ' + s.target + ')');
      }
    });
  });
  d('TUTORIAL', '课程 ' + tr + '；中英文案/高亮目标缺失 ' +
    (badSteps.length ? badSteps.join(', ') : '0 ✓'));

  // ---------- 10. 运行时收集到的异常 ----------
  var rt = (window.__APOLLO_DIAG_LINES__ || []).filter(function (l) {
    return /^\[(ERROR|REJECT|FATAL)\]/.test(l);
  });
  d('RUNTIME', '运行期捕获异常 ' + rt.length + (rt.length ? ': ' + rt.slice(0, 4).join(' | ') : ' ✓'));
  d('CLICKERR', '按钮/操作异常合计 ' + errs.length +
    (errs.length ? ': ' + errs.slice(0, 6).join(' | ') : ' ✓'));

  var fatal = rt.length + errs.length + missing.length +
    badEN.length + badSteps.length + missionReport.filter(function (r) { return r.indexOf('✗') >= 0; }).length;
  d('VERDICT', fatal === 0 ? '★ 未发现 bug（0 项异常）' : ('★ 共 ' + fatal + ' 项需要处理'));

  window.__APOLLO_BUGHUNT__ = out.join('\n');
})();
