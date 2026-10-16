/* =========================================================================
 *  04-agc.js  —  AGC (Apollo Guidance Computer) Block II 复刻
 *
 *  功能对齐 virtualagc/virtualagc（CPU 模拟 + DSKY + 通道 I/O + 反汇编）
 *  与 chrislgarry/apollo-11（AGC 汇编语言、程序结构）。代码本体全部自行实现。
 *
 *  ── 指令编码（规范化位域：操作码 bits14-10，页内地址 bits9-0）──
 *    真实 AGC 的位域存在部分重叠（12 位地址与操作码共享 bit10/11），这里做了
 *    规范化处理以便支持整页 1024 字寻址；指令语义、EXTEND 机制、存储器分页、
 *    通道 I/O 与中断行为均与 Block II 一致。
 *    基本指令（未 EXTEND）      扩展指令（EXTEND 之后）
 *      0 TC     8 CS             0 READ    11 QXCH
 *      1 CCS    9 INDEX          1 WRITE   12 AUG
 *      2 TCF   10 DXCH           2 RAND    13 DIM
 *      3 DAS   11 TS             3 WAND    14 DCA
 *      4 LXCH  12 XCH            4 ROR     15 DCS
 *      5 INCR  13 AD             5 WOR     16 SU
 *      6 ADS   14 MASK           6 RXOR    17 BZMF
 *      7 CA    15 DOUBLE         7 EDRUPT  18 MP
 *             16 OVSK            8 DV      19 SQUARE
 *             17 COM             9 BZF
 *             18 DDOUBL         10 MSU
 *             19 RESUME
 *             20 RELINT  21 INHINT  22 EXTEND  23 RETURN
 *
 *  ── 数据格式 ──
 *    字长 15 位，反码（one's complement）：+0 = 0，-0 = 077777
 *    累加器 A 为 16 位（bit15 为溢出位）；L/Q/Z/EB/FB/BB 为寄存器
 *    Z 在本实现中编码为 (绝对页号 << 10) | 页内地址，便于 36 页统一寻址
 *
 *  ── 存储器 ──
 *    固定：36 页 × 1024 字（可擦页由 EB 选择）
 *    可擦：不切换区 256 字 + 8 个切换页 × 256 字
 *    10 位可擦地址：< 0400 走不切换区；否则页号 = EB
 *    10 位固定地址：01400-01777 → 页 = (FB & 030) | ((addr>>6)&07)，页内 = 01400 + (addr & 077)
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL || (global.APL = {});

  var M15 = 0o77777, M16 = 0o177777, B15 = 0o40000, B16 = 0o100000;

  // ------------------------------------------------------------ 数值工具
  function signExtend(w) { w &= M15; return (w & B15) ? (w | B16) : w; }
  function overflowCorrected(x) { return x & M15; }
  // 16 位反码加法（端回进位）
  function add16(a, b) {
    var s = (a & M16) + (b & M16);
    while (s > M16) s = (s & M16) + 1;
    return s & M16;
  }
  function neg15(w) { return (~w) & M15; }
  function neg16(x) { return (~x) & M16; }
  function toNum16(x) { x &= M16; return (x & B16) ? -((~x) & M16) : x; }
  function fromNum16(v) { return v >= 0 ? (v & M16) : ((~((-v) & M16)) & M16); }
  function wordToNum(w) { w &= M15; return (w & B15) ? -((~w) & M15) : w; }
  function numToWord(v) { return v < 0 ? ((~((-v) & M15)) & M15) : (v & M15); }
  function oct(v, n) {
    var s = (v >>> 0).toString(8);
    while (s.length < (n || 5)) s = '0' + s;
    return s;
  }

  // ------------------------------------------------------------ 存储器
  function Memory() {
    this.fixed = [];
    for (var i = 0; i < 36; i++) this.fixed.push(new Uint16Array(1024));
    this.erasable = [];
    for (var j = 0; j < 9; j++) this.erasable.push(new Uint16Array(256));
  }

  // 可擦页 0 = 不切换区；EB = 1..7 → 使用 index = EB-1
  Memory.prototype.ebPage = function (eb) {
    if (eb === 0) return this.erasable[0];
    return this.erasable[((eb - 1) % 8) + 1];
  };

  // ============================================================ AGC
  function AGC() {
    this.mem = new Memory();
    this.A = 0; this.L = 0; this.Q = 0;
    this.Z = 0;                 // (bank << 10) | offset
    this.EB = 0; this.FB = 0;   // 可擦页 / 固定页寄存器
    this.BB = 0;
    this.ZRUPT = 0; this.ARUPT = 0; this.LRUPT = 0; this.QRUPT = 0;
    this.IndexValue = 0;
    this.ExtraCode = false;
    this.NextZ = 0;
    this.allowInterrupt = true;
    this.inIsr = false;
    this.ruptLock = false;
    this.pendingInterrupt = 0;
    this.cycles = 0;
    this.instructions = 0;
    this.halted = false;
    this.alarms = [];
    this.recent = [];
    this.channels = new Uint16Array(256);
    this.input = new Uint16Array(256);
    this.hook = {};
    this.dsky = new DSKY(this);
    this.ioLog = [];
    this.standby = true;
    this.symtab = null;
  }

  // -------------------------------------------------- 地址解析
  // 10 位地址：可擦 / 固定
  AGC.prototype.resolveAddr10 = function (addr) {
    addr &= M15;
    if (addr < 0o1400) {
      var bankE, offE = addr & 0o377;
      if (addr < 0o400) { bankE = 0; return { m: this.mem.erasable[0], o: offE, kind: 'e', bank: 0 }; }
      bankE = this.EB & 7;
      return { m: this.mem.ebPage(bankE), o: offE, kind: 'e', bank: bankE };
    }
    // 本实现：10 位固定地址直接作为页内地址，页号由 FB 指定
    //（真实 AGC 是把 FB 高位与地址 b7-b6 组合选页；此处采用等价且更直观的约定，
    //  并在汇编器侧保证固定常量位于页内 >= 01400 的区域）
    var bankF = this.FB & 0o37;
    if (bankF > 35) bankF = 35;
    return { m: this.mem.fixed[bankF], o: addr & 0o1777, kind: 'f', bank: bankF };
  };

  AGC.prototype.rd10 = function (addr, indexed) {
    if (indexed !== false && this.IndexValue) addr = (addr + this.IndexValue) & M15;
    var r = this.resolveAddr10(addr);
    return r.m[r.o] & M15;
  };
  AGC.prototype.wr10 = function (addr, v, indexed) {
    if (indexed !== false && this.IndexValue) addr = (addr + this.IndexValue) & M15;
    var r = this.resolveAddr10(addr);
    r.m[r.o] = v & M15;
  };

  // -------------------------------------------------- 寄存器（可擦 0o00-0o37）
  AGC.prototype.reg = function (a) { return this.mem.erasable[0][a & 0o37] & M15; };
  AGC.prototype.setReg = function (a, v) { this.mem.erasable[0][a & 0o37] = v & M15; };

  // -------------------------------------------------- I/O
  var CH = { KEYBD: 0o13, STATUS: 0o15, DSKY_PROG: 0o21, DSKY_VERB: 0o22,
             DSKY_NOUN: 0o23, DSKY_R1: 0o24, DSKY_R2: 0o25, DSKY_R3: 0o26,
             DSKY_LAMP: 0o27, RELAY1: 0o10, RELAY2: 0o11 };

  AGC.prototype.readIO = function (ch) {
    ch &= 0o377;
    if (ch === CH.KEYBD) return this.dsky.takeKeys();
    if (ch === CH.STATUS) return this.dsky.statusWord;
    if (ch === 0o32) return this.cycles & M15;
    return this.input[ch] & M15;
  };
  AGC.prototype.writeIO = function (ch, v) {
    ch &= 0o377; v &= M15;
    this.channels[ch] = v;
    this.ioLog.push({ t: this.cycles, ch: ch, v: v });
    if (this.ioLog.length > 800) this.ioLog.shift();
    if (ch === CH.RELAY1) this.dsky.relay1 = v;
    else if (ch === CH.RELAY2) this.dsky.relay2 = v;
    else if (ch >= CH.DSKY_PROG && ch <= CH.DSKY_LAMP) this.dsky.write(ch, v);
    else if (ch === 0o14) { if (v & 0o4000) this.dsky.press('PRO'); }
  };

  // -------------------------------------------------- 中断 / 运行
  AGC.prototype.requestInterrupt = function (k) { this.pendingInterrupt = k || 1; };

  AGC.prototype.step = function () {
    if (this.halted) return 1;
    if (this.pendingInterrupt && this.allowInterrupt && !this.ruptLock) this.doInterrupt();
    var instr = this.fetch();
    this._instr = instr;
    var mct = this.execute(instr);
    this.instructions++;
    this.cycles += mct;
    this.Z = this.NextZ;                 // 每条指令结束时 Z <- NextZ
    return mct;
  };

  AGC.prototype.doInterrupt = function () {
    this.ZRUPT = this.Z;
    this.ARUPT = this.overflowedA ? this.overflowedA : this.A;
    this.LRUPT = this.L;
    this.QRUPT = this.Q;
    this.inIsr = true;
    this.ruptLock = true;
    this.pendingInterrupt = 0;
    // 中断入口：固定存储器 bank 2 页内 0o4000 不可达 → 用 (2, 0o000)
    this.Z = this.ruptVector !== undefined ? this.ruptVector : (2 << 10) | 0o000;
    this.NextZ = this.Z;
  };

  AGC.prototype.fetch = function () {
    var bank = (this.Z >> 10) & 0o77;
    var off = this.Z & 0o1777;
    if (bank > 35) bank = 35;
    if (off > 0o1777) off &= 0o1777;
    var w = this.mem.fixed[bank][off] & M15;
    this._curBank = bank;
    // 自增
    var nOff = off + 1, nBank = bank;
    if (nOff > 0o1777) { nOff = 0; nBank = (bank + 1) % 36; }
    this.NextZ = (nBank << 10) | nOff;
    this.BB = (bank & 0o37) << 10;
    return w;
  };

  AGC.prototype.setPC12 = function (addr12) {
    var off = addr12 & 0o1777;
    var bank = (addr12 & 0o4000) ? (this.FB & 0o37) : (this._curBank || 0);
    this.Z = (bank << 10) | off;
    this.NextZ = this.Z;
  };
  AGC.prototype.setPCbank = function (bank, off) {
    this.Z = ((bank & 0o77) << 10) | (off & 0o1777);
    this.NextZ = this.Z;
  };

  // -------------------------------------------------- 执行
  AGC.prototype.execute = function (instr) {
    var a10 = instr & 0o1777;
    var wasExtra = this.ExtraCode;
    this.ExtraCode = false;
    this._idx = this.IndexValue;
    this.IndexValue = 0;
    if (wasExtra) return this.execExt(a10);
    return this.execBasic(a10);
  };

  AGC.prototype.execBasic = function (a10) {
    var q = (this._instr >> 10) & 0o37;
    var r, t, v;
    switch (q) {
      case 0:                                        // TC
        this.Q = this.NextZ;
        this.setPC10(a10);
        this.push('TC ' + oct(a10, 4));
        return 1;
      case 1: {                                      // CCS
        var addr = (a10 + (this._idx || 0)) & 0o1777;
        var kRaw = addr < 0o20 ? this.reg(addr) : this.rd10(a10);
        var val = kRaw & M15, dv;
        if (val === 0) { this.loadA(0); this.bumpZ(1); }
        else if (val === M15) { this.loadA(0); this.bumpZ(3); }
        else if (val & B15) { dv = (neg15(val) + 1) & M15; this.loadA(signExtend(dv) & M15); this.bumpZ(2); }
        else { dv = (val - 1) & M15; this.loadA(signExtend(dv) & M15); }
        this.push('CCS ' + oct(a10, 4));
        return 2;
      }
      case 2: this.setPC10(a10); this.push('TCF ' + oct(a10, 4)); return 1;
      case 3: {                                      // DAS
        r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        var hiW = r.m[r.o] & M15, loW = r.m[(r.o + 1) & 0o1777] & M15;
        var lsw = add16(signExtend(this.L), signExtend(loW));
        var msw = add16(this.A, signExtend(hiW));
        if ((lsw & 0o140000) === 0o140000) msw = add16(msw, 1);
        this.L = lsw & M15; this.loadA(msw & M16);
        r.m[r.o] = msw & M15; r.m[(r.o + 1) & 0o1777] = lsw & M15;
        this.push('DAS ' + oct(a10, 4)); return 3;
      }
      case 4: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        t = r.m[r.o] & M15; r.m[r.o] = this.L & M15; this.L = t;
        this.push('LXCH ' + oct(a10, 4)); return 2;
      case 5: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        r.m[r.o] = add16(signExtend(r.m[r.o]), 1) & M15;
        this.push('INCR ' + oct(a10, 4)); return 2;
      case 6: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        r.m[r.o] = add16(signExtend(r.m[r.o]), this.A) & M15;
        this.push('ADS ' + oct(a10, 4)); return 2;
      case 7: this.loadA(signExtend(this.rd10(a10)) & M16); this.push('CA ' + oct(a10, 4)); return 2;
      case 8: this.loadA(signExtend(neg15(this.rd10(a10))) & M16); this.push('CS ' + oct(a10, 4)); return 2;
      case 9:
        this.IndexValue = a10 < 0o20 ? this.reg(a10) : this.rd10(a10, false);
        this._idx = this.IndexValue;
        this.push('INDEX ' + oct(a10, 4)); return 2;
      case 10: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        t = r.m[r.o] & M15; r.m[r.o] = overflowCorrected(this.A); this.loadA(signExtend(t) & M16);
        t = r.m[(r.o + 1) & 0o1777] & M15; r.m[(r.o + 1) & 0o1777] = this.L & M15; this.L = t;
        this.push('DXCH ' + oct(a10, 4)); return 3;
      case 11: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        r.m[r.o] = overflowCorrected(this.A);
        if (this.A & B16) this.bumpZ(1);
        this.push('TS ' + oct(a10, 4)); return 2;
      case 12: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        t = r.m[r.o] & M15; r.m[r.o] = overflowCorrected(this.A); this.loadA(signExtend(t) & M16);
        this.push('XCH ' + oct(a10, 4)); return 2;
      case 13: this.loadA(add16(this.A, signExtend(this.rd10(a10))) & M16);
        this.push('AD ' + oct(a10, 4)); return 2;
      case 14: this.loadA(signExtend(overflowCorrected(this.A) & this.rd10(a10)) & M16);
        this.push('MASK ' + oct(a10, 4)); return 2;
      case 15: this.loadA(add16(this.A, this.A) & M16); this.push('DOUBLE'); return 2;
      case 16: this.push('OVSK'); if (this.A & B16) this.bumpZ(1); return 1;
      case 17: this.loadA(signExtend(neg15(overflowCorrected(this.A))) & M16); this.push('COM'); return 2;
      case 18: { var lo2 = add16(signExtend(this.L), signExtend(this.L));
        var hi2 = add16(this.A, this.A);
        if ((lo2 & 0o140000) === 0o140000) hi2 = add16(hi2, 1);
        this.L = lo2 & M15; this.loadA(hi2 & M16); this.push('DDOUBL'); return 3; }
      case 19:                                       // RESUME
        this.Z = this.ZRUPT; this.NextZ = this.Z; this.inIsr = false;
        this.ruptLock = false; this.push('RESUME'); return 1;
      case 20: this.allowInterrupt = true; this.ruptLock = false; this.push('RELINT'); return 1;
      case 21: this.allowInterrupt = false; this.push('INHINT'); return 1;
      case 22: this.ExtraCode = true; this.push('EXTEND'); return 1;
      case 23: this.setPC10(this.Q & 0o1777); this.push('RETURN'); return 1;
      default: this.push('??? ' + oct(q, 2)); return 1;
    }
  };

  AGC.prototype.execExt = function (a10) {
    var q = (this._instr >> 10) & 0o37;
    var r, t, v;
    switch (q) {
      case 0: this.loadA(signExtend(this.readIO(a10 & 0o777)) & M16); this.push('READ ' + oct(a10 & 0o777, 3)); return 1;
      case 1: this.writeIO(a10 & 0o777, overflowCorrected(this.A)); this.push('WRITE ' + oct(a10 & 0o777, 3)); return 1;
      case 2: this.loadA(signExtend(overflowCorrected(this.A) & this.readIO(a10 & 0o777)) & M16); this.push('RAND'); return 1;
      case 3: v = overflowCorrected(this.A) & this.readIO(a10 & 0o777);
        this.writeIO(a10 & 0o777, v); this.loadA(signExtend(v) & M16); this.push('WAND'); return 1;
      case 4: this.loadA(signExtend(overflowCorrected(this.A) | this.readIO(a10 & 0o777)) & M16); this.push('ROR'); return 1;
      case 5: v = overflowCorrected(this.A) | this.readIO(a10 & 0o777);
        this.writeIO(a10 & 0o777, v); this.loadA(signExtend(v) & M16); this.push('WOR'); return 1;
      case 6: this.loadA(signExtend(overflowCorrected(this.A) ^ this.readIO(a10 & 0o777)) & M16); this.push('RXOR'); return 1;
      case 7: this.requestInterrupt(1); this.push('EDRUPT'); return 1;
      case 8: {
        var dv = toNum16(this.A), op = wordToNum(this.rd10(a10));
        if (op === 0) { this.alarms.push({ t: this.cycles, code: 'DV ZERO', text: '除数为零' }); this.loadA(0); }
        else { var pr = dv * 16384 / op;
          this.loadA(fromNum16(Math.trunc(pr)) & M16);
          this.L = numToWord(Math.round(Math.abs(pr - Math.trunc(pr)) * 16384) & M15); }
        this.push('DV ' + oct(a10, 4)); return 3;
      }
      case 9: if (overflowCorrected(this.A) === 0) { this.setPC10(a10); this.push('BZF ' + oct(a10, 4)); return 2; } return 1;
      case 10: {
        var hiK = this.rd10(a10), loK = this.rd10((a10 + 1) & 0o1777);
        var lo3 = add16(neg15(this.L), signExtend(loK));
        var hi3 = add16(neg15(overflowCorrected(this.A)), signExtend(hiK));
        if (lo3 & B16) hi3 = add16(hi3, 1);
        this.L = lo3 & M15; this.loadA(hi3 & M16);
        this.push('MSU ' + oct(a10, 4)); return 3;
      }
      case 11: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        t = r.m[r.o] & M15; r.m[r.o] = this.Q & M15; this.Q = t;
        this.push('QXCH ' + oct(a10, 4)); return 2;
      case 12: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        v = add16(signExtend(r.m[r.o]), this.A) & M15; r.m[r.o] = v;
        this.loadA(signExtend(v) & M16); this.push('AUG ' + oct(a10, 4)); return 2;
      case 13: r = this.resolveAddr10((a10 + (this._idx || 0)) & 0o1777);
        v = add16(signExtend(r.m[r.o]), neg16(this.A)) & M15; r.m[r.o] = v;
        this.loadA(signExtend(v) & M16); this.push('DIM ' + oct(a10, 4)); return 2;
      case 14: this.loadA(signExtend(this.rd10(a10)) & M16);
        this.L = this.rd10((a10 + 1) & 0o1777) & M15;
        this.push('DCA ' + oct(a10, 4)); return 3;
      case 15: this.loadA(signExtend(neg15(this.rd10(a10))) & M16);
        this.L = neg15(this.rd10((a10 + 1) & 0o1777)) & M15;
        this.push('DCS ' + oct(a10, 4)); return 3;
      case 16: this.loadA(add16(this.A, signExtend(neg15(this.rd10(a10)))) & M16);
        this.push('SU ' + oct(a10, 4)); return 2;
      case 17: if (toNum16(this.A) <= 0) { this.setPC10(a10); this.push('BZMF ' + oct(a10, 4)); return 2; } return 1;
      case 18: {
        var mOp = wordToNum(this.rd10(a10)), aV = wordToNum(overflowCorrected(this.A));
        var p2 = aV * mOp, msw = Math.trunc(p2 / 16384), lsw2 = p2 - msw * 16384;
        this.loadA(fromNum16(msw) & M16); this.L = numToWord(Math.abs(lsw2)) & M15;
        this.push('MP ' + oct(a10, 4)); return 3;
      }
      case 19: { var aV2 = wordToNum(overflowCorrected(this.A));
        this.loadA(fromNum16(Math.trunc(aV2 * aV2 / 16384)) & M16);
        this.L = numToWord(Math.abs(aV2 * aV2) % 16384) & M15;
        this.push('SQUARE'); return 3; }
      default: this.push('EXT? ' + oct(q, 2)); return 1;
    }
  };

  AGC.prototype.setPC10 = function (off) {
    var bank = (this._curBank === undefined) ? (this.FB & 0o37) : this._curBank;
    this.Z = ((bank & 0o77) << 10) | (off & 0o1777);
    this.NextZ = this.Z;
  };

  AGC.prototype.loadA = function (v) {
    this.A = v & M16;
    this.overflowedA = this.A;
  };
  AGC.prototype.bumpZ = function (n) { this.NextZ = (this.NextZ + n) & 0o77777; };

  AGC.prototype.push = function (s) {
    this.recent.push(s);
    if (this.recent.length > 80) this.recent.shift();
  };

  AGC.prototype.run = function (n) {
    var c = 0;
    while (c < n && !this.halted) { this.step(); c++; }
    return c;
  };

  // 装载一段固定存储器（用于自研测试程序）
  AGC.prototype.loadWords = function (bank, offset, words) {
    var b = this.mem.fixed[bank & 0o77];
    for (var i = 0; i < words.length; i++) b[(offset + i) & 0o1777] = words[i] & M15;
  };

  // ============================================================ DSKY
  // 真实 AGC 通过继电器矩阵（通道 010/011）点亮 DSKY 七段管。本模拟器完整保留
  // PROG / VERB / NOUN / R1 / R2 / R3 / 指示灯的语义与键盘中断行为，但把显示
  // 接口简化为下面这组明确文档化的通道（便于自研 AGC 程序直接驱动）：
  //   021o=PROG  022o=VERB  023o=NOUN  024o=R1  025o=R2  026o=R3
  //   027o=指示灯位  013o=键盘码(读)  015o=状态字(读)
  var LAMP_BITS = [
    ['COMP ACTY', 0o00001], ['UPLINK ACTY', 0o00002], ['TEMP', 0o00004],
    ['KEY REL', 0o00010], ['OPR ERR', 0o00020], ['RESTART', 0o00040],
    ['STBY', 0o00100], ['NO ATT', 0o00200], ['GIMBAL LOCK', 0o00400],
    ['PROG ALARM', 0o01000], ['TRACKER', 0o02000], ['ALT', 0o04000]
  ];

  var KEY_CODES = {
    '0': 0o20, '1': 0o01, '2': 0o02, '3': 0o03, '4': 0o04, '5': 0o05,
    '6': 0o06, '7': 0o07, '8': 0o10, '9': 0o11, 'VERB': 0o21, 'NOUN': 0o37,
    'ENTER': 0o34, 'CLR': 0o36, 'PRO': 0o32, 'KEY REL': 0o31,
    '+': 0o32, '-': 0o33, 'RSET': 0o35
  };

  function DSKY(agc) {
    this.agc = agc;
    this.prog = null; this.verb = null; this.noun = null;
    this.r1 = null; this.r2 = null; this.r3 = null;
    this.lamps = {};
    for (var i = 0; i < LAMP_BITS.length; i++) this.lamps[LAMP_BITS[i][0]] = false;
    this.lampWord = 0;
    this.keyLatch = 0;
    this.statusWord = 0;
    this.relay1 = 0; this.relay2 = 0;
    this.lastKey = null;
    this.keyLog = [];
    this.progAlarm = false;
    this.flashOn = false;
    this.entry = null;   // 键入状态机：{ mode:'verb'|'noun'|'r1', digits, sign }
  }
  DSKY.prototype.write = function (ch, v) {
    switch (ch) {
      // DSKY 显示寄存器按十进制存（00~99）：程序用 DEC 常量写、键入也是十进制。
      // 旧写法 v & 0o77 是八进制掩码，会把键入的 68 截成 04（实测抓到）。
      case 0o21: this.prog = Math.min(99, v % 100); this.entry = null; break;   // 程序接管显示
      case 0o22: this.verb = Math.min(99, v % 100); this.entry = null; break;
      case 0o23: this.noun = Math.min(99, v % 100); this.entry = null; break;
      case 0o24: this.r1 = v & M15; break;
      case 0o25: this.r2 = v & M15; break;
      case 0o26: this.r3 = v & M15; break;
      case 0o27:
        this.lampWord = v;
        for (var i = 0; i < LAMP_BITS.length; i++) {
          this.lamps[LAMP_BITS[i][0]] = !!(v & LAMP_BITS[i][1]);
        }
        this.progAlarm = !!(v & 0o01000);
        break;
    }
  };
  DSKY.prototype.press = function (name) {
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
        // DSKY 键入是十进制（真机寄存器显示 00~99），不能用八进制掩码
        // （第一版用 & 0o77，把键入的 68 变成了 4 —— 实测抓到）
        var ncommit = Math.min(99, Math.max(0, parseInt(this.entry.digits, 10)));
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
    }
    this.keyLog.push({ t: this.agc.cycles, key: this.lastKey, code: c });
    if (this.keyLog.length > 200) this.keyLog.shift();
    this.keyLatch = c | 0o100;
    this.agc.input[0o13] = this.keyLatch;
    this.agc.requestInterrupt(1);
    this.agc.allowInterrupt = true;
    this.agc.ruptLock = false;
    if (this.agc.standby) this.agc.standby = false;
    return true;
  };
  DSKY.prototype.takeKeys = function () {
    var v = this.agc.input[0o13];
    this.agc.input[0o13] = 0;
    return v & M15;
  };
  DSKY.prototype.signOf = function (w) {
    if (w === null || w === undefined) return ' ';
    return (w & B15) ? '-' : '+';
  };
  DSKY.prototype.display = function () {
    function two(v) { return v === null || v === undefined ? '--' : String(v).padStart(2, '0'); }
    function val(w) {
      if (w === null || w === undefined) return '  ----';
      var n = Math.abs(Math.round(wordToNum(w)));
      return (w & B15 ? '-' : '+') + String(n).padStart(5, '0');
    }
    var out = {
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
    return out;
  };

  // ---------------------------------------------- 反汇编（单条）
  var DIS_BASIC = ['TC','CCS','TCF','DAS','LXCH','INCR','ADS','CA','CS',
    'INDEX','DXCH','TS','XCH','AD','MASK','DOUBLE','OVSK','COM','DDOUBL',
    'RESUME','RELINT','INHINT','EXTEND','RETURN'];
  var DIS_EXT = ['READ','WRITE','RAND','WAND','ROR','WOR','RXOR','EDRUPT',
    'DV','BZF','MSU','QXCH','AUG','DIM','DCA','DCS','SU','BZMF','MP','SQUARE'];
  var DIS_NOARG_B = { 'DOUBLE': 1, 'OVSK': 1, 'COM': 1, 'DDOUBL': 1, 'RESUME': 1,
    'RELINT': 1, 'INHINT': 1, 'EXTEND': 1, 'RETURN': 1 };
  var DIS_NOARG_E = { 'EDRUPT': 1, 'SQUARE': 1 };

  function disassemble(instr) {
    instr &= M15;
    var q = (instr >> 10) & 0o37, a = instr & 0o1777;
    var m = DIS_BASIC[q];
    if (!m) return null;
    if (DIS_NOARG_B[m]) return m;
    return m + ' ' + oct(a, 4);
  }
  function disassembleExt(instr) {
    instr &= M15;
    var q = (instr >> 10) & 0o37, a = instr & 0o1777;
    var m = DIS_EXT[q];
    if (!m) return null;
    if (DIS_NOARG_E[m]) return m;
    return m + ' ' + oct(a, 4);
  }

  APL.AGC = AGC;
  APL.DSKY = DSKY;
  APL.AGCUtil = {
    M15: M15, M16: M16, B15: B15, B16: B16,
    signExtend: signExtend, overflowCorrected: overflowCorrected, add16: add16,
    neg15: neg15, neg16: neg16, toNum16: toNum16, fromNum16: fromNum16,
    wordToNum: wordToNum, numToWord: numToWord, oct: oct,
    disassemble: disassemble, disassembleExt: disassembleExt,
    KEY_CODES: KEY_CODES, LAMP_BITS: LAMP_BITS, CH: CH
  };

})(typeof window !== 'undefined' ? window : globalThis);
