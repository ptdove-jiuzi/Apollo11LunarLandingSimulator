# 项目长期记忆 · 阿波罗11号登月模拟器

## 项目约定
- 交付物：`dist/Apollo11LunarLanding.exe`（单文件，双击即玩）
- 构建：`python tools/build_exe.py`（用 `binaries/python/envs/default` 这个环境）
- 图标：`python tools/make_icon.py`（需要 PIL，用 `envs/videoedit` 的 python）
- 自检：`APOLLO11_HEADLESS=1 python run.py`；游戏内「系统自检」页签
- 前端异常会写入 `%USERPROFILE%/Apollo11Simulator/ui.log`，启动过程写 `startup.log`

## 多语言与教程（新增约定）
- 语言层：`js/09-i18n.js`（DICT zh/en 各 154 条 + `APL.t()` + `applyI18n()`；
  新增 key 必须**两种语言一起加**，bughunt 会报 `词条 zh/en = N/N` 校验）
- HTML 用 `data-i18n="key"` 标记；任务/时序英文放 `MISSION_EN`，用
  `APL.missionText()` / `APL.tlText()` 取，**不要**往 00-constants.js 的字面量里注入
- **切语言必须重建所有运行时内容**：任务标题/副标题、推进级列表（清 `dataset.sig`）、
  下传面板、AGC 按钮、任务时序表 —— 漏一个就会出现"半中半英"
- **不要在 bootstrap 里用 textContent 硬编码覆盖带 data-i18n 的按钮**（会顶掉翻译）
- 画布上的文字也要走 `APL.t()`（06-render.js）
- 教程：`js/10-tutorial.js`，两套课程 quick(12) + nav(23)，业务侧用
  `APL.Tutorial.notify('事件名')` 推进；进课程前先出选择卡片
- 支持 `?lang=en|zh` URL 参数强制语言（也用于自动化测试）
- 写一次性补丁脚本必须落成 .py 文件再跑（heredoc 会吃正则反斜杠）
- 全面 bug 检查可用 `tools/bughunt.js`（注入页内跑，含 DOM id 齐全性、
  全按钮点击、五任务遍历、语言往返、教程完整性、异常收集）

## 架构铁律
- Python 只做宿主（pywebview 窗口 + 文件桥），**所有物理/AGC/渲染都在 JS 里**
- JS 文件按 `00-` ~ `10-` 前缀顺序加载，用全局 `APL` 命名空间，不用 ES module
- 新增资源必须同时加进 `tools/build_exe.py` 的 `--add-data`

## 真实数据基准（改动物理参数前先对照）
- 发射 JD 2440419.0639；发射时刻月球黄经 135.404°、月心距 403 922 km
- 静海基地 0.67408°N / 23.47297°E，着陆时太阳高度角 10.3~10.5°
- 停泊轨道 183.2×185.9 km，i=32.521°；TLI Δv≈3.05 km/s，飞行约 73 h
- LOI-1 Δv≈889 m/s；TEI Δv≈997 m/s；全程 195 h 18 min 35 s

## 自动演示（11-demo.js）的硬约束
- 每个任务卡片上【开始任务】**下面**是【自动演示】按钮；演示横幅 `#demoBar`。
- **`App` 必须导出**演示要用的接口（`execTLI/undockLM/dockCraft/switchCraft/
  runCalculator/logLine/finishMission`）—— 缺一个就是静默空转，不报错。
- 步骤切换后要**立刻再跑一次 `driveGuides(dt)`**，否则新步骤第一帧会用上一步的
  残余油门/姿态（高倍率下一帧等于几十秒的全推力乱飞）。
- 任何"等待窗口/相位"的判据都要保证**一定能满足**，否则就是纯超时。
- 月球动力下降用 `P.descentGuidance(world, craft, opt)`（P63→P64→P66 三段式）；
  环月轨道面用 `P.planeChangeToSite()`；场景构造用 `P.orbitOverSite()` /
  `M.raanForInclination()` / `M.raanCandidates()`。
- 端到端验证：`tools/make_demo_probe.js` → 无头 Edge `--virtual-time-budget`
  `--dump-dom` → 抓 `<pre id="probeout">`（**别写 `#diagout`**，会被页面自检覆写）。
  headless Edge 的 virtual-time 其实**会**驱动 rAF（实测 20 帧内 11 次请求），
  但探针仍要自己在 setInterval 里调 `world.advance(1/60)` + `Demo.tick(simDt)`
  才能精确控制步长。
- **倍率是玩家和演示共享的状态**：演示每步要倍率走 `app().setWarpValue(v, true)`，
  绝不能直接 `world().warp = v`（那样档位索引会失配，玩家按 [+] 会掉档）。
  玩家一动倍率 `Demo.noteUserWarp()` 就接管，演示不再覆写；关键阶段
  （4 ≤ st.warp ≤ 1000）上限 = 推荐值 ×2，长滑行段下限 = 推荐值。
- **演示异常中止必须显式报出来**：`Demo.stop` 区分 done/manual/stuck/crash，
  坠毁不写"全部脚本步骤执行完毕"，而是红色横幅 + `DEMO.failMsg` 留 20 秒。
