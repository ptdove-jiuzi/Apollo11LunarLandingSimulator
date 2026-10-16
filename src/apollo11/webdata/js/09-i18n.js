/* =========================================================================
 *  09-i18n.js  —  中英文双语
 *  用法：
 *    APL.t('top.met')                 取当前语言文案
 *    APL.t('tut.step', {n:3, N:12})   支持 {key} 占位
 *    APL.setLang('en')                切换并刷新界面
 *  HTML 里用 data-i18n / data-i18n-ph / data-i18n-title 标记。
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL || (global.APL = {});

  var DICT = {
    zh: {
      'app.title': '阿波罗11号登月模拟器',
      'brand.sub': '登月模拟器',
      'top.met': '任务时间 MET',
      'top.utc': '世界时',
      'top.warp': '时间倍率',
      'top.perf': '性能',
      'btn.play': '▶ 继续',
      'btn.pause': '⏸ 暂停',
      'btn.save': '存档',
      'btn.load': '读档',
      'btn.finish': '评定',
      'btn.missions': '选择任务',
      'btn.tutorial': '新手教程',
      'btn.lang': 'EN',
      'btn.close': '关闭',

      'panel.telemetry': '遥测 TELEMETRY',
      'f.primary': '主天体',
      'f.alt': '高度',
      'f.speed': '轨道速度',
      'f.vr': '垂直速度',
      'f.vh': '水平速度',
      'f.fpa': '航迹角',
      'f.apo': '远地点',
      'f.per': '近地点',
      'f.ecc': '偏心率',
      'f.inc': '倾角',
      'f.period': '周期',
      'f.phase': '相位角',
      'f.mass': '总质量',
      'f.thrust': '推力',
      'f.accel': '加速度',
      'f.dv': '已用 Δv',
      'f.moonDist': '距月球',
      'f.moonPhase': '月相照度',
      'f.sunElev': '着陆点日照仰角',
      'f.siteDist': '到静海基地',
      'sec.stages': '推进级 / 推进剂',
      'body.earth': '地球',
      'body.moon': '月球',

      'view.system': '地月全景',
      'view.earth': '近地',
      'view.moon': '近月',
      'view.craft': '跟随',
      'view.polar': '轨道面俯视',
      'view.mode': '视角模式',
      'view.mode3d': '3D',
      'view.mode2d': '2D',
      'rv.moonDir': '月球方向',
      'view.hint': '左键拖动旋转（2D 下为平移）· 滚轮缩放 · 双击复位',
      'btn.predictOn': '轨道预演：开',
      'btn.predictOff': '轨道预演：关',
      'btn.predictTip': '按飞船当前速度与全部引力（地球/月球/太阳）实时外推接下来会飞到哪里',
      'rv.vernal': '春分点方向',
      'rv.apseDir': '近拱点方向（轨道椭圆长轴）',
      'rv.nodeDir': '升交点方向',
      'rv.planeTop': '垂直于轨道面 90° 俯视',
      'rv.sun': '☉ 太阳方向',
      'rv.site': '静海基地',
      'rv.launchSite': 'LC-39A 发射台',
      'rv.legend': '视场约 {span} · 视图 {view}',
      'rv.millionKm': '百万 km',
      'rv.thousandKm': '千 km',
      'rv.km': ' km',
      'rv.idleTitle': '阿波罗 11 号登月模拟器',
      'rv.idleHint': '还没有选择任务',
      'rv.idleHow': '点击右上角【选择任务】挑一个关卡开始；\n第一次玩可以先点【新手教程】。',

      'grp.attitude': '姿态',
      'mode.launch': '上升制导',
      'mode.prograde': '顺行',
      'mode.retrograde': '逆行',
      'mode.radial': '径向外',
      'mode.antiradial': '径向内',
      'mode.normal': '法向',
      'mode.antinormal': '反法向',
      'mode.vgo': '入轨制导',
      'mode.hold': '保持姿态',
      'grp.throttle': '油门',
      'btn.cut': '关机',
      'btn.full': '全推力',
      'grp.action': '动作',
      'btn.auto': '自动驾驶',
      'btn.stage': '分级 / 抛离',
      'btn.undock': '分离登月舱',
      'btn.dock': '对接登月舱',
      'grp.mode': '当前模式',

      'dsky.agcReady': 'AGC 运行中 · 已就绪',
      'dsky.instructions': '已执行指令',
      'dsky.cycles': '机器周期',
      'dsky.recent': '最近执行的指令',
      'dsky.none': '（未载入程序）',

      'tab.log': '飞行日志',
      'tab.calc': '轨道计算器',
      'tab.agc': 'AGC 汇编终端',
      'tab.down': '下传遥测',
      'tab.time': '任务时序',
      'tab.test': '系统自检',
      'btn.switch': '切换飞行器',
      'btn.switchTo': '切换到 {id}',
      'demo.act': '本步操作：',
      'demo.actAuto': '本步由制导自动完成（在遥测里看结果）',
      'tut.group.ui': '界面教程（认识界面与操作）',
      'tut.group.mission': '任务教程（从零开始，一个任务一个任务打）',
      'tab.guide': '制导手册',
      'guide.head': '制导手册 —— 每一条制导律的适用阶段、原理与真实 Apollo 程序号的对应关系；以及每个面板控件「什么时候用 / 点了会发生什么 / 典型操作序列」。',

      'calc.tof': '转移飞行时间',
      'calc.hour': '小时',
      'calc.targetAlt': '入轨目标高度',
      'calc.km': 'km',
      'btn.calc': '计算轨道',
      'btn.tli': '执行 TLI 点火',
      'btn.circ': '入轨圆化制导',
      'btn.land': '动力下降制导',
      'btn.rend': '交会辅助点火',
      'calc.note': '计算器用通用变量兰伯特求解器，把飞船从当前地球轨道推到「飞行时间之后月球所在位置」，给出需要的点火速度增量。真实 Apollo 11 的 TLI 点火 Δv 约 3.05 km/s，飞行约 73 小时后到达月球并执行 LOI。',
      'calc.hint': '点击「计算轨道」开始求解。',

      'agc.program': '示例程序',
      'btn.load2': '载入',
      'btn.agcReset': 'AGC 复位',
      'btn.agcAsm': '汇编并装载到 AGC',
      'btn.agcRun': '⏸ 暂停',
      'btn.agcRunRun': '▶ 运行',
      'agc.file': '载入 .agc 文件',
      'agc.outHint': '汇编输出将显示在这里。',
      'down.channels': 'AGC 下传通道（最近写入）',
      'down.events': 'DSKY 键盘与告警',
      'down.none': '（尚无通道写入）',
      'down.noneKeys': '（尚无键盘事件）',
      'down.noAlarm': '（无告警）',

      'time.head': 'Apollo 11 真实任务时序（GET，自点火起飞）',
      'time.th1': 'GET', 'time.th2': '事件', 'time.th3': '说明',
      'test.head': '系统自检',
      'btn.retest': '重新运行自检',

      'mis.title': '选择任务',
      'mis.intro': '全部轨道计算基于真实 Apollo 11（SA-506）飞行数据与 Meeus 月球历表实现。预设 5 项任务，从点火起飞到溅落回收。',
      'mis.start': '开始任务',
      'mis.demo': '自动演示',
      'mis.demoTip': '（自动从发射飞到着陆 / 溅落，可随时停止）',
      'demo.label': '自动演示',
      'demo.stop': '停止演示',
      'rp.label': '轨迹回放',
      'rp.exit': '退出回放',
      'rp.modeLive': '实时模拟',
      'rp.modeReplay': '回放模式·固定样本',
      'dsky.help': '用法：VERB → 两位数字 → NOUN → 两位数字 → ENTR 提交；CLR 清除键入；空按 ENTR 会亮 OPR ERR。例：V16 N68 E 显示时间。数字可直接键入 R1（± 改符号）。程序写显示通道会接管寄存器。',
      'mis.demoNA': '自动演示（暂无轨迹）',
      'mis.demoNATip': '该任务的离线轨迹还没生成，自动演示暂不可用；手动飞行不受影响',
      'res.title': '任务评定',
      'res.summary': '完成度 {p} / {t}　任务时间 {time}',

      'st.earthOrbit': '进入地球停泊轨道',
      'st.tli': '执行地月转移 (TLI)',
      'st.loi': '插入环月轨道 (LOI)',
      'st.undock': '登月舱分离',
      'st.rendezvous': '完成交会',
      'st.dock': '再次对接',
      'st.landing': '月面着陆',
      'st.tei': '返回地球轨道注入 (TEI)',
      'st.splashdown': '溅落回收',

      'hint.first': '第一次玩？跟着教程走一遍，5 分钟从点火到溅落。',
      'hint.start': '开始新手教程',
      'hint.skip': '先自己看看',
      'tut.title': '新手教程',
      'tut.choose': '选择要看的教程',
      'tut.switch': '切换课程',
      'tut.step': '第 {n} / {N} 步',
      'tut.next': '下一步',
      'tut.prev': '上一步',
      'tut.skip': '跳过此步',
      'tut.done': '完成教程',
      'tut.exit': '退出教程',
      'tut.waiting': '等待你完成上面的操作…',
      'tut.freeHint': '（可自由点击界面上的高亮区域）'
    },

    en: {
      'app.title': 'Apollo 11 Mission Simulator',
      'brand.sub': 'Mission Simulator',
      'top.met': 'Mission Elapsed Time',
      'top.utc': 'UTC',
      'top.warp': 'Time warp',
      'top.perf': 'Performance',
      'btn.play': '▶ Resume',
      'btn.pause': '⏸ Pause',
      'btn.save': 'Save',
      'btn.load': 'Load',
      'btn.finish': 'Debrief',
      'btn.missions': 'Missions',
      'btn.tutorial': 'Tutorial',
      'btn.lang': '中文',
      'btn.close': 'Close',

      'panel.telemetry': 'TELEMETRY',
      'f.primary': 'Primary body',
      'f.alt': 'Altitude',
      'f.speed': 'Orbital speed',
      'f.vr': 'Vertical speed',
      'f.vh': 'Horizontal speed',
      'f.fpa': 'Flight path angle',
      'f.apo': 'Apoapsis',
      'f.per': 'Periapsis',
      'f.ecc': 'Eccentricity',
      'f.inc': 'Inclination',
      'f.period': 'Period',
      'f.phase': 'Phase angle',
      'f.mass': 'Total mass',
      'f.thrust': 'Thrust',
      'f.accel': 'Acceleration',
      'f.dv': 'Δv used',
      'f.moonDist': 'Distance to Moon',
      'f.moonPhase': 'Moon illumination',
      'f.sunElev': 'Sun elevation at site',
      'f.siteDist': 'Range to Tranquility Base',
      'sec.stages': 'Stages / Propellant',
      'body.earth': 'Earth',
      'body.moon': 'Moon',

      'view.system': 'Earth–Moon',
      'view.earth': 'Earth',
      'view.moon': 'Moon',
'view.craft': 'Chase',
      'view.polar': 'Orbit-plane view',
      'btn.predictOn': 'Orbit preview: ON',
      'btn.predictOff': 'Orbit preview: OFF',
      'btn.predictTip': 'Extrapolates where the craft will fly next, from its current velocity and full gravity (Earth/Moon/Sun)',
      'rv.vernal': 'Vernal equinox',
      'rv.apseDir': 'Apsis direction (orbit major axis)',
      'rv.nodeDir': 'Ascending-node direction',
      'rv.planeTop': 'Viewing perpendicular to the orbit plane',
      'rv.moonDir': 'Toward the Moon',
      'view.mode': 'Projection',
      'view.mode3d': '3D',
      'view.mode2d': '2D',
      'view.hint': 'Drag to rotate (pan in 2D) · Wheel to zoom · Double-click to reset',
      'rv.sun': '☉ Sun direction',
      'rv.site': 'Tranquility Base',
      'rv.launchSite': 'LC-39A launch pad',
      'rv.legend': 'Field of view ~{span} · view: {view}',
      'rv.millionKm': ' million km',
      'rv.thousandKm': ' thousand km',
      'rv.km': ' km',
      'rv.idleTitle': 'Apollo 11 Mission Simulator',
      'rv.idleHint': 'No mission selected yet',
      'rv.idleHow': 'Click 【Missions】 at the top right to pick a scenario.\nNew here? Try 【Tutorial】 first.',

      'grp.attitude': 'Attitude',
      'mode.launch': 'Ascent guidance',
      'mode.prograde': 'Prograde',
      'mode.retrograde': 'Retrograde',
      'mode.radial': 'Radial out',
      'mode.antiradial': 'Radial in',
      'mode.normal': 'Normal',
      'mode.antinormal': 'Anti-normal',
      'mode.vgo': 'Insertion guidance',
      'mode.hold': 'Hold attitude',
      'grp.throttle': 'Throttle',
      'btn.cut': 'Cut off',
      'btn.full': 'Full thrust',
      'grp.action': 'Actions',
      'btn.auto': 'Autopilot',
      'btn.stage': 'Stage / Jettison',
      'btn.undock': 'Undock LM',
      'btn.dock': 'Dock LM',
      'grp.mode': 'Current mode',

      'dsky.agcReady': 'AGC running · ready',
      'dsky.instructions': 'Instructions executed',
      'dsky.cycles': 'Machine cycles',
      'dsky.recent': 'Recently executed instructions',
      'dsky.none': '(no program loaded)',

      'tab.log': 'Flight log',
      'tab.calc': 'Orbit calculator',
      'tab.agc': 'AGC assembler',
      'tab.down': 'Downlink',
      'tab.time': 'Timeline',
      'tab.test': 'Self-test',
      'btn.switch': 'Switch craft',
      'btn.switchTo': 'Switch to {id}',
      'demo.act': 'This step uses: ',
      'demo.actAuto': 'Automatic - the guidance does this step (watch the telemetry)',
      'tut.group.ui': 'Interface tutorial (learn the panels)',
      'tut.group.mission': 'Mission tutorial (from scratch, mission by mission)',
      'tab.guide': 'Guidance manual',
      'guide.head': 'Guidance manual - when each law applies, how it works, its real Apollo programme number, and what every panel control does.',

      'calc.tof': 'Transfer time',
      'calc.hour': 'hours',
      'calc.targetAlt': 'Target insertion altitude',
      'calc.km': 'km',
      'btn.calc': 'Solve orbit',
      'btn.tli': 'Execute TLI burn',
      'btn.circ': 'Circularization guidance',
      'btn.land': 'Powered-descent guidance',
      'btn.rend': 'Rendezvous burn',
      'calc.note': 'The calculator uses a universal-variable Lambert solver to fly the spacecraft from its current Earth orbit to where the Moon will be after the given transfer time, and returns the required burn Δv. The real Apollo 11 TLI burn was about 3.05 km/s, arriving at the Moon roughly 73 hours later for LOI.',
      'calc.hint': 'Click "Solve orbit" to begin.',

      'agc.program': 'Sample program',
      'btn.load2': 'Load',
      'btn.agcReset': 'AGC reset',
      'btn.agcAsm': 'Assemble & load into AGC',
      'btn.agcRun': '⏸ Pause',
      'btn.agcRunRun': '▶ Run',
      'agc.file': 'Load .agc file',
      'agc.outHint': 'Assembler output appears here.',
      'down.channels': 'AGC downlink channels (recent writes)',
      'down.events': 'DSKY keystrokes and alarms',
      'down.none': '(no channel writes yet)',
      'down.noneKeys': '(no keystrokes yet)',
      'down.noAlarm': '(no alarms)',

      'time.head': 'Real Apollo 11 timeline (GET, from liftoff)',
      'time.th1': 'GET', 'time.th2': 'Event', 'time.th3': 'Detail',
      'test.head': 'Self-test',
      'btn.retest': 'Run self-test again',

      'mis.title': 'Select a mission',
      'mis.intro': 'All orbital mechanics are computed from real Apollo 11 (SA-506) flight data and the Meeus lunar ephemeris. Five preset missions, from liftoff to splashdown.',
      'mis.start': 'Start mission',
      'mis.demo': 'Auto demo',
      'mis.demoTip': '(flies the mission end to end - stop any time)',
      'demo.label': 'AUTO DEMO',
      'demo.stop': 'Stop demo',
      'rp.label': 'TRAJECTORY REPLAY',
      'rp.exit': 'Exit replay',
      'rp.modeLive': 'LIVE simulation',
      'rp.modeReplay': 'REPLAY - fixed samples',
      'dsky.help': 'Usage: VERB → 2 digits → NOUN → 2 digits → ENTR to commit; CLR cancels; bare ENTR lights OPR ERR. Example: V16 N68 E. Digits type straight into R1 (+/- sets sign). Program writes take over the registers.',
      'mis.demoNA': 'Auto-demo (no trajectory yet)',
      'mis.demoNATip': 'This mission has no offline trajectory yet, so the auto-demo is unavailable. Manual flight is unaffected.',
      'res.title': 'Mission debrief',
      'res.summary': 'Completed {p} / {t}　Mission time {time}',

      'st.earthOrbit': 'Reach Earth parking orbit',
      'st.tli': 'Trans-Lunar Injection (TLI)',
      'st.loi': 'Lunar Orbit Insertion (LOI)',
      'st.undock': 'Undock the Lunar Module',
      'st.rendezvous': 'Complete rendezvous',
      'st.dock': 'Dock again',
      'st.landing': 'Land on the Moon',
      'st.tei': 'Trans-Earth Injection (TEI)',
      'st.splashdown': 'Splashdown and recovery',

      'hint.first': 'New here? Follow the tutorial - about 5 minutes, liftoff to splashdown.',
      'hint.start': 'Start tutorial',
      'hint.skip': 'Let me explore',
      'tut.title': 'Tutorial',
      'tut.choose': 'Choose a course',
      'tut.switch': 'Switch course',
      'tut.step': 'Step {n} of {N}',
      'tut.next': 'Next',
      'tut.prev': 'Back',
      'tut.skip': 'Skip this step',
      'tut.done': 'Finish tutorial',
      'tut.exit': 'Exit tutorial',
      'tut.waiting': 'Waiting for you to do the highlighted action…',
      'tut.freeHint': '(click the highlighted area freely)'
    }
  };

  var LANG_KEY = 'apollo11.lang';
  var lang = 'zh';
  try {
    var saved = global.localStorage && global.localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') lang = saved;
  } catch (e) { /* ignore */ }
  // 支持用 URL 参数强制指定语言：?lang=en / ?lang=zh（也方便自动化测试）
  try {
    var q = String((global.location && global.location.search) || '');
    var mm = q.match(/[?&]lang=(zh|en)/);
    if (mm) {
      lang = mm[1];
      if (global.localStorage) global.localStorage.setItem(LANG_KEY, lang);
    }
  } catch (e2) { /* ignore */ }

  function t(key, params) {
    var table = DICT[lang] || DICT.zh;
    var s = table[key];
    if (s === undefined) s = DICT.zh[key];
    if (s === undefined) return key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] !== undefined ? params[k] : m;
      });
    }
    return s;
  }

  function pick(obj, base) {
    // 从数据对象里按语言取字段：base='name' → zh 用 name，en 用 nameEn
    if (!obj) return '';
    if (lang === 'en') return obj[base + 'En'] || obj[base] || '';
    return obj[base] || '';
  }

  function applyI18n(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    if (global.document) global.document.title = t('app.title');
    if (global.document && global.document.documentElement) {
      global.document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    }
  }

  function setLang(next, opts) {
    if (next !== 'en' && next !== 'zh') return;
    lang = next;
    try { global.localStorage && global.localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    applyI18n();
    if (!opts || opts.rebuild !== false) {
      var ev = null;
      try { ev = new CustomEvent('apollo-lang-changed', { detail: { lang: lang } }); } catch (e2) {
        ev = global.document.createEvent('Event'); ev.initEvent('apollo-lang-changed', true, true);
      }
      global.dispatchEvent(ev);
    }
  }

  function toggle() { setLang(lang === 'zh' ? 'en' : 'zh'); }


  // ------------------------------------------------------------ 任务与事件文本
  // 任务的英文文案单独放在这里（避免改动 00-constants.js 里的数据结构）
  var MISSION_EN = {
    M1: {
      name: 'Launch & Earth Orbit Insertion',
      subtitle: 'Launch & Earth Orbit Insertion',
      brief: 'Liftoff from Kennedy Space Center pad LC-39A, follow the real Saturn V pitch program, '
           + 'stage, and settle into a 183.2 x 185.9 km Earth parking orbit at 32.521 deg inclination.',
      need: ['Reach at least 80 km altitude', 'Periapsis >= 180 km', 'Apoapsis <= 195 km',
             'Speed >= 7.7 km/s', 'Eccentricity < 0.001'],
      phases: ['Liftoff', 'Max-Q', 'S-IC staging', 'S-II staging', 'Insertion']
    },
    M2: {
      name: 'Trans-Lunar Injection',
      subtitle: 'Trans-Lunar Injection (TLI)',
      brief: 'Find the correct burn window in the parking orbit, perform the TLI burn, fly the '
           + 'free-return trajectory to the Moon, and insert into lunar orbit three days later.',
      need: ['Apoapsis >= 350,000 km', 'Closest approach to the Moon <= 2,000 km',
             'Periapsis after LOI <= 200 km'],
      phases: ['TLI burn', 'Translunar coast', 'Midcourse correction', 'Lunar orbit insertion']
    },
    M3: {
      name: 'Lunar Docking',
      subtitle: 'Lunar Orbit Rendezvous & Docking',
      brief: 'Release Eagle in lunar orbit and catch it again with orbital mechanics alone. In the '
           + 'real mission this was the fourth docking, and the only way home.',
      need: ['Gap after undocking >= 500 m', 'Closing relative speed <= 1.0 m/s',
             'Docking range <= 0.15 km', 'Periapsis >= 100 km'],
      phases: ['Undock', 'Track', 'Close in', 'Dock']
    },
    M4: {
      name: 'Landing',
      subtitle: 'Powered Descent & Landing',
      brief: 'Fly the powered descent from the 111 km lunar orbit through the braking, approach and '
           + 'final descent phases, and land safely at Tranquility Base. One shot at the fuel.',
      need: ['Distance to target <= 0.5 km', 'Touchdown vertical speed <= 2.0 m/s',
             'Horizontal speed <= 1.5 m/s', 'Descent-stage propellant >= 0'],
      phases: ['PDI', 'Braking', 'Approach', 'Final descent', 'Touchdown']
    },
    M5: {
      name: 'Full Mission',
      subtitle: 'Full Mission Simulation',
      brief: 'The complete 8 day, 3 hour, 18 minute, 35 second Apollo 11 - liftoff, insertion, TLI, '
           + 'docking, lunar landing, EVA, ascent, re-docking and the trip home.',
      need: ['Complete all 8 major milestones', 'Mission time <= 200 hours'],
      phases: ['Launch', 'Insertion', 'TLI', 'Docking', 'Coast', 'LOI', 'Landing', 'EVA',
               'Ascent', 'Return', 'Splashdown']
    }
  };

  function missionText(m, field) {
    if (!m) return '';
    if (lang === 'en') {
      var e = MISSION_EN[m.id];
      if (e && e[field]) return e[field];
    }
    return m[field] || '';
  }

  // 任务时序条目：中文用 cn / detail，英文用 cnEn / detailEn
  function tlText(ev, field) {
    if (!ev) return '';
    if (lang === 'en') {
      var k = field === 'name' ? 'cnEn' : 'detailEn';
      if (ev[k]) return ev[k];
    }
    return field === 'name' ? ev.cn : ev.detail;
  }

  // =================================================== 制导手册（第 7 个页签）
  // 每一项 = { t: 标题, b: 正文 }，中英各一份。手册必须**与代码行为一致**：
  // 每条制导律的触发方式、边界、以及和真实 Apollo 程序号的对应关系都要写清楚。
  var GUIDE = [
    { h: { zh: '一、制导律总览（本模拟器的每一条制导律）',
           en: '1. The guidance laws in this simulator' },
      rows: [
        { t: { zh: '上升制导 launch（仰角程序 + 航迹角闭环）',
               en: 'Ascent guidance (pitch program + flight-path-angle loop)' },
          b: { zh: '适用：起飞 → S-II 关机。原理：按土星五号真实俯仰程序表转平，'
                + '并用航迹角闭环纠偏；出口条件是高度与速度预算。\n'
                + '触发：姿态选【上升】+ 油门 100%，或直接点【自动驾驶·起飞】。\n'
                + '真实对应：土星五号的迭代制导 IGM。',
               en: 'When: liftoff to S-II cutoff. How: the real Saturn V pitch program, '
                + 'closed on flight-path angle. Start: set attitude to Ascent + 100% throttle, '
                + 'or press the autopilot. Real counterpart: Saturn V IGM.' } },
        { t: { zh: '入轨制导 VGO（速度增量归零）',
               en: 'Insertion guidance (velocity-to-be-gained)' },
          b: { zh: '适用：S-IVB 段。原理：把速度矢量推向下一个目标圆轨道的速度，'
                + '剩余速度增量 < 1.5 m/s 时自动关机（真实运载器的"速度关机"）。\n'
                + '触发：S-IVB 段自动交班（上升制导在进入第三级后自动切给 VGO）。\n'
                + '真实对应：S-IVB IGM 关机。',
               en: 'When: S-IVB phase. How: drive the velocity vector onto the next circular '
                + 'target orbit; cut off when the residual is under 1.5 m/s. '
                + 'Start: automatic hand-over after S-II separation. Real counterpart: S-IVB IGM cutoff.' } },
        { t: { zh: 'TLI 地月转移注入（有限推力 + 燃烧中心化）',
               en: 'TLI translunar injection (finite burn + burn centering)' },
          b: { zh: '适用：地球停泊轨道。原理：先按 B 面偏置瞄准近月点（b = rp·√(1+2μ/(rp·v∞²))），'
                + '再**提前半个燃烧时长点火**（燃烧中心化），推力方向沿脉冲点上的Δv方向定死，'
                + '关机按"速度达到转移轨道在该半径上的速度"。\n'
                + '实测：燃烧约 305 s、耗推进剂约 76 t（真实 347 s / 76 t）。\n'
                + '触发：底部【轨道计算器】→ 设飞行时间 → 【计算轨道】→【执行 TLI 点火】。\n'
                + '真实对应：S-IVB 二次点火。',
               en: 'When: Earth parking orbit. How: aim the B-plane offset, ignite half a burn '
                + 'early (burn centering), hold a constant inertial attitude, cut off on target speed. '
                + 'Measured: about 305 s and 76 t (real: 347 s / 76 t). '
                + 'Start: Orbit calculator -> set flight time -> Solve -> Execute TLI.' } },
        { t: { zh: '中途修正 MCC', en: 'Midcourse correction' },
          b: { zh: '适用：TLI 之后的转移段。原理：对着陆点/近月点做小修正，'
                + '分成几次短脉冲式闭环点火（单次固定目标在长燃烧里会失效）。\n'
                + '真实对应：阿波罗 11 号的 MCC-2。',
               en: 'When: the translunar coast. How: small closed-loop trims in short pulses. '
                + 'Real counterpart: MCC-2.' } },
        { t: { zh: 'LOI-1 环月轨道插入（定面 + 捕获）',
               en: 'LOI-1 lunar orbit insertion (plane + capture)' },
          b: { zh: '适用：接近月球时。原理：一次有限点火同时**把速度降到目标椭圆速度**并把'
                + '轨道面转到"包含着陆点"的方向 —— 真实阿波罗的 LOI-1 就是这么做的。\n'
                + '真实对应：SPS 点火 357.5 s、Δv 889 m/s，进入 111×315 km。',
               en: 'When: lunar approach. How: one finite burn that both captures into the target '
                + 'ellipse and sets the plane through the landing site. Real LOI-1: 357.5 s, 889 m/s.' } },
        { t: { zh: 'LOI-2 环月轨道圆化', en: 'LOI-2 circularisation' },
          b: { zh: '适用：捕获轨道的近月点。原理：在近月点把椭圆圆化成低环月轨道。\n'
                + '真实对应：SPS 点火 17 s、Δv 59 m/s。',
               en: 'When: perilune of the capture orbit. How: circularise into a low lunar orbit. '
                + 'Real LOI-2: 17 s, 59 m/s.' } },
        { t: { zh: '下降轨道修正 DOI', en: 'Descent orbit insertion' },
          b: { zh: '适用：环月圆轨道、飞行器位于着陆点对面时。原理：在远月点反向点火把'
                + '近月点压到 15 km。\n实测：21.9 m/s（真实 24.5 m/s）。',
               en: 'When: circular lunar orbit, opposite the landing site. How: retrograde burn at '
                + 'apolune to lower perilune to 15 km. Measured 21.9 m/s (real 24.5 m/s).' } },
        { t: { zh: '动力下降 P63 / P64 / P66', en: 'Powered descent P63 / P64 / P66' },
          b: { zh: '适用：PDI 到触地。原理：三段式 —— P63 制动段（把水平速度按"高度预算"收掉）、'
                + 'P64 接近段、P66 终端下降（只保下沉率）。\n'
                + '月球的物理直觉：111 km 环月速度 1.63 km/s，而 DPS 只有 2.93 m/s²，'
                + '下降初期"有效重力" f = g − vh²/r ≈ 0.04 m/s² —— 飞行器几乎失重，'
                + '下沉率是被 f 慢慢喂出来的。\n'
                + '触发：任务卡片的【自动演示】，或手动【启动动力下降制导】。',
               en: 'When: PDI to touchdown. How: three phases - braking (P63), approach (P64), '
                + 'terminal descent (P66). Physics: 1.63 km/s at 111 km vs 2.93 m/s2 of thrust, so the '
                + 'effective gravity g - vh^2/r is only about 0.04 m/s2 at PDI - the vehicle is almost '
                + 'weightless and the sink rate is fed in slowly.' } },
        { t: { zh: '交会制导 rendezvous', en: 'Rendezvous guidance' },
          b: { zh: '适用：分离后重新逼近。原理：比例导引 —— 距离越近期望接近率越小'
                + '（0.3~20 m/s），带时间常数的比例控制避免过冲。\n'
                + '触发：任务卡片的【自动演示】，或手动【启动交会制导】。',
               en: 'When: closing on the LM after separation. How: proportional guidance with a '
                + 'range-dependent closing rate (0.3-20 m/s) and a time-constant controller to avoid overshoot.' } },
        { t: { zh: '月面起飞 / 月球上升制导', en: 'Lunar liftoff / ascent guidance' },
          b: { zh: '适用：从月面起飞。原理：前 6 s 垂直上升，之后按 0.45°/s 的俯仰程序转弯，'
                + '高度足够后交给 VGO 入轨。\n真实对应：APS 点火 3 min 52 s、Δv ≈ 1.86 km/s。',
               en: 'When: liftoff from the surface. How: 6 s vertical, then 0.45 deg/s pitch-over, '
                + 'then hand over to VGO. Real APS: 3 min 52 s, 1.86 km/s.' } },
        { t: { zh: 'TEI 返回地球轨道注入', en: 'Trans-Earth injection' },
          b: { zh: '适用：环月轨道。原理：闭环兰伯特 —— 瞄准"66 小时后到达地球再入走廊上的一点"，'
                + '用有限点火打出去。\n真实对应：SPS 点火约 151 s、Δv ≈ 997 m/s。',
               en: 'When: lunar orbit. How: closed-loop Lambert aimed at a re-entry corridor point '
                + '66 hours later. Real SPS: about 151 s, 997 m/s.' } }
      ] },
    { h: { zh: '二、飞行控制条与面板控件', en: '2. The flight control bar' },
      rows: [
        { t: { zh: '姿态（7 种模式）', en: 'Attitude (7 modes)' },
          b: { zh: '顺行 / 逆行：沿速度方向（加速 / 减速）——最常用；\n'
                + '法向 / 反法向：垂直于轨道面（改平面）；\n'
                + '径向 / 反径向：沿地心-飞行器连线（改偏心率和近远点）；\n'
                + '保持：锁住当前推力方向（制导自动接管时用）。',
               en: 'Prograde/retrograde: along velocity (speed up / slow down) - most common;\n'
                + 'Normal/anti-normal: perpendicular to the orbit plane (plane changes);\n'
                + 'Radial/anti-radial: along the local vertical (change eccentricity/apsides);\n'
                + 'Hold: keep the current thrust direction (guidance takes over).' } },
        { t: { zh: '油门 / 关机 / 全推力', en: 'Throttle / cutoff / full thrust' },
          b: { zh: '滑杆给指令油门；发动机有最小油门（SPS 0.1、DPS 0.1、其余 1.0），'
                + '低于最小油门会自动抬到最小值。推进剂按质量流量实时消耗。',
               en: 'The slider sets the commanded throttle. Engines have a minimum throttle '
                + '(SPS 0.1, DPS 0.1, others 1.0). Propellant burns at the real mass flow.' } },
        { t: { zh: '自动驾驶 / 分级 / 分离 / 对接', en: 'Autopilot / stage / undock / dock' },
          b: { zh: '【自动驾驶·起飞】一键执行上升制导；【分级】抛掉已用的级；'
                + '【分离登月舱】把 LM 拆成独立飞行器（RCS 推进剂对半）；'
                + '【对接】要求距离 ≤ 200 m、相对速度 ≤ 20 m/s。',
               en: 'Ascent autopilot runs the launch guidance; Stage jettisons spent stages; '
                + 'Undock splits the LM off (RCS split in half); Dock needs range <= 200 m and '
                + 'closing speed <= 20 m/s.' } },
        { t: { zh: '轨道计算器（底部第 2 个页签）', en: 'Orbit calculator' },
          b: { zh: '输出当前轨道根数、地月几何、霍曼式估算、兰伯特转移解与最佳转移窗口。'
                + '两个输入：目标飞行时间（小时）；4 个动作按钮：计算轨道 / 执行 TLI 点火 / 应用霍曼解 / 清空。'
                + '典型用法：在停泊轨道上设 72 h → 计算 → 执行 TLI。',
               en: 'Shows elements, Earth-Moon geometry, a Hohmann estimate, the Lambert solution '
                + 'and the best transfer window. Input: time of flight. Buttons: solve / execute TLI / '
                + 'apply Hohmann / clear.' } },
        { t: { zh: '时间倍率', en: 'Time warp' },
          b: { zh: '顶栏 +/- 调倍率（1x ~ 300000x）。制导关键阶段（上升/入轨/LOI/下降/着陆/月面起飞）'
                + '演示会把倍率限幅在推荐值的 2 倍以内，长滑行段有下限。',
               en: 'Top bar +/- sets warp (1x to 300000x). During critical guidance phases the demo '
                + 'caps warp at twice the recommended value; coast phases have a floor.' } },
        { t: { zh: 'AGC 通道接口（030o / 031o / 032o）', en: 'AGC channel interface' },
          b: { zh: '写通道 030o = 油门指令（0~16384 归一成 0~1）；'
                + '031o = 姿态模式号（0 顺行 / 1 逆行 / 2 径向外 / 3 径向内 / 4 法向 / 5 反法向 / 6 保持）；'
                + '032o = 分级（写非零值即触发一次）。'
                + '于是"自己写 AGC 汇编驱动飞船"成为可能 —— 内置示例 attitude-hold.agc '
                + '就是靠 030o/031o 做姿态与油门保持的。',
               en: 'Write channel 030o = throttle (0-16384 normalised to 0-1); '
                + '031o = attitude mode index (0 prograde / 1 retrograde / 2 radial-out / '
                + '3 radial-in / 4 normal / 5 anti-normal / 6 hold); 032o = stage (any non-zero '
                + 'value fires staging). The bundled attitude-hold.agc uses 030o/031o to hold '
                + 'attitude and throttle.' } }
      ] },
    { h: { zh: '三、三个典型操作序列（照着做就能飞）',
           en: '3. Three worked sequences' },
      rows: [
        { t: { zh: '① 起飞入轨（任务 01）', en: '1. Launch to orbit (mission 01)' },
          b: { zh: '选任务 01 → 姿态【上升】→ 油门推满（或点【自动驾驶·起飞】）→ '
                + '等 S-II 关机后自动分级 → S-IVB 段自动交班给入轨制导 → '
                + '遥测里近地点 ≥ 180 km、速度 ≥ 7.7 km/s 即达成。',
               en: 'Pick mission 01 -> attitude Ascent -> full throttle (or the ascent autopilot) -> '
                + 'wait for staging -> the insertion guidance takes over at S-IVB -> done when '
                + 'perigee >= 180 km and speed >= 7.7 km/s.' } },
        { t: { zh: '② 地月转移（任务 02）', en: '2. Translunar injection (mission 02)' },
          b: { zh: '在停泊轨道上打开【轨道计算器】→ 飞行时间填 72（小时）→【计算轨道】→ '
                + '看"最佳转移窗口"提示（相位不对 Δv 会大得离谱）→ 滑行到窗口 → '
                + '点【执行 TLI 点火】→ 转移段滑行约 73 h → 接近月球时执行 LOI 捕获。',
               en: 'Open the calculator -> time of flight 72 h -> Solve -> read the best-window hint -> '
                + 'coast to the window -> execute TLI -> 73 h coast -> LOI capture near the Moon.' } },
        { t: { zh: '③ 动力下降着陆（任务 04）', en: '3. Powered descent and landing (mission 04)' },
          b: { zh: '选任务 04（已构造好 111 km 环月轨道、轨道面精确过静海基地）→ '
                + '等待下降轨道窗口（飞船转到着陆点对面）→ 下降轨道修正把近月点压到 15 km → '
                + 'PDI：点【启动动力下降制导】。制导会自动完成 P63→P64→P66 三段并在触地前关机。'
                + '验收：着陆点距离 ≤ 500 m、垂直接地速度 ≤ 2 m/s。',
               en: 'Pick mission 04 (a 111 km lunar orbit through the landing site) -> wait for the '
                + 'descent window -> lower the perilune to 15 km -> PDI: start the descent guidance. '
                + 'It runs P63/P64/P66 and cuts off before touchdown.' } }
      ] }
  ];

  APL.Guide = GUIDE;

  APL.MISSION_EN = MISSION_EN;
  APL.missionText = missionText;
  APL.tlText = tlText;

  APL.I18N = DICT;
  APL.t = t;
  APL.pick = pick;
  APL.applyI18n = applyI18n;
  APL.setLang = setLang;
  APL.toggleLang = toggle;
  APL.getLang = function () { return lang; };

})(typeof window !== 'undefined' ? window : globalThis);
