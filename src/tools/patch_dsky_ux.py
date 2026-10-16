# -*- coding: utf-8 -*-
# DSKY 可用性修复（对照 chrislgarry/apollo-11 与 virtualagc 的真机行为）：
#   · 键入状态机：VERB/NOUN/数字/±/CLR/ENTR 立即反映在寄存器上（真 DSKY 行为）；
#   · 运行中的程序一旦写通道 21/22/23（assert 显示），键入状态即被接管；
#   · 空 ENTR → OPR ERR（真机行为）；
#   · 面板内加"用法速查卡"；
#   · NAV 教程在 DSKY 介绍后加动手步骤。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

# ---------------- 04-agc.js ----------------
patch('apollo11/webdata/js/04-agc.js', [
 # 1) 状态字段
 ("""    this.progAlarm = false;
    this.flashOn = false;
  }""",
  """    this.progAlarm = false;
    this.flashOn = false;
    this.entry = null;   // 键入状态机：{ mode:'verb'|'noun'|'r1', digits, sign }
  }"""),
 # 2) 程序写显示通道 → 接管键入状态
 ("""      case 0o21: this.prog = v & 0o77; break;
      case 0o22: this.verb = v & 0o77; break;
      case 0o23: this.noun = v & 0o77; break;""",
  """      case 0o21: this.prog = v & 0o77; this.entry = null; break;   // 程序接管显示
      case 0o22: this.verb = v & 0o77; this.entry = null; break;
      case 0o23: this.noun = v & 0o77; this.entry = null; break;"""),
 # 3) press 的键入状态机
 ("""  DSKY.prototype.press = function (name) {
    var c = KEY_CODES[String(name).toUpperCase()];
    if (c === undefined) return false;
    this.lastKey = String(name).toUpperCase();""",
  """  DSKY.prototype.press = function (name) {
    var k = String(name).toUpperCase();
    var c = KEY_CODES[k];
    if (c === undefined) return false;
    this.lastKey = k;
    // ---- 键入状态机（真 DSKY：按键立即显示在寄存器上）----
    // VERB/NOUN 进入模式；数字填入对应寄存器（保留最后两位/五位）；
    // ENTR 把键入的 VERB/NOUN 提交（写通道并触发中断，交给运行中的程序）；
    // CLR 清除；空 ENTR → OPR ERR（真机行为）。程序写通道会接管键入状态。
    if (k === 'VERB') {
      this.entry = { mode: 'verb', digits: '', sign: ' ' };
    } else if (k === 'NOUN') {
      this.entry = { mode: 'noun', digits: '', sign: ' ' };
    } else if (k === 'CLR') {
      this.entry = null; this.r1 = null;
      this.progAlarm = false; this.lamps['OPR ERR'] = false;
    } else if (k === 'ENTER') {
      if (this.entry && this.entry.mode === 'r1') {
        this.entry = null;                       // R1 键入即时显示，无需提交
      } else if (this.entry && this.entry.digits !== '') {
        var ncommit = parseInt(this.entry.digits, 10) & 0o77;
        if (this.entry.mode === 'verb') this.write(0o21, ncommit);
        else this.write(0o23, ncommit);
        this.entry = null;
      } else {
        this.entry = null;                       // 空 ENTR：无效序列
        this.progAlarm = true;
        this.lamps['OPR ERR'] = true;
        this.lampWord |= 0o0200;
      }
    } else if (/^[0-9]$/.test(k)) {
      if (!this.entry) this.entry = { mode: 'r1', digits: '', sign: ' ' };
      if (this.entry.mode === 'verb' || this.entry.mode === 'noun') {
        this.entry.digits = (this.entry.digits + k).slice(-2);
        var nkey = parseInt(this.entry.digits, 10);
        if (this.entry.mode === 'verb') this.verb = nkey; else this.noun = nkey;
      } else {
        this.entry.digits = (this.entry.digits + k).slice(-5);
        var n1 = parseInt(this.entry.digits, 10) || 0;
        this.r1 = (this.entry.sign === '-' ? (B15 | n1) : n1);
      }
    } else if (k === '+' || k === '-') {
      if (this.entry && this.entry.mode === 'r1') this.entry.sign = (k === '-' ? '-' : '+');
    }"""
 ),
 # 4) display() 的键入视图
 ("""    return {
      prog: two(this.prog), verb: two(this.verb), noun: two(this.noun),
      r1: val(this.r1), r2: val(this.r2), r3: val(this.r3),
      lamps: this.lamps, lampWord: this.lampWord, flash: this.flashOn
    };""",
  """    var out = {
      prog: two(this.prog), verb: two(this.verb), noun: two(this.noun),
      r1: val(this.r1), r2: val(this.r2), r3: val(this.r3),
      lamps: this.lamps, lampWord: this.lampWord, flash: this.flashOn
    };
    if (this.entry) {                            // 键入中：寄存器显示键入内容
      var p2 = function (x) { return ('00' + (x || '')).slice(-2); };
      if (this.entry.mode === 'verb') out.verb = 'V' + p2(this.entry.digits);
      else if (this.entry.mode === 'noun') out.noun = 'N' + p2(this.entry.digits);
      else out.r1 = (this.entry.sign || ' ') +
                    ('00000' + (this.entry.digits || '')).slice(-5);
    }
    return out;"""),
])

