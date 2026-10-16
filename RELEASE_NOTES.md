# Apollo 11 Lunar Landing Simulator v1.0.0

**简体中文** · [English below](#english)

## 这是什么

一个从零手写的**阿波罗 11 号全流程模拟器**：全真实物理（RK4 实时积分 + 地球 J2 + 月球间接项/
月球 J2 + 太阳摄动 + Meeus 月球历表 + IAU 月球自转），完整走完
「起飞 → 地月转移 → 环月 → 着陆 → 月面上升 → 交会对接 → 返回 → 溅落」，
并内置**可编程的 AGC（阿波罗制导计算机）Block II 复刻**与 DSKY 面板。

## 下载

- **Windows 免安装单文件**：`Apollo11LunarLanding.exe`（8.7 MB，双击即玩）
- 源码运行（零依赖）：`python src/run.py`
- 自己打包：`build.bat`

## 这一版的还原度（都是实测值）

| 项目 | 真实 Apollo 11 | 本模拟器 |
|---|---|---|
| 地球停泊轨道 | 183.2 × 185.9 km，i=32.521° | 181.5 × 187.8 km，i=32.558° |
| LOI-1 | 111 × 315 km，Δv 889 m/s | 111 × 314 km，**Δv 863 m/s** |
| LOI-2 | 111 × 117 km，Δv 59 m/s | 111 × 116 km，Δv 42 m/s |
| 动力下降着陆 | 静海基地 0.674°N / 23.473°E | **偏差 134 m** |
| TEI | Δv ≈ 997 m/s | **906 m/s**（燃烧 166 s / 4.90 t） |
| 任务总时长 | 195 h 18 min 35 s | 溅落成功（弹道偏陡，溅落点未命中真实海区） |

## 主要内容

- **五个任务**：01 飞船起飞 / 02 地月轨道转移 / 03 月球对接 / 04 飞船降落 / 05 全流程模拟；
  每个任务都有【自动演示】（离线轨迹回放）与【手动飞行】。
- **互动教程**三套（快速上手 12 步 / 导航系统 24 步 / 五个任务通关 36 步）。
- **AGC + DSKY**：可写 AGC 汇编驱动 DSKY；键盘键入即时上屏。
- **中英双语**界面，零外部依赖、纯离线。

## 已知限制（如实说明）

1. 全流程任务（05）的交会起手位姿与返回滑行段使用了**演示摆位辅助**（其余各段为真实物理）。
2. 溅落点未命中真实溅落区（13.3°N / 169.2°W）。
3. AGC 位域做了规范化，**机器码与真机不二进制兼容**。
4. 星球与飞行器为程序化绘制的示意图。

## 参考与致谢

全部源码均自行实现；设计与行为上参考了
[chrislgarry/apollo-11](https://github.com/chrislgarry/apollo-11)（AGC 原始汇编源码）、
[virtualagc/virtualagc](https://github.com/virtualagc/virtualagc)（AGC 模拟器与文档）
与 NASA 公开资料（Mission Report / Flight Journal / SA-506 参数）。详见 `CREDITS.md`。

## 许可

MIT。详细开发记录（每一轮的实测数据、失败原因与修法）见 `docs/devlog/` 与 `docs/AGENT_HANDOFF/`。

---

<a id="english"></a>

# English

A **from-scratch** Apollo 11 full-mission simulator: real physics integrated in real time
(RK4 with Earth J2, the lunar indirect term and lunar J2, solar perturbations, a Meeus lunar
ephemeris and IAU lunar rotation), covering the whole profile — liftoff → trans-lunar
injection → lunar orbit → landing → lunar ascent → rendezvous & docking → return → splashdown —
with a **programmable Apollo Guidance Computer (Block II)** replica and its DSKY.

## Download

- **Windows single-file, no install**: `Apollo11LunarLanding.exe` (8.7 MB, double-click to play)
- From source (zero dependencies): `python src/run.py`
- Build your own: `build.bat`

## Fidelity in this release (measured)

| Item | Real Apollo 11 | This simulator |
|---|---|---|
| Parking orbit | 183.2 × 185.9 km, i = 32.521° | 181.5 × 187.8 km, i = 32.558° |
| LOI-1 | 111 × 315 km, Δv 889 m/s | 111 × 314 km, **863 m/s** |
| LOI-2 | 111 × 117 km, Δv 59 m/s | 111 × 116 km, 42 m/s |
| Powered descent | Tranquility Base 0.674°N / 23.473°E | **134 m off** |
| TEI | Δv ≈ 997 m/s | **906 m/s** (166 s burn / 4.90 t) |
| Total mission | 195 h 18 min 35 s | splashdown achieved (steep return; splash point off) |

## Highlights

- **Five missions** (01 Liftoff / 02 Trans-lunar transfer / 03 Lunar docking / 04 Landing /
  05 Full mission), each with an auto-demo (offline trajectory replay) and manual flight.
- **Three interactive tutorials** (quick start 12 steps / navigation 24 / all missions 36).
- **AGC + DSKY**: write AGC assembly to drive the DSKY; keystrokes echo immediately.
- Bilingual UI (Chinese / English), fully offline, zero external dependencies.

## Known limitations

1. The full-mission (05) demo uses placement assists for the rendezvous start pose and the
   return coast (all other phases are real physics).
2. The splashdown point does not match the real one (13.3°N / 169.2°W).
3. AGC bit-fields are normalized: machine code is **not binary-compatible** with the real AGC.
4. Planets and spacecraft are procedurally drawn, not photoreal.

## Credits

All code is original. Design and behaviour reference
[chrislgarry/apollo-11](https://github.com/chrislgarry/apollo-11) (the original AGC assembly
source), [virtualagc/virtualagc](https://github.com/virtualagc/virtualagc) (AGC emulator and
docs) and NASA public documents (Mission Report / Flight Journal / SA-506 parameters).
See `CREDITS.md` for details.

## License

MIT. The full engineering log (per-round measurements, failure analyses and fixes) is in
`docs/devlog/` and `docs/AGENT_HANDOFF/`.
