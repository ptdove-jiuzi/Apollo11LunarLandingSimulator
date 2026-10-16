/* =========================================================================
 *  10-tutorial.js  —  新手教程（两套课程，中英双语）
 *
 *  ① 快速上手      从选任务到着陆与 AGC 的 12 步完整流程
 *  ② 导航系统介绍   24 步，逐块讲清画布 / 遥测 / 控制条 / 计算器 / DSKY / 制导手册与任务打法
 *
 *  引擎：每步可高亮界面元素（target）并等待玩家完成操作（wait 事件）。
 *  绝不自动启动 —— 只有玩家点击【新手教程】才打开。
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var T = function (zh, en) { return { zh: zh, en: en }; };
  var $ = function (id) { return document.getElementById(id); };

  // ============================================================ 课程一：快速上手
  var QUICK = [
    { id: 'welcome', target: null,
      title: T('欢迎来到阿波罗 11 号', 'Welcome to Apollo 11'),
      body: T('这是一个基于真实飞行数据做的登月模拟器：从肯尼迪航天中心点火起飞，'
            + '经过地月转移、月球轨道对接、动力下降着陆，最后返回地球。\n\n'
            + '所有轨道都由真实的物理公式实时计算，不是动画。右侧那台 DSKY 是'
            + '阿波罗制导计算机（AGC）的复刻 —— 你甚至可以自己写 AGC 汇编程序去驱动它。\n\n'
            + '这套「快速上手」大约 5 分钟带你把整个流程走一遍。'
            + '如果你想真正搞懂每个面板、每个按钮，请点下面的「切换课程」选「导航系统介绍」。',
              'This is a lunar-landing simulator built on real flight data: liftoff from '
            + 'Kennedy Space Center, trans-lunar injection, lunar-orbit rendezvous, '
            + 'powered descent, and the trip home.\n\n'
            + 'Every orbit is computed from real physics in real time. The DSKY on the right '
            + 'is a working Apollo Guidance Computer (AGC) replica - you can even write your '
            + 'own AGC assembly to drive it.\n\n'
            + 'This "Quick start" runs through the whole flow in about 5 minutes. To really '
            + 'understand every panel and button, use "Switch course" below and pick '
            + '"Navigation system".') },

    { id: 'mission', target: '#missionList .mcard', wait: 'mission_started',
      onEnter: function () {
        if (APLApp && !APLApp.world && APLApp.showMissionPicker) APLApp.showMissionPicker();
      },
      title: T('第 1 步：选一个任务', 'Step 1 - Pick a mission'),
      body: T('这里有 5 个预设任务：起飞、地月转移、月球对接、降落、全流程。\n\n'
            + '现在请点击第一张卡片「飞船起飞」下面的【开始任务】按钮。',
              'There are five preset missions: Launch, Trans-Lunar Injection, Lunar Docking, '
            + 'Landing, and Full Mission.\n\n'
            + 'Click 【Start mission】 on the first card, "Launch".') },

    { id: 'throttle', target: '#ctrlbar',
      title: T('飞行控制条', 'Flight controls'),
      body: T('屏幕下方这一条是你开飞船的地方：\n'
            + '· 姿态：推力朝哪个方向喷\n'
            + '· 油门：发动机推力大小\n'
            + '· 动作：自动驾驶、分级、分离与对接登月舱\n\n'
            + '「自动驾驶」相当于把真实 AGC 里的制导程序接通。',
              'This strip at the bottom is where you fly the ship:\n'
            + '· Attitude - which way the engine points\n'
            + '· Throttle - how hard the engine burns\n'
            + '· Actions - autopilot, staging, undock/dock the LM\n\n'
            + '"Autopilot" is equivalent to engaging the guidance program inside the real AGC.') },

    { id: 'autopilot', target: '#btnAuto', wait: 'autopilot_on',
      title: T('第 2 步：点火起飞', 'Step 2 - Light the candle'),
      body: T('土星五号的俯仰程序已经内置在模拟器里。\n\n'
            + '请点击【自动驾驶】—— 它会自动执行：\n'
            + '1. 垂直上升 11 秒\n'
            + '2. 按程序俯仰转弯（避开最大动压）\n'
            + '3. S-IC 关机、分级、S-II 点火…\n'
            + '4. 进入 S-IVB 段后自动交班给入轨制导，达到 185 km 圆轨道后自动关机\n\n'
            + '记得把时间倍率调到 ×20 左右，不然要等 10 分钟。',
              'The Saturn V pitch program is built in.\n\n'
            + 'Click 【Autopilot】- it will automatically:\n'
            + '1. rise vertically for 11 seconds\n'
            + '2. pitch over on the real program (to limit dynamic pressure)\n'
            + '3. stage S-IC, ignite S-II ...\n'
            + '4. hand over to insertion guidance on the S-IVB and cut off in a 185 km orbit\n\n'
            + '(Raise the time warp to about x20, otherwise it takes 10 minutes.)') },

    { id: 'orbitRead', target: '#left',
      title: T('看懂轨道数字', 'Reading the orbit'),
      body: T('入轨之后你会看到：\n'
            + '· 远地点 ≈ 185 km，近地点 ≈ 185 km，偏心率 ≈ 0 → 圆轨道\n'
            + '· 速度 ≈ 7.79 km/s → 正好是 185 km 高度的环绕速度\n'
            + '· 倾角 ≈ 32.5° → 与真实 Apollo 11 的停泊轨道一致\n\n'
            + '如果近地点太低（低于 150 km），说明速度不够，会掉回大气层。\n\n'
            + '每一项数字的确切含义，在「导航系统介绍」里会逐条讲。',
              'After insertion you should see:\n'
            + '· Apoapsis ~185 km, periapsis ~185 km, eccentricity ~0 - a circular orbit\n'
            + '· Speed ~7.79 km/s - the circular speed at 185 km\n'
            + '· Inclination ~32.5 deg - matching the real Apollo 11 parking orbit\n\n'
            + 'If periapsis is below ~150 km you do not have enough speed and will re-enter.\n\n'
            + 'Every one of these numbers is explained field by field in the "Navigation '
            + 'system" course.') },

    { id: 'calcTab', target: '#tabs', wait: 'tab_calc',
      title: T('第 3 步：去月球 —— 打开轨道计算器', 'Step 3 - Going to the Moon'),
      body: T('底部这一排是「信息与工具」。\n\n'
            + '去月球要用 TLI（地月转移轨道注入）点火：在停泊轨道上找一个正确的位置，'
            + '把速度加上约 3.05 km/s，让飞船在 3 天后正好遇到月球。\n\n'
            + '请点击底部的【轨道计算器】页签。',
              'This bottom row is the "tools and readouts" area.\n\n'
            + 'Going to the Moon needs a TLI burn: from the correct place in the parking '
            + 'orbit you add about 3.05 km/s so that three days later you meet the Moon.\n\n'
            + 'Click the 【Orbit calculator】tab.') },

    { id: 'calcSolve', target: '#calcTof', wait: 'calc_used',
      title: T('求解地月转移', 'Solving the transfer'),
      body: T('「转移飞行时间」默认 72 小时 —— 跟真实的 73 小时几乎一样。\n\n'
            + '请点【计算轨道】。程序会用兰伯特求解器算出：从现在这个位置，'
            + '需要多少速度增量、朝哪个方向，才能在 72 小时后到达月球。',
              'The default transfer time is 72 hours - essentially the real 73 hours.\n\n'
            + 'Click 【Solve orbit】. The Lambert solver computes the direction and the '
            + 'delta-v needed to leave your current position and reach the Moon 72 h later.') },

    { id: 'calcTli', target: '#btnTLI', wait: 'tli_done',
      title: T('执行 TLI 点火', 'Execute the TLI burn'),
      body: T('右边会给出所需 Δv（真实值约 3.05 km/s）。\n\n'
            + '请点【执行 TLI 点火】。点火后可以看到轨道远地点从 185 km 一下子'
            + '变成 40 万公里左右 —— 这就是地月转移轨道。\n\n'
            + '然后把时间倍率调到 ×5000 以上，穿过地月之间的真空。',
              'You will see the required delta-v on the right (the real value was about '
            + '3.05 km/s).\n\n'
            + 'Click 【Execute TLI burn】. Afterwards the apoapsis jumps from 185 km to '
            + 'roughly 400,000 km - that is the translunar trajectory.\n\n'
            + 'Then raise the time warp above x5000 and coast through cislunar space.') },

    { id: 'docking', target: '#btnUndock', wait: 'undock_done',
      title: T('登月舱：分离与对接', 'The LM: undocking and docking'),
      body: T('进入月球引力范围后（左上的「主天体」会变成月球），要把登月舱 Eagle 放出去。\n\n'
            + '请点【分离登月舱】。分离后两个飞行器各自运动 —— 在轨道上'
            + '「停车」和「追上」都只能靠点火，这是任务 03「月球对接」的核心玩法。\n\n'
            + '想再连起来，就靠近到 200 米内、相对速度低于 20 m/s，再点【对接登月舱】。',
              'Once inside the Moon\'s sphere of influence (the "Primary body" field switches '
            + 'to Moon), release the Lunar Module Eagle.\n\n'
            + 'Click 【Undock LM】. The two vehicles then fly independently - catching up in '
            + 'orbit is entirely a matter of burns, the core of mission 03.\n\n'
            + 'To rejoin, close to within 200 m at under 20 m/s relative, then click '
            + '【Dock LM】.') },

    { id: 'landing', target: '#btnLand', wait: 'landing_done',
      title: T('第 4 步：动力下降着陆', 'Step 4 - Powered descent'),
      body: T('要单独练习着陆，建议在任务列表里选「飞船降落」，一开始就在 111 km 环月轨道上。\n\n'
            + '请点【动力下降制导】—— 它会先制动减速，再转为悬停下降，在静海基地着陆。\n\n'
            + '安全接地的判据：\n· 垂直速度 ≤ 2 m/s\n· 水平速度 ≤ 1.5 m/s\n'
            + '· 剩余下降级推进剂 ≥ 0',
              'To practise landing on its own, pick "Landing" from the mission list - it '
            + 'starts you in a 111 km lunar orbit.\n\n'
            + 'Click 【Powered-descent guidance】- it brakes first, then transitions to a '
            + 'hover-descent and lands at Tranquility Base.\n\n'
            + 'Safe-touchdown criteria:\n· vertical speed <= 2 m/s\n'
            + '· horizontal speed <= 1.5 m/s\n· descent-stage propellant >= 0') },

    { id: 'agc', target: '#agcSrc', wait: 'asm_done',
      title: T('第 5 步：玩一玩 AGC', 'Step 5 - Play with the AGC'),
      body: T('这是本项目最有意思的部分：一台可以编程的阿波罗制导计算机。\n\n'
            + '左边是 AGC 汇编源码（内置三个示例）。点【汇编并装载到 AGC】，'
            + '右边的 DSKY 就会按你的程序运行 —— 例如把 PROG=11、VERB=16、'
            + 'NOUN=36 写进显示器，并让 R1 从 0 数到 99。\n\n'
            + '语法就是真实 AGC 的写法：CAF / TS / AD / EXTEND / WRITE / TCF…',
              'The best part: a programmable Apollo Guidance Computer.\n\n'
            + 'On the left is AGC assembly source (three samples are built in). Click '
            + '【Assemble & load into AGC】and the DSKY starts executing your program - for '
            + 'example writing PROG=11, VERB=16, NOUN=36 and counting R1 from 0 to 99.\n\n'
            + 'The syntax is genuine AGC assembly: CAF / TS / AD / EXTEND / WRITE / TCF ...') },

    { id: 'finish', target: '#btnFinish',
      title: T('快速上手完成', 'Quick start complete'),
      body: T('你已经会开这艘飞船了。剩下的：\n'
            + '· 【存档 / 读档】保存进度\n'
            + '· 【评定】查看本关完成度\n'
            + '· 【EN】切换英文界面\n'
            + '· 底部【任务时序】对照真实 Apollo 11 的 195 小时\n'
            + '· 底部【系统自检】验证历表与轨道计算\n\n'
            + '想真正搞懂每个数字的含义和五个任务的打法，请点【切换课程】选「导航系统介绍」。',
              'You can fly this ship now. The rest:\n'
            + '· 【Save / Load】to keep progress\n'
            + '· 【Debrief】to see how well you did\n'
            + '· 【EN】switches the interface language\n'
            + '· 【Timeline】compares you with the real 195-hour Apollo 11\n'
            + '· 【Self-test】verifies the ephemeris and orbital maths\n\n'
            + 'To really understand every number and how to beat each mission, use '
            + '"Switch course" and pick "Navigation system".') }
  ];

  // ============================================================ 课程二：导航系统介绍
  var NAV = [
    { id: 'n0', target: null,
      title: T('导航系统介绍', 'Navigation system'),
      body: T('这一套课程专门讲「怎么使用」—— 把游戏里的每一块面板、每一个按钮、'
            + '每一个数字都讲清楚，最后给出五个任务的打法。\n\n'
            + '整个导航系统由六部分组成：\n'
            + '① 中间大片的【轨道画布】—— 看位置和轨道\n'
            + '② 左侧【遥测面板】—— 看数字\n'
            + '③ 下侧【飞行控制条】—— 操船\n'
            + '④ 右侧【DSKY】—— 阿波罗制导计算机\n'
            + '⑤ 底部【页签区】—— 计算器 / 日志 / 时序 / 自检\n'
            + '⑥ 顶部【时间控制与任务管理】\n\n'
            + '我们按这个顺序一块块过（共 24 步）。',
              'This course is about *how to use* the thing - every panel, every button, every '
            + 'number, plus a strategy for each of the five missions.\n\n'
            + 'The navigation system has six parts:\n'
            + '① the big 【orbit canvas】 in the middle - where you are\n'
            + '② the 【telemetry panel】 on the left - the numbers\n'
            + '③ the 【flight controls】 strip below it - how you fly\n'
            + '④ the 【DSKY】 on the right - the Apollo guidance computer\n'
            + '⑤ the 【tab strip】 at the bottom - calculator / log / timeline / self-test\n'
            + '⑥ the 【time and mission controls】 along the top\n\n'
            + 'We go through them one at a time (24 steps).') },

    { id: 'n1', target: '#topbar',
      title: T('⑥ 顶部：时间与任务管理', '⑥ Top bar: time and missions'),
      body: T('从左到右：\n'
            + '· MET：任务已过去的时间（真实任务 195 小时 18 分 35 秒）\n'
            + '· 世界时：换算成 1969 年的真实 UTC，方便对照任务时序\n'
            + '· 时间倍率：真实任务太长，必须加速\n'
            + '· − / ＋：降低 / 提高倍率（1 倍 → 30 万倍）\n'
            + '· 【▶ 继续】：开始 / 暂停仿真\n'
            + '· 【新手教程】【EN】：教程与语言切换\n'
            + '· 【存档】【读档】【评定】【选择任务】\n\n'
            + '窍门：变轨前把倍率降到 1～10，变轨结束后再拉高到 5000 以上。',
              'Left to right:\n'
            + '· MET - mission elapsed time (the real flight lasted 195 h 18 min 35 s)\n'
            + '· UTC - converted to real 1969 UTC so you can compare with the timeline\n'
            + '· Time warp - the real mission is far too long to fly at 1x\n'
            + '· - / + : lower / raise the warp rate (1x up to 300,000x)\n'
            + '· 【▶ Resume】: start or pause the simulation\n'
            + '· 【Tutorial】【EN】: tutorial and language\n'
            + '· 【Save】【Load】【Debrief】【Missions】\n\n'
            + 'Tip: drop the warp to 1-10 for a burn, then raise it above 5000 to coast.') },

    { id: 'n2', target: '#skywrap',
      title: T('① 轨道画布：这是什么视图', '① Orbit canvas: what you are looking at'),
      body: T('这是三维轨道的二维投影。相机可以旋转，所以画面上的「上下左右」'
            + '并不等于真实空间方向 —— 判断方向永远以轨道本身的形状为准。\n\n'
            + '操作：\n'
            + '· 按住鼠标左键拖动 = 旋转视角\n'
            + '· 滚轮 = 缩放\n'
            + '· 左下角显示当前视场大小和视图名\n\n'
            + '注意：画面是等比例的，所以地月之间看上去会非常空旷 —— 这是真实的，'
            + '地月平均距离 38 万公里。',
              'A 2-D projection of the 3-D trajectory. You can rotate the camera, so "up" and '
            + '"down" on screen are not real spatial directions - judge everything by the '
            + 'shape of the orbit.\n\n'
            + 'Controls:\n'
            + '· hold the left mouse button to rotate the view\n'
            + '· mouse wheel to zoom\n'
            + '· the bottom-left corner shows the field of view and the view name\n\n'
            + 'The picture is to scale, so the Earth-Moon gap looks enormous - and it really '
            + 'is: 384,400 km on average.') },

    { id: 'n3', target: '#viewbar',
      title: T('① 四个视图按钮 + 3D / 2D 模式', '① The four view buttons + 3D / 2D mode'),
      body: T('· 【地月全景】：自动缩放到能同时看到地球和月球，用来规划地月转移\n'
            + '· 【近地】：跟随飞船并放大到地球附近，用来看入轨、停泊轨道\n'
            + '· 【近月】：跟随飞船并放大到月球附近，用来看环月轨道、着陆\n'
            + '· 【跟随】：贴着飞船，用来做最后的精确操作\n\n'
            + '【3D / 2D】切换视角模式（两者是叠加关系，不改你选的视图）：\n'
            + '· 3D = 可旋转的三维视角，拖动鼠标转动观察角度 —— 判断空间关系用它\n'
            + '· 2D = 视线垂直于**当前轨道面**的平面俯视图，轨道会画成正圆 / 正椭圆，'
            + '拖拽变成平移，适合看"轨道面正不正、和着陆点在不在一个面里"\n\n'
            + '缩放范围会自动匹配当前情况：飞船离哪近就放大到哪。',
              '· 【Earth-Moon】: fits both bodies - use it for transfer planning\n'
            + '· 【Earth】: follows the spacecraft, zoomed in on Earth - for launch and the '
            + 'parking orbit\n'
            + '· 【Moon】: follows the spacecraft, zoomed in on the Moon - for lunar orbit '
            + 'and landing\n'
            + '· 【Chase】: tight on the vehicle - for final fine manoeuvres\n\n'
            + '【3D / 2D】 switches the projection (it stacks on top of the view you picked):\n'
            + '· 3D = rotatable perspective - drag to look around\n'
            + '· 2D = perpendicular to the current orbit plane, so orbits show as true '
            + 'circles/ellipses and dragging pans - ideal for checking plane alignment\n\n'
            + 'The zoom adapts automatically to wherever you are.') },

    { id: 'n4', target: '#skywrap',
      title: T('① 图上每种颜色是什么意思', '① What every colour means'),
      body: T('· 蓝色大球 = 地球；灰色球 = 月球（明暗面朝向真实太阳方向）\n'
            + '· 绿色箭头 = 你（箭头指向 = 推力方向）；黄色箭头 = 分离后的登月舱\n'
            + '· 青色渐亮曲线 = 已经飞过的轨迹（越亮越新）\n'
            + '· 橙色虚线 = 未来轨道预测（按当前速度惯性外推）\n'
            + '· 灰色细椭圆 = 月球轨道\n'
            + '· 红色十字 = 静海基地（着陆目标）\n'
            + '· 绿色小点 = LC-39A 发射台\n'
            + '· 黄色虚线 = 太阳方向\n\n'
            + '看轨道形状比看数字更直观：圆 = 稳定环绕，长椭圆 = 会掉下来或要去很远，'
            + '双曲线 = 已经逃逸。',
              '· big blue sphere = Earth; grey sphere = the Moon (lit side faces the real Sun)\n'
            + '· green arrow = you (it points along the thrust axis); yellow arrow = the LM '
            + 'after separation\n'
            + '· cyan fading curve = the trail you have flown (brighter = more recent)\n'
            + '· orange dashed line = predicted orbit from the current state\n'
            + '· faint grey ellipse = the Moon\'s orbit\n'
            + '· red cross = Tranquility Base (your landing target)\n'
            + '· small green dot = LC-39A launch pad\n'
            + '· yellow dashed ray = direction to the Sun\n\n'
            + 'The shape tells you more than the numbers: a circle is a stable orbit, a long '
            + 'ellipse will either re-enter or go far away, a hyperbola means you have escaped.') },

    { id: 'n5', target: '#left',
      title: T('② 遥测面板：怎么读', '② Telemetry: how to read it'),
      body: T('左侧一共 20 多项数据，分四组：\n'
            + '（A）轨道几何：高度 / 速度 / 远地点 / 近地点 / 偏心率 / 倾角\n'
            + '（B）动力学：总质量 / 推力 / 加速度 / 已用 Δv\n'
            + '（C）地月环境：距月球 / 月相照度 / 着陆点日照仰角 / 到静海基地\n'
            + '（D）推进级与推进剂条\n\n'
            + '下面五次分别讲清楚。',
              'About 20 numbers on the left, in four groups:\n'
            + '(A) orbit geometry: altitude / speed / apoapsis / periapsis / eccentricity / '
            + 'inclination\n'
            + '(B) dynamics: mass / thrust / acceleration / delta-v used\n'
            + '(C) Earth-Moon environment: range to the Moon / illumination / sun elevation '
            + 'at the site / range to Tranquility Base\n'
            + '(D) stages and propellant bars\n\n'
            + 'The next five steps explain each group.') },

    { id: 'n6', target: '#tAlt',
      title: T('② 高度 · 垂直速度 · 水平速度 · 航迹角', '② Altitude, vertical / horizontal speed, FPA'),
      body: T('· 高度：相对当前主天体的高度（地球按椭球面，月球按平均球面）\n'
            + '· 垂直速度：向外为正、向下为负。着陆前必须收到 −2 m/s 以内\n'
            + '· 水平速度：沿地表切线方向的速度。着陆前要收到 1.5 m/s 以内\n'
            + '· 航迹角：速度矢量相对当地水平面的夹角。+90° = 垂直上升，'
            + '0° = 水平环绕，负值 = 正在下降\n\n'
            + '能不能入轨看速度和高度；能不能落地看这两个速度分量。',
              '· Altitude: above the current primary body (Earth = ellipsoid, Moon = mean '
            + 'sphere)\n'
            + '· Vertical speed: positive up, negative down. Before touchdown it must be '
            + 'within -2 m/s\n'
            + '· Horizontal speed: along the local surface. Before touchdown it must be '
            + 'under 1.5 m/s\n'
            + '· Flight-path angle: the angle of the velocity vector above the local '
            + 'horizon. +90 deg = straight up, 0 deg = level, negative = descending\n\n'
            + 'Orbit insertion is about speed and altitude; landing is about these two '
            + 'velocity components.') },

    { id: 'n7', target: '#tApo',
      title: T('② 远地点 · 近地点 · 偏心率 · 倾角 · 周期', '② Apoapsis, periapsis, eccentricity, inclination'),
      body: T('· 远地点 / 近地点：轨道的最高点和最低点（相对球面高度）\n'
            + '· 偏心率 e：0 = 完美圆，接近 1 = 极扁的椭圆，大于 1 = 双曲线（逃逸）\n'
            + '· 倾角：轨道平面与赤道的夹角。Apollo 停泊轨道是 32.5°\n'
            + '· 周期：绕一圈要多久。185 km 圆轨道约 88 分钟\n\n'
            + '三个关键判断：\n'
            + '① 近地点低于 100 km → 会再入大气\n'
            + '② 远地点升到 40 万 km → 正在奔月\n'
            + '③ e 突然大于 1 → 飞船已经逃逸，回不来了',
              '· Apoapsis / periapsis: the high and low points of the orbit\n'
            + '· Eccentricity e: 0 = perfect circle, near 1 = very long ellipse, above 1 = '
            + 'hyperbola (escaping)\n'
            + '· Inclination: angle between the orbit plane and the equator. Apollo parked '
            + 'at 32.5 deg\n'
            + '· Period: time for one revolution. A 185 km orbit takes about 88 minutes\n\n'
            + 'Three rules of thumb:\n'
            + '① periapsis below 100 km means you will re-enter\n'
            + '② apoapsis out at 400,000 km means you are on your way to the Moon\n'
            + '③ e jumping above 1 means you have escaped and are not coming back') },

    { id: 'n8', target: '#tPhase',
      title: T('② 相位角 · 质量 · 推力 · 加速度 · Δv', '② Phase angle, mass, thrust, acceleration, delta-v'),
      body: T('· 相位角：飞船相对主天体中心的位置角（0～360°），观察轨道位置用\n'
            + '· 总质量：包括所有未抛离的级和剩余推进剂\n'
            + '· 推力：当前发动机实际输出的推力（大气压会影响它）\n'
            + '· 加速度：含当地重力，括号里是过载 g 值。起飞时约 1.2 g\n'
            + '· 已用 Δv：本次任务累计的速度增量 —— 这是真正的「油耗表」\n\n'
            + 'Δv 预算参考：入轨约 9.3、TLI 约 3.05、LOI 约 0.89、'
            + '下降约 2.0、上升约 1.86、TEI 约 1.0 km/s。',
              '· Phase angle: your position angle around the primary body (0-360 deg)\n'
            + '· Total mass: everything still attached, including propellant\n'
            + '· Thrust: the engine\'s actual output right now (ambient pressure matters)\n'
            + '· Acceleration: includes local gravity; the figure in brackets is g-load. '
            + 'About 1.2 g at liftoff\n'
            + '· Delta-v used: cumulative velocity change for this mission - the real '
            + 'fuel gauge\n\n'
            + 'Budget reference: ~9.3 to orbit, ~3.05 TLI, ~0.89 LOI, ~2.0 descent, '
            + '~1.86 ascent, ~1.0 km/s TEI.') },

    { id: 'n9', target: '#tMoonDist',
      title: T('② 距月球 · 月相 · 日照仰角 · 到静海基地', '② Moon range, illumination, sun elevation, range to site'),
      body: T('· 距月球：到月心的距离。小于 66 183 km 就进入月球引力影响球（SOI），'
            + '左上「主天体」会自动变成月球\n'
            + '· 月相照度：月球被太阳照亮比例。着陆任务要求当地是早晨，'
            + '所以照度一般在 30% 前后\n'
            + '· 着陆点日照仰角：太阳在静海基地地平线上的高度 —— 真实 Apollo 11 '
            + '着陆时是 10.5°，太低看不清地形，太高会晃眼\n'
            + '· 到静海基地：从飞船到目标着陆点的直线距离\n\n'
            + '注意：只有进入月球 SOI 之后，才允许启动【动力下降制导】。',
              '· Range to the Moon: distance to the Moon\'s centre. Below 66,183 km you are '
            + 'inside its sphere of influence and the "Primary body" field flips to Moon\n'
            + '· Moon illumination: illuminated fraction. Landing missions need lunar '
            + 'morning, so expect around 30%\n'
            + '· Sun elevation at the site: the real figure at Apollo 11 touchdown was '
            + '10.5 deg - too low and you cannot judge terrain, too high and you are dazzled\n'
            + '· Range to Tranquility Base: straight-line distance to your landing target\n\n'
            + 'Note: 【Powered-descent guidance】 only works inside the Moon\'s SOI.') },

    { id: 'n10', target: '#stageList',
      title: T('② 推进级与推进剂条', '② Stages and propellant'),
      body: T('每一行是一级，蓝色高亮的是当前正在使用的那一级：\n'
            + '· S-IC 第一级：5 台 F-1，烧 168 秒左右，把它送到 67 km\n'
            + '· S-II 第二级：5 台 J-2，把它送到 185 km，速度约 6.5 km/s\n'
            + '· S-IVB 第三级：先入轨，再二次点火做 TLI\n'
            + '· ESA：仪器舱 / 适配器 / 逃逸塔，随一级一起抛掉\n'
            + '· LM_D / LM_A：登月舱下降级与上升级\n'
            + '· SM / CM：服务舱（SPS 主发动机）与指令舱\n\n'
            + '进度条见底会自动分级（也可以手动点【分级 / 抛离】）。'
            + '注意：抛掉的级拿不回来。',
              'Each row is a stage; the highlighted one is currently firing:\n'
            + '· S-IC: five F-1 engines, about 168 s, pushes you to 67 km\n'
            + '· S-II: five J-2 engines, up to 185 km at about 6.5 km/s\n'
            + '· S-IVB: inserts you into orbit, then restarts for TLI\n'
            + '· ESA: instrument unit / adapter / escape tower, jettisoned with the first stage\n'
            + '· LM_D / LM_A: LM descent and ascent stages\n'
            + '· SM / CM: service module (SPS main engine) and command module\n\n'
            + 'Staging happens automatically when a stage runs dry (or click '
            + '【Stage / Jettison】). Remember: jettisoned stages do not come back.') },

    { id: 'n11', target: '#ctrlbar',
      title: T('③ 姿态：顺行与逆行', '③ Attitude: prograde and retrograde'),
      body: T('「姿态」决定推力朝哪边喷。最常用的两个：\n\n'
            + '· 顺行（Prograde）：沿速度方向加速 → 轨道抬高、变大。'
            + '「把圆轨道抬成椭圆」就是顺行点火\n'
            + '· 逆行（Retrograde）：逆着速度方向减速 → 轨道降低、变小，'
            + '幅度够大就是再入或着陆\n\n'
            + '记法：顺行 = 加速 = 轨道变大；逆行 = 刹车 = 轨道变小。\n'
            + '这两条占了真实任务里 90% 以上的点火。',
              '"Attitude" picks which way the engine points. The two you will use most:\n\n'
            + '· Prograde: thrust along the velocity vector - raises and enlarges the orbit\n'
            + '· Retrograde: thrust against it - lowers and shrinks the orbit; enough of it '
            + 'means re-entry or landing\n\n'
            + 'Mnemonic: prograde = speed up = bigger orbit; retrograde = brake = smaller '
            + 'orbit. These two account for over 90% of real mission burns.') },

    { id: 'n12', target: '#ctrlbar',
      title: T('③ 姿态：法向 / 径向', '③ Attitude: normal and radial'),
      body: T('另外四个方向用来做更细的调整：\n\n'
            + '· 法向（Normal）与 反法向（Anti-normal）：垂直于轨道面。'
            + '主要用来改变轨道平面（比如调整倾角）\n'
            + '· 径向外（Radial out）与 径向内（Radial in）：沿地心-飞船连线向外 / 向内。'
            + '会同时改变高度和速度，用于快速修正落点\n\n'
            + '不确定用哪个时，就按「我想加速就顺行、想减速就逆行」。',
              'The other four change the plane or the shape in subtler ways:\n\n'
            + '· Normal and Anti-normal: perpendicular to the orbit plane. Used to change '
            + 'the orbit plane (e.g. inclination)\n'
            + '· Radial out and Radial in: along the line to the body centre. Changes '
            + 'altitude and speed together - handy for quick trajectory corrections\n\n'
            + 'When unsure: "to speed up use prograde, to slow down use retrograde".') },

    { id: 'n13', target: '#btnAuto',
      title: T('③ 自动驾驶两件套：上升制导 与 入轨制导', '③ The two autopilots'),
      body: T('这两个是本游戏最省心的功能，也是真实 AGC 制导程序的等价物：\n\n'
            + '· 上升制导（【自动驾驶】按钮）：自动执行土星五号俯仰程序 + 分级。'
            + '进入 S-IVB 段后会自动交班给入轨制导，不需要你操作\n'
            + '· 入轨制导（底部计算器里的【入轨圆化制导】）：把速度矢量推到'
            + '当前高度的环绕速度，达到目标后自动关机。目标高度可以在'
            + '「入轨目标高度」输入框里改\n\n'
            + '发射任务：点【自动驾驶】然后等它自己入轨就行。',
              'These two are the least-effort features in the game and the equivalent of the '
            + 'real AGC guidance programs:\n\n'
            + '· Ascent guidance (the 【Autopilot】 button): runs the Saturn V pitch program '
            + 'and staging. On the S-IVB it hands over to insertion guidance by itself\n'
            + '· Insertion guidance (【Circularization guidance】 in the bottom calculator): '
            + 'drives the velocity vector to the circular speed for your current altitude and '
            + 'cuts off automatically. Change the target in the "target insertion altitude" box\n\n'
            + 'For a launch mission: click 【Autopilot】 and wait for insertion.') },

    { id: 'n14', target: '#thr',
      title: T('③ 油门 · 关机 · 全推力 · 分级', '③ Throttle, cutoff, staging'),
      body: T('· 油门滑杆：0～100%。从 5.166 MN 的 S-II 到 45 kN 的登月舱下降发动机都靠它控制\n'
            + '· 【关机】：立刻把油门归零（比慢慢拉滑杆快）\n'
            + '· 【全推力】：直接把油门推到 100%\n'
            + '· 【分级 / 抛离】：手动抛掉已经烧完的一级\n\n'
            + '登月舱下降级可以节流到 10%，这就是 Apollo 11 能在最后一刻'
            + '挪到平坦地面的原因。',
              '· Throttle slider: 0-100%. It governs everything from the 5.166 MN S-II to '
            + 'the 45 kN LM descent engine\n'
            + '· 【Cut off】: slams the throttle to zero instantly\n'
            + '· 【Full thrust】: straight to 100%\n'
            + '· 【Stage / Jettison】: manually drop a spent stage\n\n'
            + 'The LM descent engine can throttle down to 10% - exactly how Apollo 11 was '
            + 'able to fly sideways to a smoother spot at the last moment.') },

    { id: 'n15', target: '#btnUndock',
      title: T('③ 分离与对接登月舱', '③ Undock and dock the LM'),
      body: T('· 【分离登月舱】：把 Eagle 从组合体上拆下来，变成两个独立飞行器。'
            + '两个飞行器都会出现在画布上（黄色箭头是登月舱）\n'
            + '· 【对接登月舱】：两器距离 ≤ 200 米、相对速度 ≤ 20 m/s 时才能对接\n\n'
            + '分离之后想再靠拢，要靠轨道力学：先顺行抬高轨道追赶，'
            + '再逆行把速度对齐。计算器里的【交会辅助点火】会帮你算一步。',
              '· 【Undock LM】: detaches Eagle into a separate vehicle. Both then appear on '
            + 'the canvas (the yellow arrow is the LM)\n'
            + '· 【Dock LM】: only possible within 200 m and under 20 m/s relative\n\n'
            + 'After undocking, closing the gap is pure orbital mechanics: raise your orbit '
            + 'prograde to catch up, then match velocities retrograde. The 【Rendezvous burn】 '
            + 'button in the calculator will work out one step for you.') },

    { id: 'n16', target: '#tabs',
      title: T('⑤ 底部页签总览', '⑤ The bottom tab strip'),
      body: T('六个页签：\n'
            + '· 飞行日志：所有事件按时间排列（点火、分级、入轨、着陆…）\n'
            + '· 轨道计算器：本游戏的核心工具，下面专门讲\n'
            + '· AGC 汇编终端：写 AGC 汇编、汇编、装载、实时看执行\n'
            + '· 下传遥测：AGC 通道写入、DSKY 按键、程序告警\n'
            + '· 任务时序：真实 Apollo 11 的 195 小时完整时间线\n'
            + '· 系统自检：11 项断言，验证历表、轨道数学、兰伯特求解、AGC 汇编与执行',
              'Six tabs:\n'
            + '· Flight log: every event in order (ignition, staging, insertion, landing...)\n'
            + '· Orbit calculator: the core tool of the game - covered next\n'
            + '· AGC assembler: write AGC assembly, assemble, load and watch it execute\n'
            + '· Downlink: AGC channel writes, DSKY keystrokes, program alarms\n'
            + '· Timeline: the full real 195-hour Apollo 11 timeline\n'
            + '· Self-test: 11 assertions covering the ephemeris, orbital maths, Lambert '
            + 'solver, AGC assembly and execution') },

    { id: 'n17', target: '#calcTof', wait: 'tab_calc',
      title: T('⑤ 轨道计算器（一）：输入与输出', '⑤ Orbit calculator (1): inputs and outputs'),
      body: T('如果还没打开计算器页签，请先点底部的【轨道计算器】。\n\n'
            + '输入项：\n'
            + '· 转移飞行时间：到目标要飞多久。去月球用 72～73 小时\n'
            + '· 入轨目标高度：入轨圆化制导要停在哪，默认 185 km\n\n'
            + '点【计算轨道】后，右边会输出：当前轨道根数、月球历表（月心距 / 月黄经 / '
            + '天平动 / 着陆点日照）、霍曼式估算、以及兰伯特求解结果：'
            + '所需点火 Δv、转移轨道远地点、以及「速度增量是否足够」的判据。',
              'If the calculator tab is not open yet, click 【Orbit calculator】below.\n\n'
            + 'Inputs:\n'
            + '· Transfer time: how long the flight should take. 72-73 hours to the Moon\n'
            + '· Target insertion altitude: where circularization should stop (185 km)\n\n'
            + 'After clicking 【Solve orbit】, the right pane prints your current orbital '
            + 'elements, the lunar ephemeris (range, ecliptic longitude, libration, sun '
            + 'elevation at the site), a Hohmann-style estimate, and the Lambert solution: '
            + 'the required burn delta-v, the transfer apoapsis, and whether you actually '
            + 'have enough delta-v.') },

    { id: 'n18', target: '#btnCalc', wait: 'calc_used',
      title: T('⑤ 轨道计算器（二）：四个动作按钮', '⑤ Orbit calculator (2): the four action buttons'),
      body: T('· 【执行 TLI 点火】：按刚才的解自动点火，把飞船送上地月转移轨道\n'
            + '· 【入轨圆化制导】：启动入轨制导，把当前轨道圆化到目标高度并自动关机\n'
            + '· 【动力下降制导】：在月球 SOI 内启动着陆制导（先制动，再悬停下降）\n'
            + '· 【交会辅助点火】：给登月舱做一次交会修正点火，缩小两器间距\n\n'
            + '请点一下【计算轨道】把它们激活（没求解过的时候 TLI 会拒绝执行）。',
              '· 【Execute TLI burn】: applies the solution you just computed and puts you '
            + 'on the translunar trajectory\n'
            + '· 【Circularization guidance】: drives the current orbit to the target '
            + 'altitude and cuts off automatically\n'
            + '· 【Powered-descent guidance】: inside the Moon\'s SOI, starts landing '
            + 'guidance (brake first, then hover down)\n'
            + '· 【Rendezvous burn】: one correction burn toward the LM to close the gap\n\n'
            + 'Click 【Solve orbit】now to arm them (TLI refuses to fire until you have a '
            + 'solution).') },

    { id: 'n19', target: '#logBox',
      title: T('⑤ 飞行日志与事件', '⑤ The flight log'),
      body: T('飞行日志把发生过的每件事按 MET 时间排好，颜色区分类型：\n'
            + '· 琥珀色 = 真实 Apollo 11 的节点（对照用）\n'
            + '· 蓝色 = 模拟器产生的飞行事件（进入月球 SOI、分级、撞击…）\n'
            + '· 绿色 = 达成目标\n'
            + '· 红色 = 出问题了（比如撞击）\n\n'
            + '出问题时第一件事就是看这里最后一行。',
              'The log lists everything in MET order and colour-codes it:\n'
            + '· amber = real Apollo 11 milestones (for comparison)\n'
            + '· blue = events generated by the simulation (SOI entry, staging, impact...)\n'
            + '· green = objective achieved\n'
            + '· red = something went wrong\n\n'
            + 'When things go wrong, read the last line here first.') },

    { id: 'n20', target: '#dskyBox',
      title: T('④ DSKY 与 AGC 怎么用', '④ Using the DSKY and the AGC'),
      body: T('· PROG：正在运行的程序号（63 = 登月程序，11 = 地球轨道）\n'
            + '· VERB / NOUN：verbs 是动词（显示 / 装载 / 监控），nouns 是宾语（数据块）\n'
            + '· R1 / R2 / R3：三行数据寄存器\n'
            + '· 黄灯排：COMP ACTY（计算机活动）、PROG ALARM（程序告警）等\n'
            + '· 键盘：VERB / NOUN 进入输入模式，数字键填数，ENTR 确认\n\n'
            + '要自己写程序：底部【AGC 汇编终端】里改源码 → 【汇编并装载到 AGC】→ '
            + 'DSKY 立刻按你的程序跑。真实 AGC 用 15 位反码字，本项目完整复刻了'
            + '指令集、存储器分页与通道 I/O。',
              '· PROG: the running program number (63 = lunar landing, 11 = Earth orbit)\n'
            + '· VERB / NOUN: verbs are actions (display / load / monitor), nouns are the data\n'
            + '· R1 / R2 / R3: the three data registers\n'
            + '· the lamp row: COMP ACTY, PROG ALARM and friends\n'
            + '· keypad: VERB / NOUN enter a mode, digits fill the value, ENTR commits\n\n'
            + 'To write your own: edit the source in 【AGC assembler】 then '
            + '【Assemble & load into AGC】- the DSKY immediately runs it. The real AGC used '
            + '15-bit ones-complement words; this project reproduces the instruction set, '
            + 'memory banking and channel I/O.') },

    { id: 'n20a', target: '#dskyBox',
      title: T('④a 亲手用一次 DSKY（键入）', '④a Try the DSKY keyboard'),
      body: T('现在动手：先按【VERB】——VERB 寄存器会变成 V--，表示"正在键入动词"；\n'
            + '再按【1】【6】——寄存器变成 V16。\n\n'
            + '接着按【NOUN】【6】【8】（NOUN 寄存器显示 N68），最后按【ENTR】提交。\n'
            + '每按一个键，寄存器都会立刻变化 —— 这就是真 DSKY 的键入方式。\n'
            + '（按错了按【CLR】清掉重来；空手按 ENTR 会亮 OPR ERR，按 RSET 或 CLR 熄灭。）',
              'Hands on: press 【VERB】 - the VERB register shows V-- (entering a verb);\n'
            + 'then 【1】【6】 - it becomes V16.\n\n'
            + 'Then 【NOUN】【6】【8】 (N68) and 【ENTR】 to commit.\n'
            + 'Every key instantly shows in a register - that is how a real DSKY works.\n'
            + '(Press 【CLR】 to cancel; bare ENTR lights OPR ERR, RSET/CLR clears it.)') },
    { id: 'n20b', target: '#dskyBox',
      title: T('④b 让它跑起来：载入一个程序', '④b Make it run: load a program'),
      body: T('DSKY 显示的数字来自**运行中的 AGC 程序**。走到底部【AGC 汇编终端】，\n'
            + '选 dsky-demo.agc，点【汇编并装载到 AGC】——寄存器立刻显示 PROG=11、\n'
            + 'VERB=16、NOUN=36，R1 开始计数（这就是程序的输出）。\n\n'
            + '然后试试 attitude-hold.agc / lambert.agc，或自己改源码再装载。\n'
            + '想查 AGC 汇编语法，参考 chrislgarry/apollo-11（真实 AGC 源码）\n'
            + '与 virtualagc/virtualagc（模拟器与文档）。',
              'The numbers come from the **running AGC program**. Go to the 【AGC assembler】\n'
            + 'tab, pick dsky-demo.agc and click 【Assemble & load into AGC】 - the registers\n'
            + 'show PROG=11, VERB=16, NOUN=36 and R1 starts counting (the program output).\n\n'
            + 'Try attitude-hold.agc / lambert.agc, or edit the source and reload.\n'
            + 'For AGC assembly syntax see chrislgarry/apollo-11 (real AGC source)\n'
            + 'and virtualagc/virtualagc (emulator & docs).') },
    { id: 'n21', target: '#missionList', wait: 'mission_started',
      onEnter: function () {
        if (APLApp && APLApp.showMissionPicker) APLApp.showMissionPicker();
      },
      title: T('五个任务怎么打', 'How to beat the five missions'),
      body: T('· 01 飞船起飞：点【自动驾驶】→ 等入轨（可看远地点 ≈ 185 km）\n'
            + '· 02 地月转移：开计算器 → 飞行时间填 72 → 【计算轨道】→ '
            + '【执行 TLI 点火】→ 时间倍率拉到 ×20000 等三天\n'
            + '· 03 月球对接：先【分离登月舱】，再用【交会辅助点火】反复追，'
            + '接近到 200 m 内、相对速度降到 20 m/s 以下后【对接登月舱】\n'
            + '· 04 飞船降落：直接用【动力下降制导】，快到地面时留意垂直 / 水平速度\n'
            + '· 05 全流程：把上面四步按顺序连起来，全程 195 小时\n\n'
            + '请任选一个卡片点【开始任务】继续。',
              '· 01 Launch: click 【Autopilot】 and wait for insertion (apoapsis ~185 km)\n'
            + '· 02 TLI: open the calculator, set 72 h, 【Solve orbit】, '
            + '【Execute TLI burn】, then warp past x20000 for three days\n'
            + '· 03 Lunar docking: 【Undock LM】, then use 【Rendezvous burn】 repeatedly '
            + 'until within 200 m and under 20 m/s, then 【Dock LM】\n'
            + '· 04 Landing: just use 【Powered-descent guidance】 and watch the vertical '
            + 'and horizontal speeds near the ground\n'
            + '· 05 Full mission: chain all of the above, 195 hours end to end\n\n'
            + 'Pick any card and click 【Start mission】to continue.') },

    { id: 'n22', target: null,
      title: T('诀窍与常见问题', 'Tips and gotchas'),
      body: T('· 时间加速：变轨前降到 1～10 倍，滑行段拉到 5000 倍以上。'
            + '发动机工作时倍率会被自动限制，不用担心算错\n'
            + '· 掉回大气层：近地点低于 100 km 就会再入。马上顺行点火抬高近地点\n'
            + '· 飞出去了（逃逸）：偏心率大于 1 说明已经逃逸，没有补救手段 —— 读档重来\n'
            + '· 着陆撞毁：接地前垂直速度要 ≤ 2 m/s。用动力下降制导，'
            + '或手动把油门收到 10% 慢慢坐下去\n'
            + '· 推进剂用完：只能读档。看着「推进级」的进度条提前规划\n'
            + '· 对接失败：距离要 ≤ 200 m 且相对速度 ≤ 20 m/s，先减速再靠拢\n'
            + '· 换语言：任何时候点顶栏【EN】/【中文】\n\n'
            + '导航系统介绍到此结束。祝好运 —— 这是个人的一小步，却是人类的一大步。',
              '· Time warp: drop to 1-10x for a burn, raise above 5000x to coast. The warp '
            + 'is limited automatically while an engine is running\n'
            + '· Falling back into the atmosphere: periapsis below 100 km means re-entry. '
            + 'Burn prograde immediately to raise it\n'
            + '· Flew away: eccentricity above 1 means you have escaped - there is no fix, '
            + 'load a save\n'
            + '· Crashed on landing: keep the touchdown vertical speed at or under 2 m/s. '
            + 'Use the descent guidance, or throttle down to 10% and settle in slowly\n'
            + '· Out of propellant: reload. Watch the stage bars and plan ahead\n'
            + '· Docking fails: you need <= 200 m and <= 20 m/s relative - slow down before '
            + 'closing\n'
            + '· Switch language: click 【EN】/【中文】in the top bar at any time\n\n'
            + 'That is the navigation system. Good luck - one small step for man, one giant '
            + 'leap for mankind.') },

    { id: 'n23', target: '.tab[data-tab="guide"]', wait: 'tab_guide',
      title: T('制导手册：每条制导律 + 每个控件的用法',
              'Guidance manual: every law and every control'),
      body: T('底部还有一个【制导手册】页签，那里把本模拟器的**每一条制导律**'
            + '（上升制导、入轨 VGO、TLI、MCC、LOI-1/LOI-2、平面机动、DOI、'
            + '动力下降 P63/P64/P66、交会、月面起飞、TEI）逐条讲清：\n'
            + '· 它适用在哪个阶段\n'
            + '· 背后的原理是什么（含真实数值）\n'
            + '· 在面板上怎么触发\n'
            + '· 对应真实的哪个 Apollo 程序（P63 / P64 / P66 / P30 / P12 …）\n\n'
            + '还包含每个控件「什么时候用 / 点了会发生什么 / 一个典型操作序列」，'
            + '以及三条照着做就能飞的操作序列（起飞入轨 / 地月转移 / 动力下降着陆）。\n\n'
            + '现在点一下那个页签看看 —— 它是本项目里唯一一处"文档与代码行为必须一致"'
            + '的地方，手册里写的每条数值都能在飞行日志里对上。',
              'There is also a 【Guidance manual】 tab at the bottom. It documents every '
            + 'guidance law in this simulator (ascent, insertion VGO, TLI, MCC, LOI-1/LOI-2, '
            + 'plane changes, DOI, powered descent P63/P64/P66, rendezvous, lunar liftoff, TEI):\n'
            + '· which phase it belongs to\n'
            + '· the physics behind it (with real numbers)\n'
            + '· how to trigger it from the panel\n'
            + '· which real Apollo programme it corresponds to (P63 / P64 / P66 / P30 / P12 ...)\n\n'
            + 'It also covers what every control does, and three worked sequences '
            + '(launch to orbit, translunar injection, powered descent).\n\n'
            + 'Click that tab now - the manual is the one place in this project where the '
            + 'documentation has to match the code, and every number in it can be checked '
            + 'against the flight log.') }
  ];


  // ==================================================== 课程三：五个任务通关
  // 从零开始，一个任务一个任务教你打到全流程。每一步都高亮"该点哪个控件"，
  // 并说明"点了会发生什么 / 看到什么算成功"。绝不自动播放（01 文档第 3 节）。
  var MISSION_TRACK = [
    { id: 'g0', target: null,
      title: T('这套课程怎么用', 'How this course works'),
      body: T('前面两套课程教你「界面长什么样」；这一套教你「任务怎么打」——'
            + '从第 1 个任务起飞，一直到第 5 个全流程任务，一个不落。\n\n'
            + '每一步都有三件事：\n'
            + '· 标题：这一步要干什么\n'
            + '· 高亮框：**这一步该点界面上哪个控件**（黄色呼吸框，跟着语言自动翻译）\n'
            + '· 正文：点了会发生什么、看到什么数字算成功\n\n'
            + '正文写得再细，也不如自己点一次。看到高亮框就去点它。',
              'The first two courses teach you the interface. This one teaches you how to fly '
            + 'the missions - from mission 1 through the full-mission flight.\n\n'
            + 'Every step has three things: a title (what to do), a pulsing highlight box '
            + '(which control to click) and the body text (what happens and what success looks like).',
            ) },
    { id: 'g1', target: '#btnPlay',
      title: T('先记住这四个开关', 'Four switches to remember first'),
      body: T('· 【▶ 继续 / ⏸ 暂停】(顶栏)：仿真在跑还是停着。教程里请让它跑着\n'
            + '· 【+ / −】(顶栏)：时间倍率 1×~300000×。变轨前降到 1~10×，滑行段拉到几万倍；'
            + '发动机工作时倍率会被自动限制，不用担心算错\n'
            + '· 【评定】(顶栏)：任何时候点它，会按任务的达成条件给你打分\n'
            + '· 卡片上的【开始任务】/【自动演示】：自己打用前者；'
            + '打不动了再看【自动演示】——演示会自动完成整条任务链，'
            + '横幅上会高亮它这一步点的是哪个按钮，可以照着学',
              '· Play/Pause (top bar): whether the simulation is running\n'
            + '· + / - (top bar): time warp. Drop to 1-10x for a burn, raise it for coasts\n'
            + '· Finish (top bar): score the mission against its objectives\n'
            + '· Start mission / Auto-demo on each card: fly it yourself first, watch the demo '
            + 'afterwards - the demo highlights the very button it is using') },

    { id: 'g2', target: '#missionList .mcard', wait: 'mission_started',
      title: T('任务 01 起飞 · 第 1 步：选任务', 'Mission 01 Launch - pick the mission'),
      onEnter: function () { if (APLApp && !APLApp.world && APLApp.showMissionPicker) APLApp.showMissionPicker(); },
      body: T('点开【选择任务】（如果已经开着就不用点），在列表里找「01 飞船起飞」，'
            + '点它卡片下面的【开始任务】。\n\n'
            + '目标：从 LC-39A 点火，进入 183 × 186 km、倾角 32.5° 的地球停泊轨道。',
              'Open the mission picker and start "01 Launch". Goal: reach a 183 x 186 km '
            + 'parking orbit at 32.5 degrees inclination.') },

    { id: 'g3', target: '#left',
      title: T('任务 01 · 第 2 步：先看懂左边遥测', 'Mission 01 - read the telemetry'),
      body: T('左边这一栏是你唯一的仪表盘，起飞前先认四行：\n'
            + '· 高度 / 轨道速度：现在是 0 km / 0.46 km/s（发射场随地球自转的速度）\n'
            + '· 垂直速度 / 水平速度：火建爬升主要看这两个\n'
            + '· 高度、近地点、远地点：入轨任务看后两个\n'
            + '· 推进级 / 推进剂：往下看，S-IC 一级带着 2 150 t 推进剂',
              'The left panel is your only instrument board. Before liftoff look at altitude, '
            + 'orbital speed, vertical/horizontal speed, and the stage/propellant bars.') },

    { id: 'g4', target: '#btnAuto', wait: 'autopilot_on',
      title: T('任务 01 · 第 3 步：起飞（自动驾驶）', 'Mission 01 - lift off (autopilot)'),
      body: T('点【自动驾驶】。它做的事等价于真实 AGC 里的上升制导程序：\n'
            + '全推力点火 → 按土星五号的真实俯仰程序转弯 → 到 Max-Q 减到中央发动机 → '
            + '一级关机分级 → 二级点火 → 三级接手入轨。\n\n'
            + '想手动也行：姿态选【上升】、油门拉到 100%。但第一次建议用自动驾驶。\n'
            + '注意右下角 DSKY 会开始闪 —— 那是真的 AGC 在执行程序。',
              'Click Autopilot. It runs the same guidance the real AGC did: full thrust, the '
            + 'Saturn V pitch program, Max-Q throttle-down, staging, and insertion.') },

    { id: 'g5', target: '#stageList', wait: 'stage_done',
      title: T('任务 01 · 第 4 步：手动分一次级（练手）', 'Mission 01 - stage once by hand'),
      body: T('自动分级其实是开着的，所以你会看到日志里自己抛出 S-IC。'
            + '现在请你亲手点一次【分级 / 抛离】感受一下 —— 它抛掉的是已经烧空的子级。\n\n'
            + '看左边的「推进级 / 推进剂」条：抛掉的级会从列表里消失，'
            + '总质量立刻掉一大截（S-IC 空重 137 t）。',
              'Auto-staging is on, but press Stage once yourself to feel it. Watch the '
            + 'stage/propellant list on the left - the jettisoned stage disappears and the total '
            + 'mass drops sharply.') },

    { id: 'g6', target: '#left', wait: 'orbit_reached',
      title: T('任务 01 · 第 5 步：等入轨，看达成条件', 'Mission 01 - wait for insertion'),
      body: T('顶栏【+】把倍率加到 40~100，盯着遥测。三级 S-IVB 会在 T+630 s 左右自动关机。\n\n'
            + '达成条件（点【评定】会逐条核对）：\n'
            + '· 高度 ≥ 80 km、近地点 ≥ 180 km、远地点 ≤ 195 km\n'
            + '· 速度 ≥ 7.7 km/s、偏心率 < 0.001\n\n'
            + '看到「已进入稳定的地球停泊轨道」就算过关。',
              'Raise the warp to 40-100x and watch. The S-IVB cuts off around T+630 s. '
            + 'Success: perigee >= 180 km, apogee <= 195 km, speed >= 7.7 km/s.') },

    { id: 'g7', target: '#btnFinish',
      title: T('任务 01 · 第 6 步：评定成绩', 'Mission 01 - score it'),
      body: T('点顶栏【评定】，会逐条告诉你哪个达成条件过了、哪个没过。\n\n'
            + '这一关过了就继续下一课；没过就再开一次任务，把倍率降一点、'
            + '盯着「近地点/远地点」两个数看它怎么爬上来。',
              'Click Finish in the top bar to see which objectives passed. Then move on to '
            + 'mission 02.') },

    { id: 'g8', target: '#missionList .mcard', wait: 'mission_started',
      title: T('任务 02 地月转移 · 第 1 步：选任务', 'Mission 02 TLI - pick the mission'),
      onEnter: function () { if (APLApp && APLApp.showMissionPicker) APLApp.showMissionPicker(); },
      body: T('选「02 地月轨道转移」。任务开始时你已经在 183×186 km 停泊轨道上了，'
            + 'S-IVB 里还剩大半推进剂 —— 这就是真实 TLI 的起点。\n\n'
            + '目标：找对窗口 → TLI 点火 → 3 天后 LOI 进环月轨道。',
              'Start "02 TLI". You begin in the parking orbit with a partly loaded S-IVB - '
            + 'exactly the real starting point for TLI.') },

    { id: 'g9', target: '#tab-calc',
      title: T('任务 02 · 第 2 步：打开轨道计算器', 'Mission 02 - open the calculator'),
      body: T('点底部第二个页签【轨道计算器】。它上面是当前轨道根数、地月几何，'
            + '下面是转移求解。\n\n'
            + '飞行时间（小时）已经填好 72 —— 真实阿波罗从 TLI 到 LOI 就是约 73 小时。',
              'Open the Orbit calculator tab. The time of flight is preset to 72 hours - '
            + 'the real Apollo took about 73 hours from TLI to LOI.') },

    { id: 'g10', target: '#btnCalc', wait: 'calc_used',
      title: T('任务 02 · 第 3 步：点『计算轨道』', 'Mission 02 - solve the orbit'),
      body: T('点【计算轨道】。它会做两件事：\n'
            + '· 用兰伯特问题解出「现在点火需要多少 Δv、朝哪个方向」\n'
            + '· 扫描停泊轨道上的相位，算出**最佳转移窗口**（等多久点火最省燃料）\n\n'
            + '相位不对就硬点火，Δv 会从 3.05 km/s 涨到十几 km/s —— 真实任务也是要等窗口的。',
              'Click Solve. It runs the Lambert problem and scans for the best transfer '
            + 'window. Burning at the wrong phase wastes several times the propellant.') },

    { id: 'g11', target: '#calcOut',
      title: T('任务 02 · 第 4 步：读懂那坨输出', 'Mission 02 - read the output'),
      body: T('重点看三行：\n'
            + '· 【兰伯特转移求解】里的「所需点火 Δv」：应该在 3.0~3.3 km/s 量级\n'
            + '· 「转移轨道远地点」：应该接近 38 万 km（月球轨道半径）\n'
            + '· 【最佳转移窗口】：「再滑行 XX 分钟（约 N 圈）后点火」\n\n'
            + '如果 Δv 是 11 km/s 这种荒唐值，说明相位差得远 —— 打开预演看看轨迹，'
            + '或者干脆按窗口提示滑行过去再算。',
              'Look at three lines: the required burn dv (3.0-3.3 km/s), the transfer '
            + 'apogee (near 380,000 km), and the best-window hint.') },

    { id: 'g12', target: '#btnWarpUp',
      title: T('任务 02 · 第 5 步：滑行到窗口', 'Mission 02 - coast to the window'),
      body: T('顶栏【+】把倍率加到 2000 左右，让飞船把剩下的相位绕完。\n\n'
            + '滑行时打开视图栏的【轨道预演】，你能看到一条虚线轨迹：'
            + '那就是按当前速度+全部引力外推出来"接下来会飞到哪"，点火后它会立刻重算。',
              'Raise the warp to about 2000x and coast. Turn on the Orbit prediction in the '
            + 'view bar to see where the current velocity will take you.') },

    { id: 'g13', target: '#btnTLI', wait: 'tli_done',
      title: T('任务 02 · 第 6 步：执行 TLI 点火', 'Mission 02 - execute the TLI burn'),
      body: T('先【计算轨道】刷新一次求解结果，然后点【执行 TLI 点火】。\n\n'
            + '这一次点火是**有限推力**：S-IVB 要烧 5 分钟左右、烧掉约 76 t 推进剂，'
            + '期间飞船会沿着轨道前移两千多公里 —— 制导每一步都在重算目标速度，'
            + '这就是真实运载器的迭代制导。\n\n'
            + '点火结束后看飞行日志：会写明燃烧时长、耗油、以及「重力损耗」。',
              'Solve again, then click Execute TLI burn. This is a finite burn: the S-IVB '
            + 'burns for about 5 minutes and about 76 t of propellant. The flight log prints '
            + 'the burn time, propellant and gravity loss.') },

    { id: 'g14', target: '#btnStage',
      title: T('任务 02 · 第 7 步：抛掉 S-IVB，然后滑行', 'Mission 02 - drop the S-IVB'),
      body: T('TLI 之后 S-IVB 就是死重了，真实任务立刻把它抛掉。点【分级 / 抛离】。\n\n'
            + '接着顶栏【+】拉满倍率滑行 3 天。中途留意遥测里的「距月球」在快速变小，'
            + '以及「着陆点日照仰角」——那个数是真实历表算出来的，着陆时应该在 10° 上下。',
              'Jettison the spent S-IVB, then warp through the three-day coast. Watch the '
            + 'distance to the Moon shrink.') },

    { id: 'g15', target: '#left',
      title: T('任务 02 · 第 8 步：LOI 与达成', 'Mission 02 - LOI and success'),
      body: T('接近月球时把倍率降到 50~500。飞船会进入月球引力影响球（日志里会写），'
            + '然后服务舱 SPS 自动点火做 LOI 捕获，把飞船拉进环月轨道。\n\n'
            + '达成条件：转移轨道远地点 ≥ 35 万 km、与月球最近距离 ≤ 2000 km、'
            + 'LOI 后环月近点高度 ≤ 200 km。点【评定】核对。',
              'Near the Moon the SPS captures you into lunar orbit. Objectives: transfer '
            + 'apogee >= 350,000 km, lunar approach within 2000 km, lunar periapsis <= 200 km.') },

    { id: 'g16', target: '#missionList .mcard', wait: 'mission_started',
      title: T('任务 03 月球对接 · 第 1 步：选任务', 'Mission 03 docking - pick the mission'),
      onEnter: function () { if (APLApp && APLApp.showMissionPicker) APLApp.showMissionPicker(); },
      body: T('选「03 月球对接」。这次你和登月舱是刚性连在一起的，'
            + '要先把 Eagle 放出去，再靠轨道力学追回来。\n\n'
            + '这是真实任务里最关键的一步 —— 对接不上就回不了家。',
              'Start "03 Docking". You must release Eagle, then catch it again with orbital '
            + 'mechanics. This is the step that decides whether the crew gets home.') },

    { id: 'g17', target: '#btnUndock', wait: 'undock_done',
      title: T('任务 03 · 第 2 步：分离登月舱', 'Mission 03 - undock the LM'),
      body: T('点【分离登月舱】。Eagle 会被拆成一台**独立的飞行器**，'
            + 'RCS 推进剂对半分，两器之间会有一点分离速度。\n\n'
            + '分离之后注意【切换飞行器】按钮亮了 —— 那是你手动接手登月舱的入口。',
              'Click Undock LM. Eagle becomes a separate spacecraft. The Switch craft button '
            + 'lights up - that is how you take over the LM manually.') },

    { id: 'g18', target: '#left',
      title: T('任务 03 · 第 3 步：看相对距离和相对速度', 'Mission 03 - watch the range'),
      body: T('顶栏【+】加速，看两器之间的距离慢慢拉开到 500 m 以上，再往回收。\n\n'
            + '交会的关键不是"追上去"，而是**把相对速度收住**：'
            + '靠近得太快会撞上，太慢永远追不上。真实阿波罗用的是交会雷达 + 比例导引。',
              'Raise the warp and watch the range open to 500 m and then close again. The '
            + 'hard part of rendezvous is nulling the relative velocity, not catching up.') },

    { id: 'g19', target: '#btnRend',
      title: T('任务 03 · 第 4 步：交会辅助点火', 'Mission 03 - rendezvous burn'),
      body: T('点【交会辅助点火】。它是一套闭环制导：距离远时接近得快（最多 20 m/s），'
            + '距离越近越慢，并自动抵消横向漂移。\n\n'
            + '点一次不够就多点几次 —— 它每次都会按当前状态重新算。'
            + '反复点几次，距离会稳定收敛到 150 m 以内、相对速度 20 m/s 以内。',
              'Click Rendezvous burn. It closes the range quickly when far and slowly when '
            + 'near, nulling lateral drift. Click it a few times until the range settles '
            + 'under 150 m.') },

    { id: 'g20', target: '#btnDock', wait: 'dock_done',
      title: T('任务 03 · 第 5 步：对接', 'Mission 03 - dock'),
      body: T('当距离 ≤ 200 m、相对速度 ≤ 20 m/s 时点【对接登月舱】，两器刚性连接，'
            + '模块合并，又能一起飞了。\n\n'
            + '达成条件里还有一条「LM 分离后最短距离 ≥ 500 m」—— 要真的拉开过距离才算数。',
              'Within 200 m and 20 m/s, click Dock LM. The craft becomes rigidly mated again.') },

    { id: 'g21', target: '#missionList .mcard', wait: 'mission_started',
      title: T('任务 04 飞船降落 · 第 1 步：选任务', 'Mission 04 landing - pick the mission'),
      onEnter: function () { if (APLApp && APLApp.showMissionPicker) APLApp.showMissionPicker(); },
      body: T('选「04 飞船降落」。你已经在 111 km 环月轨道上，轨道面精确通过静海基地 —— '
            + '这是真实任务要飞好几圈才能等到的窗口。\n\n'
            + '目标：走完制动段 → 接近段 → 最终下降，在静海基地安全着陆。燃料只有一次机会。',
              'Start "04 Landing". You are in a 111 km lunar orbit whose plane passes over '
            + 'Tranquility Base. Goal: brake, approach, and touch down safely.') },

    { id: 'g22', target: '#btnWarpUp',
      title: T('任务 04 · 第 2 步：等下降轨道窗口', 'Mission 04 - wait for the window'),
      body: T('顶栏【+】加速，让飞船滑行到着陆点的**正对面**（绕半圈后正好从基地上空过）。\n\n'
            + '看遥测里的「到静海基地」这一行：它先变小再变大，说明你越过了正上方。'
            + '正确的下降窗口是"基地在对面"的时候点火 —— 演示会自己等到这一刻。',
              'Warp until the vehicle is opposite the landing site, then the descent burn puts '
            + 'perilune right above Tranquility Base.') },

    { id: 'g23', target: '#btnWarpDown',
      title: T('任务 04 · 第 3 步：降倍率、进关键阶段', 'Mission 04 - slow down'),
      body: T('下落前把倍率降到 1~10×。接下来的动力下降是**制导关键阶段**：'
            + '倍率一高，闭环制导就跟不上（一帧等于几十秒的推力）。\n\n'
            + '演示模式在这种情况下会自动限幅并写明原因，但手动玩要靠你自己。',
              'Drop the warp to 1-10x. Powered descent is guidance-critical: at high warp the '
            + 'closed loop cannot keep up.') },

    { id: 'g24', target: '#btnLand',
      title: T('任务 04 · 第 4 步：启动动力下降制导', 'Mission 04 - start the descent guidance'),
      body: T('点【动力下降制导】。它会自动走完真实 Apollo 的三段式：\n'
            + '· P63 制动段：把 1.7 km/s 的水平速度收掉大半\n'
            + '· P64 接近段：抬头看地面，边下边找着陆点\n'
            + '· P66 终端下降：只保下沉率，稳稳坐下\n\n'
            + '要理解这段的物理，可以看一眼【制导手册】里"动力下降"那一条。',
              'Click Powered-descent guidance. It runs the real three-phase profile: '
            + 'braking (P63), approach (P64) and terminal descent (P66).') },

    { id: 'g25', target: '#left', wait: 'landing_done',
      title: T('任务 04 · 第 5 步：盯着三个数落地', 'Mission 04 - watch three numbers'),
      body: T('下降时只看三个数：高度、垂直速度、水平速度。\n\n'
            + '你会看到一个反直觉的现象：刚点火时**下沉率几乎为零**（vv ≈ −3 m/s），'
            + '飞行器像失重一样飘着 —— 因为 111 km 环月速度 1.63 km/s，'
            + '而下降发动机最大加速度只有 2.93 m/s²，"有效重力" f = g − vh²/r ≈ 0.04 m/s²。'
            + '下沉率是被这点残余重力慢慢喂出来的。\n\n'
            + '触发「接触灯亮」就算着陆。接地垂直速度要 ≤ 2 m/s。',
              'Watch altitude, vertical speed and horizontal speed. At PDI the sink rate is '
            + 'nearly zero: the effective gravity g - vh^2/r is only about 0.04 m/s2 at 111 km, '
            + 'so the vehicle is almost weightless and sinks very slowly.') },

    { id: 'g26', target: '#btnFinish',
      title: T('任务 04 · 第 6 步：评定', 'Mission 04 - score it'),
      body: T('点【评定】。达成条件：落点距离 ≤ 0.5 km、垂直速度 ≤ 2 m/s、'
            + '水平速度 ≤ 1.5 m/s、推进剂没烧穿。\n\n'
            + '自动演示跑这一关的实测结果是**落点偏差 37 m**，剩约 400 kg 推进剂 —— '
            + '对比一下你的成绩。',
              'Score it. The auto-demo lands within about 37 m with roughly 400 kg left.') },

    { id: 'g27', target: '#missionList .mcard', wait: 'mission_started',
      title: T('任务 05 全流程 · 第 1 步：选任务', 'Mission 05 full flight - pick the mission'),
      onEnter: function () { if (APLApp && APLApp.showMissionPicker) APLApp.showMissionPicker(); },
      body: T('选「05 全流程模拟」。这是从点火到溅落的 195 小时 18 分，'
            + '8 个主要节点全都要自己飞：起飞 → 入轨 → TLI → 对接 → 转移 → LOI → 着陆 → '
            + '上升 → 返回 → 溅落。\n\n'
            + '接下来几步按顺序告诉你每个阶段该干什么。',
              'Start "05 Full mission". This is the whole 195 h 18 min flight with eight '
            + 'major milestones. There is also an Auto-demo button on the card.') },

    { id: 'g28', target: '#btnAuto',
      title: T('任务 05 · 第 2 步：起飞 + 入轨', 'Mission 05 - launch and insertion'),
      body: T('和任务 01 一样：点【自动驾驶】起飞，倍率加到 40 左右，等三级关机入轨。\n\n'
            + '全流程任务里你还要**手动抛掉 S-IVB 以外的适配段**：日志会提示分级，'
            + '【分级 / 抛离】随时可以点。',
              'Same as mission 01: Autopilot, warp 40x, wait for insertion.') },

    { id: 'g29', target: '#tab-calc',
      title: T('任务 05 · 第 3 步：TLI（和任务 02 一样）', 'Mission 05 - TLI'),
      body: T('打开【轨道计算器】→【计算轨道】→ 看窗口 → 滑行到位 → 【执行 TLI 点火】→ '
            + '抛掉 S-IVB。\n\n'
            + 'TLI 之后是 73 小时的地月转移。这段时间把倍率拉到 5 万倍，'
            + '顺手打开【轨道预演】看看轨迹，或者去 AGC 页签写两行汇编玩。',
              'Calculator -> Solve -> coast to the window -> Execute TLI -> Stage. Then warp '
            + 'through the 73-hour coast.') },

    { id: 'g30', target: '#btnWarpUp',
      title: T('任务 05 · 第 4 步：接近月球 + LOI 捕获', 'Mission 05 - lunar approach and LOI'),
      body: T('接近月球时降到 500~2000×。飞船会进入月球引力影响球，'
            + '服务舱自动点火做 LOI 捕获 + 圆化。\n\n'
            + '注意推进剂：服务舱 SPS 的油量是有限的，'
            + 'LOI 之后如果再去做大幅度的平面机动，很可能会把它烧干 —— '
            + '真实任务也是精打细算的。',
              'Drop to 500-2000x near the Moon. The SPS captures you into lunar orbit. Watch '
            + 'the service module propellant - it is the mission-limiting consumable.') },

    { id: 'g31', target: '#btnSwitch',
      title: T('任务 05 · 第 5 步：分离并接手登月舱', 'Mission 05 - undock and take the LM'),
      body: T('点【分离登月舱】，然后点【切换飞行器】把手动控制权交给 Eagle —— '
            + '按钮上会显示你要切到哪台。\n\n'
            + '切过去之后，遥测、控制条、油门全部作用于登月舱；'
            + '再点一次就切回指令舱（App.lm 那台）。',
              'Undock, then click Switch craft to take over Eagle. Every panel now controls '
            + 'the LM. Click it again to switch back.') },

    { id: 'g32', target: '#btnLand',
      title: T('任务 05 · 第 6 步：动力下降着陆', 'Mission 05 - powered descent'),
      body: T('和任务 04 完全一样：等下降窗口 → 降倍率 → 点【动力下降制导】→ 触地。\n\n'
            + '着陆后推进剂大概只剩几百公斤 —— 这是真实的余量水平。',
              'Exactly like mission 04: wait for the window, slow the warp down, start the '
            + 'powered-descent guidance, touch down.') },

    { id: 'g33', target: '#btnAuto',
      title: T('任务 05 · 第 7 步：月面起飞 + 再次对接', 'Mission 05 - liftoff and re-dock'),
      body: T('月面活动（EVA）是压缩的一段停留。之后：\n'
            + '· 点【自动驾驶】让上升级 APS 点火，按 0.45°/s 的俯仰程序爬升到 111 km 环月轨道\n'
            + '· 点【交会辅助点火】追上 Columbia\n'
            + '· 距离 ≤ 200 m 时点【对接登月舱】\n'
            + '· 对接完成后点【分级 / 抛离】扔掉上升级',
              'EVA is compressed. Then: Autopilot lifts off with the APS, Rendezvous burn '
            + 'catches Columbia, Dock LM mates, and Stage drops the ascent stage.') },

    { id: 'g34', target: '#btnWarpUp',
      title: T('任务 05 · 第 8 步：TEI 与溅落', 'Mission 05 - TEI and splashdown'),
      body: T('服务舱 SPS 会自动点火做 TEI（返回地球注入），然后就是约 3 天的返回滑行。\n\n'
            + '最后进入地球大气：先放减速伞（320 m² 阻力面积），'
            + '再放三顶主伞（2500 m²），溅落太平洋。\n\n'
            + '达成条件：8 个节点全过、任务时间 ≤ 200 h。点【评定】收尾。',
              'The SPS burns for TEI, then about three days of coast, then re-entry and '
            + 'splashdown. Score it with Finish.') },

    { id: 'g35', target: null,
      title: T('通关了，接下来玩什么', 'You made it - what next'),
      body: T('五个任务都打过一遍之后，你可以：\n'
            + '· 回【制导手册】页签把每条制导律的原理读一遍 —— 里面写的每个数值'
            + '都能在飞行日志里对上\n'
            + '· 去【AGC 汇编终端】写一段真正的 AGC 汇编，通过通道 030o/031o/032o '
            + '直接操纵油门、姿态和分级（内置 attitude-hold.agc 就是范例）\n'
            + '· 打开 2D 模式看轨道面、打开轨道预演看未来的轨迹\n'
            + '· 尝试"最省燃料"的玩法：用 TLI 窗口搜索和交会制导把 Δv 压到最低\n\n'
            + '祝好运 —— 这是个人的一小步，却是人类的一大步。',
              'Once you have flown all five missions: read the Guidance manual, write real '
            + 'AGC assembly to fly the ship, watch the orbits in 2D, and try to fly each '
            + 'mission on minimum propellant.') }
  ];

  var TRACKS = [
    // group: 'ui' = 界面教程（认识界面与操作）；'mission' = 任务教程（五个任务怎么打）
    { id: 'quick', group: 'ui', name: T('快速上手', 'Quick start'),
      desc: T('12 步，从选任务一路走到着陆与 AGC，约 5 分钟。',
              '12 steps: pick a mission, fly it, land, and play with the AGC. About 5 minutes.'),
      steps: QUICK },
    { id: 'nav', group: 'ui', name: T('导航系统介绍', 'Navigation system'),
      desc: T('24 步，把画布 / 遥测 / 控制条 / 计算器 / DSKY / 制导手册与五个任务打法逐项讲清。',
              '24 steps: every panel, every number, every button, plus how to beat each mission.'),
      steps: NAV },
    { id: 'mission', group: 'mission', name: T('五个任务通关（从零到全流程）', 'Five missions, start to finish'),
      desc: T('36 步，从第 1 个任务起飞一直教到第 5 个全流程任务；每一步都会高亮"该点哪个控件"。',
              '36 steps: fly mission 01 through mission 05, with the control you need highlighted at every step.'),
      steps: MISSION_TRACK }
  ];

  // ------------------------------------------------------------ 引擎
  var Tut = { active: false, trackId: null, index: 0, mask: null, card: null };

  function lang() { return APL.getLang ? APL.getLang() : 'zh'; }
  function pick(o) { return o ? (lang() === 'en' ? o.en : o.zh) : ''; }
  function track() {
    for (var i = 0; i < TRACKS.length; i++) { if (TRACKS[i].id === Tut.trackId) return TRACKS[i]; }
    return TRACKS[0];
  }
  function steps() { var tk = track(); return tk ? tk.steps : QUICK; }

  function ensureDom() {
    if (Tut.mask) return;
    var mask = document.createElement('div');
    mask.id = 'tutMask';
    var card = document.createElement('div');
    card.id = 'tutCard';
    card.innerHTML =
      '<div class="thead">' +
        '<span class="ttag" id="tutTag"></span>' +
        '<span class="tprog" id="tutProg"></span>' +
        '<button class="tx" id="tutExit">\u00d7</button>' +
      '</div>' +
      '<div id="tutChoose" class="tchoose">' +
        '<div class="tctitle" id="tutChooseTitle"></div>' +
        '<div class="tcbtns" id="tutChooseBtns"></div>' +
      '</div>' +
      '<div id="tutStep">' +
        '<h3 id="tutTitle"></h3>' +
        '<p id="tutBody"></p>' +
        '<div class="tfoot">' +
          '<button id="tutPrev"></button>' +
          '<button id="tutSwitch" class="mini"></button>' +
          '<button id="tutSkip" class="mini"></button>' +
          '<button id="tutNext" class="primary"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);
    document.body.appendChild(card);
    Tut.mask = mask; Tut.card = card;
    $('tutExit').onclick = function () { Tut.stop(); };
    $('tutPrev').onclick = function () { Tut.go(Tut.index - 1); };
    $('tutNext').onclick = function () { Tut.go(Tut.index + 1); };
    $('tutSkip').onclick = function () { Tut.go(Tut.index + 1); };
    $('tutSwitch').onclick = function () { Tut.showChooser(); };
  }

  function targetRect(sel) {
    if (!sel) return null;
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { el: el, r: r };
  }

  function layout(t, chooser) {
    var card = Tut.card;
    var W = window.innerWidth, H = window.innerHeight;
    var cw = chooser ? Math.min(520, W - 40) : Math.min(452, W - 40);
    card.style.width = cw + 'px';
    var cx, cy;
    if (!t) { cx = (W - cw) / 2; cy = Math.max(20, H * 0.12); }
    else {
      // ★ 固定槽位（不再跟着目标跑，否则"下一步"按钮每步都换位置）：
      //   目标中心在上 45% → 卡片固定在上半屏（top=74，避开顶栏）；
      //   否则固定在下半屏（距底 96px，避开底部控制条）。水平始终居中。
      cx = Math.max(16, Math.min((W - cw) / 2, W - cw - 16));
      var estH = card.offsetHeight || 300;
      var slotTop = (t.r.top + t.r.height / 2) < H * 0.45;
      cy = slotTop ? 74 : Math.max(16, H - estH - 96);
    }
    card.style.left = Math.round(cx) + 'px';
    card.style.top = Math.round(cy) + 'px';
    if (t) {
      Tut.mask.style.left = t.r.left + 'px';
      Tut.mask.style.top = t.r.top + 'px';
      Tut.mask.style.width = t.r.width + 'px';
      Tut.mask.style.height = t.r.height + 'px';
      Tut.mask.classList.add('spot');
    } else {
      Tut.mask.classList.remove('spot');
      Tut.mask.style.left = '0px'; Tut.mask.style.top = '0px';
      Tut.mask.style.width = '100%'; Tut.mask.style.height = '100%';
    }
  }

  // -------------------------------------------------- 课程选择界面
  Tut.showChooser = function () {
    ensureDom();
    Tut.active = true;
    Tut.trackId = null;
    $('tutChoose').style.display = 'block';
    $('tutStep').style.display = 'none';
    $('tutTag').textContent = APL.t('tut.title');
    $('tutProg').textContent = '';
    $('tutChooseTitle').textContent = APL.t('tut.choose');
    var box = $('tutChooseBtns');
    box.innerHTML = '';
    var lastGroup = null, firstOfGroup = false;
    TRACKS.forEach(function (tk) {
      // 分组标题：界面教程（认识界面） / 任务教程（一个任务一个任务打）
      if (tk.group !== lastGroup) {
        lastGroup = tk.group;
        firstOfGroup = true;
        var gh = document.createElement('div');
        gh.className = 'tgroup';
        gh.textContent = APL.t(tk.group === 'mission' ? 'tut.group.mission' : 'tut.group.ui');
        box.appendChild(gh);
      }
      var b = document.createElement('button');
      b.className = 'tck' + (firstOfGroup ? ' primary' : '');
      firstOfGroup = false;
      var bn = document.createElement('b');
      bn.textContent = pick(tk.name);
      var sp = document.createElement('span');
      sp.textContent = pick(tk.desc);
      b.appendChild(bn); b.appendChild(sp);
      b.onclick = function () { Tut.startTrack(tk.id); };
      box.appendChild(b);
    });
    Tut.card.classList.add('show');
    if (Tut.mask) { Tut.mask.classList.remove('spot'); Tut.mask.classList.add('show'); }
    layout(null, true);
  };

  Tut.startTrack = function (id) {
    ensureDom();
    Tut.trackId = id;
    try { localStorage.setItem('apollo11.tutTrack', id); } catch (e) {}
    $('tutChoose').style.display = 'none';
    $('tutStep').style.display = 'block';
    Tut.go(0);
  };

  // -------------------------------------------------- 渲染当前步
  Tut.refresh = function () {
    if (!Tut.active) return;
    if (!Tut.trackId) { Tut.showChooser(); return; }
    var list = steps();
    var st = list[Tut.index];
    if (!st) return;
    $('tutChoose').style.display = 'none';
    $('tutStep').style.display = 'block';
    $('tutTag').textContent = pick(track().name);
    $('tutProg').textContent = APL.t('tut.step', { n: Tut.index + 1, N: list.length });
    $('tutTitle').textContent = pick(st.title);
    $('tutBody').textContent = pick(st.body);
    $('tutPrev').textContent = APL.t('tut.prev');
    $('tutSkip').textContent = APL.t('tut.skip');
    $('tutSwitch').textContent = APL.t('tut.switch');
    $('tutNext').textContent = (Tut.index >= list.length - 1)
      ? APL.t('tut.done') : APL.t('tut.next');
    $('tutPrev').disabled = Tut.index === 0;

    Tut.card.classList.add('show');
    if (Tut.mask) Tut.mask.classList.add('show');
    layout(targetRect(st.target), false);
    if (st.wait) Tut.card.classList.add('waiting'); else Tut.card.classList.remove('waiting');
    // 每步渲染后聚焦【下一步】：鼠标不用回按钮，直接回车/空格连跳
    try {
      var nb = $('tutNext');
      if (nb && !nb.disabled) nb.focus({ preventScroll: true });
    } catch (eF) { /* 旧浏览器忽略 */ }
  };

  Tut.go = function (i) {
    var list = steps();
    if (i < 0) i = 0;
    if (i >= list.length) { Tut.stop(); return; }
    Tut.index = i;
    var st = list[i];
    if (st && typeof st.onEnter === 'function') {
      try { st.onEnter(); } catch (e) { /* ignore */ }
    }
    Tut.refresh();
    setTimeout(Tut.refresh, 90);
  };

  Tut.start = function (trackId) {
    ensureDom();
    Tut.active = true;
    var id = trackId;
    if (!id) {
      try { id = localStorage.getItem('apollo11.tutTrack'); } catch (e) { id = null; }
    }
    var found = null;
    for (var i = 0; i < TRACKS.length; i++) { if (TRACKS[i].id === id) found = id; }
    if (found) Tut.startTrack(found); else Tut.showChooser();
  };

  Tut.stop = function () {
    Tut.active = false;
    if (Tut.card) Tut.card.classList.remove('show');
    if (Tut.mask) Tut.mask.classList.remove('show');
  };

  Tut.toggle = function () { if (Tut.active) Tut.stop(); else Tut.start(); };

  // 事件通知：当前步在等某个事件时自动前进
  Tut.notify = function (ev) {
    if (!Tut.active) return;
    if (typeof ev !== 'string' || ev === '') return;
    var list = steps();
    var st = list[Tut.index];
    if (st && typeof st.wait === 'string' && st.wait === ev) {
      setTimeout(function () { if (Tut.active) Tut.go(Tut.index + 1); }, 800);
    }
  };

  APL.Tutorial = Tut;
  APL.TUTORIAL_TRACKS = TRACKS;
  APL.TUTORIAL_STEPS = QUICK.concat(NAV);
  global.addEventListener('resize', function () { if (Tut.active) Tut.refresh(); });
  global.addEventListener('apollo-lang-changed', function () { if (Tut.active) Tut.refresh(); });

})(typeof window !== 'undefined' ? window : globalThis);