# ---------------- index.html：用法速查卡 ----------------
patch('apollo11/webdata/index.html', [
 ("""        <div class="agcstat">
          <div class="kv"><label data-i18n="dsky.instructions">已执行指令</label><b id="agcCount">0</b></div>""",
  """        <div class="dskyhelp" data-i18n="dsky.help">用法：VERB → 两位数字 → NOUN → 两位数字 → ENTR 提交；CLR 清除键入；空按 ENTR 会亮 OPR ERR。例：V16 N68 E 显示时间。数字可直接键入 R1（± 改符号）。程序写显示通道会接管寄存器。</div>
        <div class="agcstat">
          <div class="kv"><label data-i18n="dsky.instructions">已执行指令</label><b id="agcCount">0</b></div>"""),
])

# ---------------- 10-tutorial.js：DSKY 动手步骤（n20 之后插入） ----------------
patch('apollo11/webdata/js/10-tutorial.js', [
 ("""    { id: 'n21', target: '#missionList', wait: 'mission_started',""",
  """    { id: 'n20a', target: '#dskyBox',
      title: T('④a 亲手用一次 DSKY（键入）', '④a Try the DSKY keyboard'),
      body: T('现在动手：先按【VERB】——VERB 寄存器会变成 V--，表示"正在键入动词"；\\n'
            + '再按【1】【6】——寄存器变成 V16。\\n\\n'
            + '接着按【NOUN】【6】【8】（NOUN 寄存器显示 N68），最后按【ENTR】提交。\\n'
            + '每按一个键，寄存器都会立刻变化 —— 这就是真 DSKY 的键入方式。\\n'
            + '（按错了按【CLR】清掉重来；空手按 ENTR 会亮 OPR ERR，按 RSET 或 CLR 熄灭。）',
              'Hands on: press 【VERB】 - the VERB register shows V-- (entering a verb);\\n'
            + 'then 【1】【6】 - it becomes V16.\\n\\n'
            + 'Then 【NOUN】【6】【8】 (N68) and 【ENTR】 to commit.\\n'
            + 'Every key instantly shows in a register - that is how a real DSKY works.\\n'
            + '(Press 【CLR】 to cancel; bare ENTR lights OPR ERR, RSET/CLR clears it.)') },
    { id: 'n20b', target: '#dskyBox',
      title: T('④b 让它跑起来：载入一个程序', '④b Make it run: load a program'),
      body: T('DSKY 显示的数字来自**运行中的 AGC 程序**。走到底部【AGC 汇编终端】，\\n'
            + '选 dsky-demo.agc，点【汇编并装载到 AGC】——寄存器立刻显示 PROG=11、\\n'
            + 'VERB=16、NOUN=36，R1 开始计数（这就是程序的输出）。\\n\\n'
            + '然后试试 attitude-hold.agc / lambert.agc，或自己改源码再装载。\\n'
            + '想查 AGC 汇编语法，参考 chrislgarry/apollo-11（真实 AGC 源码）\\n'
            + '与 virtualagc/virtualagc（模拟器与文档）。',
              'The numbers come from the **running AGC program**. Go to the 【AGC assembler】\\n'
            + 'tab, pick dsky-demo.agc and click 【Assemble & load into AGC】 - the registers\\n'
            + 'show PROG=11, VERB=16, NOUN=36 and R1 starts counting (the program output).\\n\\n'
            + 'Try attitude-hold.agc / lambert.agc, or edit the source and reload.\\n'
            + 'For AGC assembly syntax see chrislgarry/apollo-11 (real AGC source)\\n'
            + 'and virtualagc/virtualagc (emulator & docs).') },
    { id: 'n21', target: '#missionList', wait: 'mission_started',"""),
])
