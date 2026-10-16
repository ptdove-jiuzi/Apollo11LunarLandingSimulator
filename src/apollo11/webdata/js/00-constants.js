/* =========================================================================
 *  00-constants.js  —  真实物理常数 / 航天器参数 / Apollo 11 任务时间轴
 *  数据来源：NASA Apollo 11 Mission Report、Saturn V SA-506 载荷清单、
 *            AGC4 基础指令集手册、JPL 行星历表长期项。
 *  ========================================================================= */
(function (global) {
  'use strict';

  var APL = global.APL || (global.APL = {});

  // ---------------------------------------------------------------- 数学常量
  var C = {
    G0: 9.80665,              // 标准重力加速度 m/s^2
    AU: 149597870.7,          // 天文单位 km
    DEG: Math.PI / 180,
    RAD: 180 / Math.PI,
    DAY: 86400,               // s
    KFT: 0.3048,              // 千英尺 -> km 的换算因子(乘完再除 1000)
    FT: 0.0003048,            // 英尺 -> km
    NMI: 1.852,               // 海里 -> km
    SM: 1.609344              // 英里 -> km
  };

  // ---------------------------------------------------------------- 天体
  var BODY = {
    EARTH: {
      key: 'EARTH', name: '地球', nameEn: 'Earth',
      mu: 398600.4418,          // km^3/s^2
      radius: 6378.137,         // km, 赤道半径
      flattening: 1 / 298.257223563,
      J2: 1.08262668e-3,
      siderealDay: 86164.0905,  // s
      omega: 7.292115e-5,       // rad/s 自转
      atmTop: 900,              // km 大气顶(简化)
      rho0: 1.225e-9,           // kg/km^3 (海平面 1.225 kg/m^3 = 1.225e-9 kg/km^3)
      H: 8.5,                   // km 标高
      soi: 924000,              // km 相对月球的引力影响球
      color: '#3d7bd6',
      color2: '#1b3f78'
    },
    MOON: {
      key: 'MOON', name: '月球', nameEn: 'Moon',
      mu: 4902.800118,          // km^3/s^2
      radius: 1737.4,
      flattening: 0.0012,
      J2: 2.0330e-4,
      siderealDay: 2360591.5,   // s (27.321661 d 同步自转)
      soi: 66183,               // km  月球相对地球的引力影响球半径
      color: '#c9c6bf',
      color2: '#6d6a64'
    },
    SUN: {
      key: 'SUN', name: '太阳', nameEn: 'Sun',
      mu: 1.32712440018e11,
      radius: 695700,
      color: '#ffd479'
    }
  };

  // ------------------------------------------------- 月球轨道根数(J2000, 相对黄道)
  var MOON_ORBIT = {
    a: 384399,                  // km 平均半长轴
    e: 0.0549006,
    i: 5.145,                   // deg, 相对黄道
    omegaBar: 186.01,           // deg 近日点(近地点)幅角基准
    Omega0: 125.04452,          // deg 升交点赤经(J2000)
    OmegaDot: -0.0529539,       // deg/day 交点退行
    L0: 218.3165,               // deg 平黄经(J2000)
    LDot: 13.176396,            // deg/day 平运动
    eclipticTilt: 23.4392911    // deg 黄赤交角
  };

  // ------------------------------------------------------- 地球大气(简化 ISA)
  var ATM = [
    { h: 0, T: 288.15, p: 101325 }, { h: 11000, T: 216.65, p: 22632 },
    { h: 20000, T: 216.65, p: 5474.9 }, { h: 32000, T: 228.65, p: 868.02 },
    { h: 47000, T: 270.65, p: 110.91 }, { h: 51000, T: 270.65, p: 66.939 },
    { h: 71000, T: 214.65, p: 3.9564 }, { h: 84852, T: 186.87, p: 0.3734 }
  ];

  // =============================================================== 航天器
  // 土星五号 SA-506 三级 + 有效载荷（Apollo 11 实飞数据）
  var SATURN_V = {
    name: 'Saturn V (SA-506)',
    launchMass: 2970000,        // kg 全箭起飞质量
    lengthM: 110.6,
    stages: [
      {
        id: 'S-IC', name: 'S-IC 第一级',
        dry: 137000, prop: 2150000,   // kg
        thrustSL: 34.02e6, thrustVac: 38.5e6, // N
        ispSL: 263, ispVac: 304,
        engines: 5, burnTime: 168, minThrottle: 1.0,
        jettison: true
      },
      {
        id: 'S-II', name: 'S-II 第二级',
        dry: 43000, prop: 456000,
        thrustSL: 0, thrustVac: 5.0e6,
        ispSL: 0, ispVac: 424,
        engines: 5, burnTime: 384, minThrottle: 0.4,
        jettison: true
      },
      {
        id: 'S-IVB', name: 'S-IVB 第三级',
        dry: 15200, prop: 106400,
        thrustSL: 0, thrustVac: 1.0e6,
        ispSL: 0, ispVac: 424,
        engines: 1, burnTime: 165, minThrottle: 1.0,
        jettison: false, restarts: 1
      }
    ]
  };

  // 指令服务舱 CSM-107 "Columbia"
  var CSM = {
    id: 'CSM', name: 'Columbia 指令服务舱',
    dry: 11120,                 // kg 不含推进剂
    // kg SPS 推进剂（真实 18 410）。差额是**本模拟器有限推力模型自己的代价**，
    // 逐项实测：LOI Δv 1 059 m/s（真实 LOI-1 888）耗 17 600 kg —— 理想脉冲只要
    // 13 670 kg，多出的 29% 是 600 s 有限点火在月球重力场里的重力损耗
    // （g·T 约 600 s × 0.9 m/s² = 545 m/s，实收 377 m/s，比例合理）；
    // LOI-2 78 m/s → 730 kg；TEI 需要约 2 400 kg（CSM 单独 930 m/s）。
    // 合计 20 730 kg。用 20 000 的油箱实测在 TEI 只剩 1 648 kg，点不着火，
    // 只能去偷登月舱上升级的推进剂。21 500 留约 770 kg 余量。
    // （真实任务也极其紧张：18 410 kg 里 LOI 11 378 + LOI-2 646 + TEI 6 245。）
    // kg SPS 推进剂。真实值是 18 410，这里定到 24 000 —— 差额全部来自
    // **本模拟器有限推力模型自己的重力损耗**，逐项实测（M5 全程一次完整飞行）：
    //   · LOI   Δv 1 066 m/s，在 653 km 高度点火，燃烧 595 s；
    //           理想脉冲只需 13 829 kg，实测耗 18 455 kg —— 多出的 33% 是
    //           595 s × 0.86 m/s² ≈ 511 m/s 的月面重力冲量里实收的 370 m/s。
    //           制导目标是"固定椭圆（近月点 150 km、远月点 = 点火半径）在当前
    //           位置的完整速度矢量"，因此它必须**主动抵消重力造成的径向速度**，
    //           这部分 Δv 完全花在"维持目标椭圆"上，不产生任何轨道收益。
    //   · LOI-2 91 m/s → 900 kg（真实 59 m/s）。
    //   · TEI   930 m/s，CSM 单独（11 120 kg 干重）需要 3 921 kg。
    // 合计 23 276 kg，24 000 留 700 kg 余量。
    // 参考：真实阿波罗 11 号的 SPS 只有 18 410 kg，分解为
    // LOI-1 11 378 + LOI-2 646 + TEI 6 245 —— 它的 LOI-1 只要 888 m/s、
    // 而且是在 111 km 的近月点点火，本模拟器两者都做不到（到达 v∞ 0.993 km/s
    // 偏高、捕获高度 653 km 偏高），所以必须多带推进剂才能完成同一条链路。
    propMass: 18410,            // kg SPS（真实 Apollo 11 值，路线 08 §4）。
    // 第 21 轮恢复：之前放大的 24000 kg 在 TLI 时是 5.6 t 死重，直接吃掉 ~196 m/s
    // 的 S-IVB 地月转移能力（M5 因此差 83 m/s 过不去）。后段预算实测只需要
    // ~13.4 t（LOI-1 ~876 + LOI-2 ~59 + TEI ~997 m/s，按 28.7 t 的 CSM 折算），
    // 18 410 kg 富余充足。旧结论"恢复真实值会让 M2 的 TLI 打靶发散"（HANDOFF/10 §3）
    // 是在当时 v∞/面闸门/修正预算都不同的配置下测的，本轮已在 LOI-1 能量验收
    // 的新配置下重测 M1~M5 全量回归。
    rcsPropMass: 620,           // kg RCS
    thrust: 91190,              // N SPS（真实值，原来写 91.2 kN）
    isp: 314.5,                 // s（真实值）
    rcsThrust: 445,             // N 每个喷口
    rcsIsp: 290,
    rcsCount: 16,
    massTotal: 30320
  };

  // 登月舱 LM-5 "Eagle"
  var LM = {
    id: 'LM', name: 'Eagle 登月舱',
    descentDry: 2134,
    descentProp: 8200,
    descentThrustMax: 45.04e3,  // N DPS 最大推力
    descentThrottleMin: 0.10,
    descentIsp: 311,
    ascentDry: 2152,
    // 真实 2 353 kg。本模拟器要比真实值多留推进剂，原因是可量化的：
    //  · 本模拟器的上升制导（受控爬升率 + 根数关机）比真实 AGS 粗糙，
    //    重力/操纵损失大 ~350 m/s；
    //  · 实测：从月面烧到"15 × 138 km 的插入轨道"要烧掉 ~2 000 m/s（≈2 350 kg），
    //    而 2 700 kg 只剩 ~250 kg（≈150 m/s）—— 交会三段
    //    （匹配轨道 ~50 m/s + 相位 ~150 m/s + TPI/收拢 ~100 m/s）根本不够，
    //    M5 的上升级就是在相位段把油烧光、永远收不到 150 m。
    // 3 000 kg = 2 740 m/s：实测上升段"爬到插入轨道"要烧掉 ~2 350 kg，
    // 只剩 ~350 kg（≈230 m/s），而交会三段要 ~390 m/s —— 正好差一口气，
    // 上升级会在相位段把油烧光。多这 300 kg 刚好把交会包住。
    ascentProp: 3000,     // 上升级推进剂。真实值 2353（路线 08 §4）；当前放大值
                          // 与 SPS 同步保留，原因同上（见 HANDOFF/10 §3）。
                          // 这个重量要跟着一起降落，
                          // 不能再大了，否则下降级 8 200 kg 不够用、M4 会摔）
    ascentThrust: 16.0e3,       // N APS（真实值 16 kN，原来写 15.57 kN）
    ascentIsp: 311,
    rcsThrust: 445, rcsIsp: 290, rcsCount: 16,
    massTotal: 15097
  };

  // 发射场  39 号发射台 A
  var SITE = {
    name: 'LC-39A, Kennedy Space Center',
    lat: 28.5729,               // deg N
    lon: -80.6490,              // deg E
    azimuth: 72.03,             // deg 发射方位角(Apollo 11 实飞记录值)
    // 制导用方位角：通过旋转地球模型反解，使停泊轨道倾角与实飞 32.521° 一致
    // （直接用 72.03° 因本模拟对自转/发射窗口的简化会得到约 31.5°）
    azimuthGuidance: 69.4,
    parkingPerigee: 183.2,      // km
    parkingApogee: 185.9,       // km
    parkingInclination: 32.521  // deg
  };

  // 着陆点  静海基地
  var LANDING_SITE = {
    name: '静海基地 (Mare Tranquillitatis)',
    lat: 0.67408, lon: 23.47297, alt: -0.0
  };

  // ======================================================= Apollo 11 时序
  // GET = Ground Elapsed Time（自点火起飞的秒数）
  var TIMELINE = [
    { t: 0,       tag: 'LIFTOFF',    cn: '土星五号点火升空',            detail: 'LC-39A 起飞，72.03° 方位角，S-IC 五台 F-1 发动机全推力', cnEn: "Saturn V liftoff", detailEn: "Pad 39A, azimuth 72.03 deg, five S-IC F-1 engines at full thrust" },
    { t: 12,      tag: 'PITCHOVER',  cn: '俯仰 / 滚转程序转弯',          detail: '开始按程序转弯，重力转弯段', cnEn: "Pitch and roll program", detailEn: "Programmed pitch-over begins, gravity-turn phase" },
    { t: 85,      tag: 'MAXQ',       cn: '最大动压 Max-Q',              detail: '动压峰值约 34 kPa', cnEn: "Maximum dynamic pressure", detailEn: "Peak dynamic pressure about 34 kPa" },
    { t: 135,     tag: 'INCUT',      cn: 'S-IC 中央发动机关机',          detail: '减轻过载', cnEn: "S-IC centre engine cutoff", detailEn: "To limit acceleration loads" },
    { t: 161,     tag: 'OUTCUT',     cn: 'S-IC 外围四台关机 + 一级分离',  detail: '高度约 67 km，速度约 2.76 km/s', cnEn: "S-IC outboard cutoff, stage separation", detailEn: "About 67 km, 2.76 km/s" },
    { t: 164,     tag: 'SIICUT',     cn: 'S-II 点火',                   detail: '5 台 J-2，计划燃烧 384 s', cnEn: "S-II ignition", detailEn: "Five J-2 engines, 384 s planned burn" },
    { t: 548,     tag: 'SII_SEP',    cn: 'S-II 关机 / 二级分离',         detail: '高度约 185 km，速度约 6.9 km/s', cnEn: "S-II cutoff and separation", detailEn: "About 185 km, roughly 6.9 km/s" },
    { t: 551,     tag: 'SIVB1',      cn: 'S-IVB 第一次点火',            detail: '进入地球停泊轨道', cnEn: "S-IVB first burn", detailEn: "Inserting into the Earth parking orbit" },
    { t: 700,     tag: 'EOI',        cn: '入轨完成 (Earth Orbit Insertion)', detail: '轨道 183.2 × 185.9 km，倾角 32.521°', cnEn: "Earth Orbit Insertion complete", detailEn: "Orbit 183.2 x 185.9 km, inclination 32.521 deg" },
    { t: 9861,    tag: 'TLI',        cn: '地月转移轨道注入 TLI',         detail: 'S-IVB 二次点火，Δv ≈ 3.05 km/s，燃烧约 347 s', cnEn: "Trans-Lunar Injection (TLI)", detailEn: "S-IVB restart, dv 3.05 km/s, about 347 s burn" },
    { t: 11922,   tag: 'CSM_SEP',    cn: '指令舱与 S-IVB 分离',          detail: 'CSM 掉头准备与登月舱对接', cnEn: "CSM separates from S-IVB", detailEn: "CSM turns around for docking" },
    { t: 12360,   tag: 'DOCK',       cn: '指令舱 / 登月舱对接完成',       detail: 'Columbia 与 Eagle 完成刚性连接(首次对接)', cnEn: "CSM / LM docking complete", detailEn: "Columbia and Eagle rigidly mated (first docking)" },
    { t: 14160,   tag: 'EXTRACT',    cn: '登月舱从 S-IVB 中拉出',         detail: 'S-IVB 随后被抛入日心轨道', cnEn: "LM extracted from S-IVB", detailEn: "The S-IVB is then sent to a heliocentric orbit" },
    { t: 96240,   tag: 'MCC2',       cn: '第二次中途修正 MCC-2',         detail: '微调轨道使落点精确', cnEn: "Midcourse correction MCC-2", detailEn: "Fine tuning of the trajectory" },
    { t: 272990,  tag: 'LOI1',       cn: '月球轨道插入 LOI-1',           detail: 'SPS 点火 357.5 s，Δv ≈ 889 m/s，进入 111×315 km 环月轨道', cnEn: "Lunar Orbit Insertion LOI-1", detailEn: "SPS burn 357.5 s, dv 889 m/s, into 111 x 315 km" },
    { t: 288701,  tag: 'LOI2',       cn: '月球轨道圆化 LOI-2',           detail: 'SPS 点火 17 s，Δv ≈ 59 m/s，轨道 111×117 km', cnEn: "Lunar orbit circularization LOI-2", detailEn: "SPS burn 17 s, dv 59 m/s, orbit 111 x 117 km" },
    { t: 360783,  tag: 'UNDOCK',     cn: '登月舱解锁分离',               detail: 'Eagle 与 Columbia 分离', cnEn: "LM undocking", detailEn: "Eagle separates from Columbia" },
    { t: 360895,  tag: 'SEP_BURN',   cn: 'LM 分离机动',                  detail: '手动 RCS 使两器间距缓慢增大', cnEn: "LM separation burn", detailEn: "Manual RCS to open the gap slowly" },
    { t: 362392,  tag: 'PDI',        cn: '动力下降开始 PDI',             detail: '高度约 15.2 km，DPS 点火，制动段', cnEn: "Powered Descent Initiation (PDI)", detailEn: "About 15.2 km altitude, DPS ignition, braking phase" },
    { t: 362900,  tag: 'BRAKING',    cn: '制动段结束 / 俯仰调整',         detail: '高度约 2.4 km', cnEn: "Braking phase ends, pitch-over", detailEn: "About 2.4 km altitude" },
    { t: 363980,  tag: 'P64',        cn: '接近段 P64',                   detail: '高度约 150 m，着陆雷达锁定', cnEn: "Approach phase P64", detailEn: "About 150 m, landing radar locked on" },
    { t: 364340,  tag: 'P66',        cn: '最终下降 P66 手动',            detail: '阿姆斯特朗接管，寻找平坦着陆区', cnEn: "Final descent P66 (manual)", detailEn: "Armstrong takes over, looking for a smooth spot" },
    { t: 364540,  tag: 'CONTACT',    cn: '接触灯亮 (Contact Light)',      detail: '探针触地', cnEn: "Contact light", detailEn: "Probes touch the surface" },
    { t: 364543,  tag: 'TOUCHDOWN',  cn: '登月舱着陆',                   detail: '静海基地 0.674°N / 23.473°E，垂直速度 0.7 m/s', cnEn: "Lunar module landed", detailEn: "Tranquility Base 0.674N / 23.473E, 0.7 m/s vertical" },
    { t: 384453,  tag: 'EVA_START',  cn: '月面活动 EVA 开始',            detail: '舱门开启，阿姆斯特朗下梯', cnEn: "EVA begins", detailEn: "Hatch open, Armstrong on the ladder" },
    { t: 385145,  tag: 'FIRST_STEP', cn: '人类第一步踏上月球',           detail: '"这是个人的一小步，却是人类的一大步"', cnEn: "First human step on the Moon", detailEn: "That is one small step for man ..." },
    { t: 396840,  tag: 'EVA_END',    cn: 'EVA 结束返回舱内',             detail: '月面停留 2 h 31 min，采集 21.55 kg 月样', cnEn: "EVA ends, crew back inside", detailEn: "2 h 31 min on the surface, 21.55 kg of samples" },
    { t: 446520,  tag: 'AS_START',   cn: '上升级点火升空',               detail: 'APS 点火 3 min 52 s，Δv ≈ 1.86 km/s', cnEn: "LM ascent stage liftoff", detailEn: "APS burn 3 min 52 s, dv 1.86 km/s" },
    { t: 460991,  tag: 'REDOCK',     cn: '登月舱与指令舱再次对接',        detail: '第 4 次对接，完成交会', cnEn: "LM docks with the CSM again", detailEn: "Fourth docking, rendezvous complete" },
    { t: 473371,  tag: 'JETTISON',   cn: '抛弃上升级',                   detail: 'Eagle 上升级被释放入环月轨道', cnEn: "Ascent stage jettisoned", detailEn: "Eagle released into lunar orbit" },
    { t: 487422,  tag: 'TEI',        cn: '返回地球轨道注入 TEI',          detail: 'SPS 点火约 151 s，Δv ≈ 997 m/s', cnEn: "Trans-Earth Injection (TEI)", detailEn: "SPS burn about 151 s, dv 997 m/s" },
    { t: 703115,  tag: 'SPLASHDOWN', cn: '溅落太平洋',                   detail: '13°19′N 169°09′W，任务全程 195 h 18 min 35 s', cnEn: "Splashdown in the Pacific", detailEn: "13d19'N 169d09'W, total mission 195 h 18 min 35 s" }
  ];

  // ============================================== 五个预设任务(关卡)
  var MISSIONS = [
    {
      id: 'M1', code: '01', name: '飞船起飞',
      subtitle: 'Launch & Earth Orbit Insertion',
      brief: '从肯尼迪航天中心 LC-39A 点火起飞，按真实的俯仰程序转弯，' +
             '分级点火，把飞船送入 183.2 × 185.9 km、倾角 32.521° 的地球停泊轨道。',
      need: ['达到 80 km 以上高度', '近地点 ≥ 180 km', '远地点 ≤ 195 km', '速度 ≥ 7.7 km/s', '偏心率 < 0.001'],
      phases: ['点火', '最大动压', '一级分离', '二级分离', '入轨'],
      startState: 'prelaunch',
      objectives: ['orbit'],
      getStart: 0, getEnd: 900
    },
    {
      id: 'M2', code: '02', name: '地月轨道转移',
      subtitle: 'Trans-Lunar Injection (TLI)',
      brief: '在停泊轨道上寻找正确的点火窗口，执行 TLI 点火，把飞船送上去往月球的自由返回轨道，' +
             '并在 3 天后逼近月球时插入环月轨道。',
      need: ['轨道远地点 ≥ 350,000 km', '与月球最近距离 ≤ 2,000 km', '完成 LOI 后环月近点月高度 ≤ 200 km'],
      phases: ['TLI 点火', '地月转移', '中途修正', '月球轨道插入'],
      startState: 'parking',
      objectives: ['tli', 'loi'],
      getStart: 700, getEnd: 273000
    },
    {
      id: 'M3', code: '03', name: '月球对接',
      subtitle: 'Lunar Orbit Rendezvous & Docking',
      brief: '在环月轨道上释放 Eagle，然后依靠轨道力学再次把它抓住 —— ' +
             '真实任务中这是第 4 次对接，也是回家唯一的路。',
      need: ['LM 分离后最短距离 ≥ 500 m', '再次逼近相对速度 ≤ 1.0 m/s', '对接距离 ≤ 0.15 km', '轨道近点高度 ≥ 100 km'],
      phases: ['分离', '追踪', '接近', '对接'],
      startState: 'lunar_orbit',
      objectives: ['undock', 'rendezvous', 'dock'],
      getStart: 360000, getEnd: 460000
    },
    {
      id: 'M4', code: '04', name: '飞船降落',
      subtitle: 'Powered Descent & Landing',
      brief: '从 111 km 环月轨道实施动力下降，走完制动段、接近段、最终下降段，' +
             '在静海基地安全着陆。燃料只有一次机会。',
      need: ['着陆点距离 ≤ 0.5 km', '接地垂直速度 ≤ 2.0 m/s', '水平速度 ≤ 1.5 m/s', '剩余下降级燃料 ≥ 0'],
      phases: ['PDI', '制动段', '接近段', '最终下降', '着陆'],
      startState: 'lunar_orbit_low',
      objectives: ['landing'],
      getStart: 362000, getEnd: 366000
    },
    {
      id: 'M5', code: '05', name: '全流程模拟',
      subtitle: 'Full Mission Simulation',
      brief: '从点火到溅落，8 天 3 小时 18 分 35 秒的完整 Apollo 11 —— ' +
             '起飞、入轨、TLI、对接、月球着陆、月面活动、上升、再对接、返回。',
      need: ['完成全部 8 个主要节点', '任务时间 ≤ 200 小时'],
      phases: ['起飞', '入轨', 'TLI', '对接', '转移', 'LOI', '着陆', 'EVA', '上升', '返回', '溅落'],
      startState: 'prelaunch',
      objectives: ['orbit', 'tli', 'dock', 'undock', 'landing', 'rendezvous', 'tei', 'splashdown'],
      getStart: 0, getEnd: 703300
    }
  ];

  // ============================================== 时间加速档位
  var WARP = [1, 2, 5, 10, 50, 100, 500, 1000, 5000, 20000, 100000, 300000];

  // ============================================== 显示单位
  var UNITS = {
    dist: { id: 'km', factor: 1, name: '千米' },
    distAlt: { id: 'nmi', factor: 1 / 1.852, name: '海里' },
    vel: { id: 'km/s', factor: 1, name: '千米/秒' }
  };

  APL.C = C;
  APL.BODY = BODY;
  APL.MOON_ORBIT = MOON_ORBIT;
  APL.ATM = ATM;
  APL.SATURN_V = SATURN_V;
  APL.CSM = CSM;
  APL.LM = LM;
  APL.SITE = SITE;
  APL.LANDING_SITE = LANDING_SITE;
  APL.TIMELINE = TIMELINE;
  APL.MISSIONS = MISSIONS;
  APL.WARP = WARP;

})(typeof window !== 'undefined' ? window : globalThis);
