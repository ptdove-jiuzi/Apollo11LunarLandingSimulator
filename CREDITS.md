# 参考资料与致谢 · References & Credits

**简体中文** | [English](#english)

本项目的**全部源码（前端 JS / HTML / CSS、Python 宿主、构建与验证脚本）均为自行实现**，
没有复制任何第三方项目的代码。以下公开资料在设计、行为与数据上被用作对照基准，
在此明确致谢。

---

## 一、直接对照的两个开源仓库

### 1. [chrislgarry/apollo-11](https://github.com/chrislgarry/apollo-11)

- **是什么**：Apollo 11 任务实际使用的 AGC（阿波罗制导计算机）原始汇编源码 ——
  指令舱程序 **Comanche055** 与登月舱程序 **Luminary099**（含大量逐行注释的扫描整理版）。
- **本项目如何使用**：
  - AGC 复刻（`src/apollo11/webdata/js/04-agc.js`）的**指令集与编码约定**、
    存储器的分页/可擦页切换、EXTEND 扩展指令、通道号（DSKY 显示 021–026、键盘锁存 013、
    灯 027 等）、键盘中断与 DSKY 行为，均与该源码对照实现；
  - 内置示例程序的写法（`src/apollo11/webdata/programs/`）参照其汇编风格。
- **许可说明**：AGC 源码是美国政府的作品（NASA 出品），属于**公有领域**。
  本项目**未复制**其源码（我们的 AGC 是独立实现的模拟器与汇编器，位域还做了规范化，
  见 README"已知限制"第 3 条）。

### 2. [virtualagc/virtualagc](https://github.com/virtualagc/virtualagc)

- **是什么**：社区维护的 AGC 模拟器与配套文档（含 yaAGC、yaDSKY、转储工具与大量说明文档），
  是"真实 AGC 行为"最权威的现代对照物。
- **本项目如何使用**：作为**行为对照基准** —— 例如 DSKY 键入是否即时上屏、OPR ERR 何时点亮、
  键盘中断如何锁存、通道读写的副作用等，都以此项目的文档与行为为参照。
- **许可说明**：该项目以 **GPL-3.0** 发布。本项目**没有复制它的任何代码**：
  AGC 复刻是我们的独立实现（自写的 CPU 解释器、通道 I/O 与 DSKY 状态机），
  因此本仓库不构成该项目的衍生作品，可以按 MIT 许可发布。
  如果你要在本项目中复用 virtualagc 的代码，请注意那部分将受 GPL-3.0 约束。

---

## 二、公开数据与文献

| 来源 | 用途 |
|---|---|
| **Apollo 11 Mission Report**（NASA, 1970） | 任务时序、各次点火的时间/Δv、着陆点坐标、溅落点 |
| **Apollo 11 Flight Journal**（NASA History Office） | 逐分钟任务时间轴、各阶段状态（本项目任务时序表的依据） |
| **Saturn V SA-506 总体参数**（NASA） | 各级质量、推力、比冲（本项目 `00-constants.js` 中的全部火箭参数） |
| **Meeus, _Astronomical Algorithms_（第 2 版）** | 月球历表级数（黄经/黄纬/距离的主要摄动项）、月球自转与天平动的实现依据 |
| **IAU 月球自转模型（IAU2000/2006 简化式）** | 月固系到惯性系的转换（着陆点光照、月面上升方向） |

以上 NASA 文献均为美国政府作品（公有领域）。

---

## 三、构建与运行用到的第三方软件

这些是本项目**运行/打包时**用到的通用工具，不是本仓库的源码组成部分：

| 软件 | 用途 | 许可 |
|---|---|---|
| [Python](https://www.python.org/) | 宿主脚本（**源码运行零依赖**：仅用标准库） | PSF License |
| [PyInstaller](https://pyinstaller.org/) | 把宿主打包成单文件 EXE | GPL-2.0 **附打包例外条款**（允许分发打包产物） |
| [pywebview](https://pywebview.flowrl.com/) | 可选：原生窗口模式（浏览器模式不需要） | BSD-3-Clause |
| Microsoft Edge / Chrome / Firefox | 作为渲染与界面宿主（浏览器模式） | 各自许可 |

> 本项目的**前端没有任何第三方库**：没有 jQuery、没有图表库、没有外部字体或 CDN 请求，
> 所有界面、渲染与图表都是自写代码。

---

<a id="english"></a>

# References & Credits (English)

**All source code in this repository is an original implementation** — nothing was copied from
third-party projects. The following public materials were used as behavioural references and
data sources, and are gratefully acknowledged.

### 1. [chrislgarry/apollo-11](https://github.com/chrislgarry/apollo-11)

The original Apollo 11 AGC assembly source (Command Module **Comanche055**, Lunar Module
**Luminary099**). Our AGC replica follows its instruction set and encoding conventions,
memory banking, EXTEND instructions, channel numbers (DSKY display 021–026, keyboard latch
013, lamps 027, …), keyboard interrupts and DSKY behaviour; the bundled sample programs
follow its assembly style. The AGC source is a NASA work and therefore in the public domain.
**No source code was copied** — our AGC is an independent emulator/assembler with normalized
bit-fields (see limitation #3 in the README).

### 2. [virtualagc/virtualagc](https://github.com/virtualagc/virtualagc)

The community AGC emulator and documentation, used as the authoritative reference for *real
AGC behaviour* (e.g. immediate DSKY key echo, when OPR ERR lights, how the keyboard interrupt
latches, channel read/write side effects). That project is licensed **GPL-3.0**; **no code was
copied** from it — our AGC replica is independent, so it is not a derivative work and this
repository can be MIT-licensed. If you ever want to reuse code from virtualagc here, that part
would be bound by GPL-3.0.

### 3. Public data and literature

Apollo 11 Mission Report (NASA 1970) and the Apollo 11 Flight Journal for the mission timeline,
burn times/Δv, landing site and splashdown point; Saturn V SA-506 parameters for all rocket
mass/thrust/Isp values; Meeus, *Astronomical Algorithms* for the lunar ephemeris series and
lunar rotation; the IAU lunar rotation model for the Moon-fixed frame. All NASA documents are
US Government works (public domain).

### 4. Build/run-time third-party software

Python (PSF), PyInstaller (GPL-2.0 **with the bundling exception**), pywebview (BSD-3),
and a modern browser as the rendering host. The front-end itself has **no third-party
libraries and makes no external requests**.