- 触地后必须 `throttleCmd = 0`：着陆后制导继续给油门 → `checkSurface` 判"正在起飞"
  解除 landed → 弹起来再砸（实测 522 m/s 的"着陆后撞击"）。

## 视图（10-12 改版：3D / 2D 两种模式）
- 两个正交的状态：`Renderer.view`（看哪儿：system/earth/moon/craft）+
  `Renderer.mode`（怎么投影：'3d' | '2d'）。视图栏 = 4 个视图按钮 +
  `#btnMode3d/#btnMode2d` 模式开关（琥珀色 .mode.on）+ 预演开关。
- **2D 模式**（用户要的"垂直于轨道水平面 90° 上方"的俯视）：实现在
  `Renderer.prototype.apply2D(world, hero, heroPos, moonPos)` ——
  `ez = unit(r × v)`、`ex` = 近拱点方向（e>0.02）否则升交点方向、`ey = ez × ex`；
  `cam.center` = 主天体（跟随视图=飞行器）+ `ex*pan[0] + ey*pan[1]`；
  缩放 = clamp(远拱点×1.12, 当前半径×1.15, 当前半径×3)，craft 视图再夹 1.4×。
  参考线 `drawPolarGuides` 画轨道面两主轴 + 标签（`cam.polarAxis` = apse/node）。
- ⚠️ **相机状态泄漏**：`apply2D` 会设 `cam.customBasis`（`Camera.basis()` 优先返回它），
  而其它视图**必须每帧清掉** —— 漏了就会让 3D 视图继续用"锁定轨道面"的基向量，
  拖拽彻底失效，表现为"3D 全变成 2D 了"（用户报过这个 bug）。
  `updateCamera` 开头 `if (!is2d) { cam.customBasis = null; cam.polarAxis = null; }`。
- 拖拽判据必须用 `renderer.mode === '2d'`（2D=平移），不能用 view 名。
- 轨道预演：`world.showPrediction` 开关 + `App.updatePrediction()` 分帧算
  `world.predict()`（完整引力 RK4，可传 state 续算），结果挂 `world.predTraj`。
  重算条件 = 点火 / 走掉 35% / 10 s；**别用"位置变了 1%"**（高倍率下疯狂重置）。
- **星球绘制**：实色整圆 + clip 内的朝阳面亮部（渐变终点用透明，**不是背景色**，
  否则整圈边缘化进背景 = 虚边光斑）+ 临边暗边 + 收紧的大气环。
- ⚠️ **画布半径/线宽一律先夹再算**：`ctx.arc` 收到负半径会抛 `IndexSizeError`
  且**直接打死 rAF 主循环**（页面只剩上一帧，无头日志里只显示 "Script error."）。
  排查要用 `--enable-logging=stderr --log-level=0` 才看得到真实报错。
- 探针取相机快照必须放在 `renderer.draw()` **之后**（基向量在 updateCamera 里设），
  否则读到的是上一帧的值，会得出相反结论。
- 删函数必须同步删导出 —— `node --check` 查不出悬空引用，要 `vm.runInContext` 真加载。

## 第 16 轮起的重大变更（物理修复 + 演示改回放）
- **自动演示 = 离线轨迹回放**：`js/12-replay.js`（播放器，只插值不积分）
  + `tools/make_replay_probe.js`（离线生成，`DEMO.noAssist=1` 禁用全部兜底）
  + `tools/save_replay.js`（提取 + 闸门，不达标退出码 2）+ `webdata/traj/*.json`。
  【自动演示】按钮只启动回放；手动飞行仍走实时物理，两者靠 `App.mode` 区分，
  顶栏 `#modeBadge` + `#replayBar` + 日志三处标识。
- **`App.driverExternal`**：外部固定步长驱动（生成器/回放）接管时，主循环
  不再 advance / 不再 Demo.tick / 不驱动制导 —— 双重驱动会破坏生成确定性。
- **回放状态必须是样本的纯函数**：每次 apply 要按样本**重建 craft.modules**
  （被抛弃的级必须真正移除），否则同一 t 的结果会依赖拖动历史。
- **P0 物理三修**（见《实现报告-物理修复与轨迹回放.md》）：
  月球引力间接项（地心系自洽判据 r=0 处月球项 ≈0）、月球 J2 用 p=r−r_m、
  再入主伞 CdA=1064 m²（溅落 9 m/s）、太阳速度中心差分（h=3600 s）。
- **地球入轨制导**：目标是"目标轨道状态"（切向 √(μ/r_t) + 径向 PD），
  关机判据是"状态误差"（Δr/30, v_rad, Δv_tan）。**关机半径就是近地点**。
  实测 184.0×184.9 km / i=32.554°。
- 新验证工具：`tools/test_physics_p0.js`（16 项）、`tools/make_replayaudit_probe.js`
  （播放期零积分 / 逐值一致 / 拖动 / 退出）。探针跑回放要加
  `--allow-file-access-from-files`（file:// 下 fetch 被拦）。
