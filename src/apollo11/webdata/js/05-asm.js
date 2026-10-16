/* =========================================================================
 *  05-asm.js  —  AGC 汇编器 / 反汇编器（yaYUL 功能子集，自行实现）
 *
 *  支持：两遍汇编、符号表、表达式、常用伪操作、全部 Block II 助记符。
 *  存储模型：36 页 × 1024 字线性地址空间；LOC = (页号 << 10) | 页内地址
 *  · 12 位地址（TC/TCF）：默认 B=0（同页），跨页可用 2CADR/CADR 配合 BBCON
 *  · 10 位固定地址：需页内地址 ≥ 01400（相当于每页高 256 字区）
 *  · 10 位可擦地址：< 0400 为不切换区，否则 0400+偏移，由 EB 选择页
 * ========================================================================= */
(function (global) {
  'use strict';
  var APL = global.APL;
  var U = APL.AGCUtil;
  var oct = U.oct, M15 = U.M15;

  // 汇编器诊断信息的中英双语
  function M(zh, en) {
    return (APL.getLang && APL.getLang() === 'en') ? en : zh;
  }

  // 操作码表：word = (op5 << 10) | (页内地址 & 01777)
  // 基本指令（未 EXTEND）
  var OP_BASIC = {
    TC: 0, CCS: 1, TCF: 2, DAS: 3, LXCH: 4, INCR: 5, ADS: 6, CA: 7,
    CS: 8, INDEX: 9, NDX: 9, DXCH: 10, TS: 11, XCH: 12, AD: 13, MASK: 14,
    MSK: 14, DOUBLE: 15, OVSK: 16, COM: 17, DDOUBL: 18, RESUME: 19,
    RELINT: 20, INHINT: 21, EXTEND: 22, RETURN: 23, CAF: 7
  };
  // 扩展指令（EXTEND 之后）
  var OP_EXT = {
    READ: 0, WRITE: 1, RAND: 2, WAND: 3, ROR: 4, WOR: 5, RXOR: 6,
    EDRUPT: 7, DV: 8, BZF: 9, MSU: 10, QXCH: 11, AUG: 12, DIM: 13,
    DCA: 14, DCS: 15, DCOM: 15, SU: 16, BZMF: 17, MP: 18, SQUARE: 19
  };
  // 无操作数的伪指令（映射到固定编码）
  var FIXED_OPS = {
    RELINT: 20, INHINT: 21, EXTEND: 22, RETURN: 23, RESUME: 19,
    DDOUBL: 18, OVSK: 16, COM: 17, DOUBLE: 15
  };
  var BASIC = {}, EXT = {};
  (function () {
    for (var k in OP_BASIC) {
      if (!Object.prototype.hasOwnProperty.call(OP_BASIC, k)) continue;
      (function (mn, op) {
        BASIC[mn] = function (o) {
          if (FIXED_OPS[mn] !== undefined) return [(op << 10)];
          return [(op << 10) | ((o === undefined ? 0 : o) & 0o1777)];
        };
      })(k, OP_BASIC[k]);
    }
  })();
  (function () {
    for (var k2 in OP_EXT) {
      if (!Object.prototype.hasOwnProperty.call(OP_EXT, k2)) continue;
      (function (mn, op) {
        EXT[mn] = function (o) {
          if (mn === 'EDRUPT' || mn === 'SQUARE' || mn === 'DCOM') return [(op << 10)];
          return [(op << 10) | ((o === undefined ? 0 : o) & 0o1777)];
        };
      })(k2, OP_EXT[k2]);
    }
  })();

  // 操作数一律取页内 10 位地址
  function encOperand(abs) { return abs & 0o1777; }

  // ------------------------------------------------------------ Tokenizer
  function tokenize(line) {
    var src = line;
    var comment = '';
    var hash = src.indexOf('#');
    if (hash >= 0) { comment = src.slice(hash + 1).trim(); src = src.slice(0, hash); }
    var body = src.replace(/\t/g, ' ').trim();
    var label = '';
    var m = body.match(/^([A-Za-z_$][A-Za-z0-9_$+\-]*)\s*/);
    if (m && !/^(SETLOC|BANK|SBANK|OCT|OCTAL|DEC|2DEC|EQUALS|ERASE|CADR|FCADR|ECADR|GENADR|2CADR|ADRES|BBCON|COUNT|BLOCK|BSS|BNKSUM)$/i.test(m[1])) {
      // 只有后面还有内容或该行是纯标签时才当作标签
      var rest0 = body.slice(m[1].length).trim();
      var isOp = BASIC[m[1]] || EXT[m[1]] || RESERVED_PSEUDO[m[1]];
      if (!isOp && (rest0 !== '' || true)) { label = m[1]; body = rest0; }
    }
    var opcode = '', operand = '';
    var sp = body.search(/\s/);
    if (sp < 0) { opcode = body; }
    else { opcode = body.slice(0, sp); operand = body.slice(sp).trim(); }
    opcode = opcode.replace(/:$/, '');
    return { label: label, opcode: opcode, operand: operand, comment: comment, raw: line };
  }

  var RESERVED_PSEUDO = {
    'SETLOC': 1, 'BANK': 1, 'SBANK=': 1, 'EBANK=': 1, 'OCT': 1, 'OCTAL': 1,
    'DEC': 1, '2DEC': 1, 'EQUALS': 1, '=': 1, '=MINUS': 1, 'ERASE': 1,
    'CADR': 1, 'FCADR': 1, 'ECADR': 1, 'GENADR': 1, '2CADR': 1, 'ADRES': 1,
    'BBCON': 1, 'COUNT': 1, 'BLOCK': 1, 'BNKSUM': 1, 'EQUALS*': 1
  };

  // ------------------------------------------------------------ 表达式
  // AGC 约定：表达式中裸数字一律按八进制解释；DEC/2DEC 单独按十进制
  function evalExpr(expr, sym, loc, pass, radix) {
    var R = radix || 8;
    expr = expr.trim();
    if (expr === '') return 0;
    if (expr === '*') return loc;
    // 处理 * 作为当前地址
    var toks = [];
    var re = /(\*|[A-Za-z_$][A-Za-z0-9_$+\-]*|0[0-7]+|[0-9]+|[+\-/&]|\(|\)|')/g;
    var mm, idx = 0;
    while ((mm = re.exec(expr))) { toks.push(mm[0]); idx = mm.index + mm[0].length; }
    // 递归下降
    var pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function primary() {
      var t = next();
      if (t === undefined) return 0;
      if (t === '(') { var v = addsub(); if (peek() === ')') next(); return v; }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '*') return loc;
      if (/^[0-9]+$/.test(t)) return parseInt(t, R);
      if (t === "'") { // 'A' 字符常量
        var ch = next(); return ch ? ch.charCodeAt(0) : 0;
      }
      var v2 = sym[t];
      if (v2 === undefined) { if (pass === 1) return 0; return undefined; }
      return (typeof v2 === 'object') ? v2.value : v2;
    }
    function muldiv() {
      var v = primary();
      while (peek() === '*' || peek() === '/') {
        var op = next(); var r = primary();
        v = op === '*' ? v * r : (r === 0 ? 0 : Math.floor(v / r));
      }
      return v;
    }
    function addsub() {
      var v = muldiv();
      while (peek() === '+' || peek() === '-') {
        var op = next(); var r = muldiv();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    var out = addsub();
    return out;
  }

  // ------------------------------------------------------------ 汇编器
  function Assembler() {
    this.reset();
  }
  Assembler.prototype.reset = function () {
    this.sym = {};
    this.mem = null;               // Uint16Array(36*1024)
    this.list = [];
    this.errors = [];
    this.warnings = [];
    this.loc = 0o2000;             // 默认从 bank 2 开头
    this.curBank = 2;
    this.started = false;
  };

  Assembler.prototype.assemble = function (sourceText) {
    this.reset();
    this.mem = new Uint16Array(36 * 1024);
    var lines = sourceText.split(/\r?\n/);
    var parsed = [];
    for (var i = 0; i < lines.length; i++) parsed.push(tokenize(lines[i]));

    // ---- 第一遍：确定地址 ----
    this.pass = 1;
    this.doPass(parsed, false);
    // ---- 第二遍：生成代码 ----
    this.pass = 2;
    this.loc = this.startLoc;
    this.curBank = this.loc >> 10;
    this.doPass(parsed, true);
    return {
      ok: this.errors.length === 0,
      errors: this.errors, warnings: this.warnings,
      symbols: this.sym, listing: this.list, mem: this.mem,
      start: this.startLoc,
      entry: this.sym['START'] !== undefined ? this.sym['START'].value : this.startLoc
    };
  };

  Assembler.prototype.emit = function (w, text, line) {
    if (this.pass === 2) {
      if (this.loc < 0 || this.loc >= 36 * 1024) {
        this.errors.push({ line: line, msg: M('地址越界 ', 'address out of range ') + oct(this.loc, 5) });
        return;
      }
      this.mem[this.loc] = w & M15;
    }
    if (this.pass === 2) {
      this.list.push({
        loc: this.loc, word: w & M15, text: text,
        line: line, bank: this.loc >> 10, off: this.loc & 0o1777
      });
    }
    this.loc++;
  };

  var ALIGN_AT = 0o1400;    // 固定存储器可寻址区起始偏移（0000-1377 归可擦）

  Assembler.prototype.doPass = function (parsed, emit) {
    var self = this;
    var firstLocSet = false;
    for (var i = 0; i < parsed.length; i++) {
      var L = parsed[i];
      var lineNo = i + 1;
      if (!L.label && !L.opcode) continue;
      if (/^#/.test(L.raw.trim()) || L.raw.trim() === '') continue;

      // 伪操作：SETLOC / BANK
      var op = L.opcode.toUpperCase();
      if (op === 'SETLOC' && L.operand) {
        var v = evalExpr(L.operand, this.sym, this.loc, this.pass);
        if (v === undefined) { this.errors.push({ line: lineNo, msg: M('SETLOC 符号未定义', 'SETLOC: undefined symbol') }); v = 0; }
        this.loc = v & 0o77777;
        this.curBank = this.loc >> 10;
        if (!firstLocSet) { this.startLoc = this.loc; firstLocSet = true; }
        if (this.pass === 1 && this.startLoc === undefined) this.startLoc = this.loc;
        continue;
      }
      if (op === 'BANK' && L.operand) {
        var bv = evalExpr(L.operand, this.sym, this.loc, this.pass);
        this.curBank = bv & 0o37;
        this.loc = (this.curBank << 10) | (this.loc & 0o1777);
        continue;
      }
      if (op === 'SBANK=' || op === 'EBANK=' || op === 'BNKSUM' || op === 'BLOCK') continue;
      if (op === 'COUNT' || op === 'COUNT*') {
        if (L.operand) {
          var cnt = evalExpr(L.operand, this.sym, this.loc, this.pass);
          // COUNT：把当前地址计入符号
          if (L.label) self.defSym(L.label, this.loc, lineNo);
          this.loc += (cnt || 0);
        }
        continue;
      }

      // 标签
      if (L.label) {
        if (this.pass === 1) {
          if (this.sym[L.label] !== undefined && L.label !== '') {
            this.warnings.push({ line: lineNo, msg: M('符号重复定义 ', 'duplicate symbol ') + L.label });
          }
          this.sym[L.label] = { value: this.loc, bank: this.loc >> 10, off: this.loc & 0o1777 };
        }
      }

      if (!L.opcode) continue;

      // ---- 伪操作 ----
      if (op === 'ERASE') {
        if (L.operand) {
          var n = evalExpr(L.operand, this.sym, this.loc, this.pass) || 0;
          if (this.pass === 1 && L.label) this.sym[L.label] = { value: this.loc & 0o7777, bank: 0, off: this.loc & 0o377, erasable: true };
          this.loc += Math.max(n, 1);
        }
        continue;
      }
      if (op === 'EQUALS' || op === '=' || op === '=MINUS' || op === 'EQUALS*') {
        var ev = evalExpr(L.operand, this.sym, this.loc, this.pass);
        if (ev === undefined) { this.errors.push({ line: lineNo, msg: M('EQUALS 符号未定义: ', 'EQUALS: undefined symbol: ') + L.operand }); ev = 0; }
        if (op === '=MINUS') ev = -ev;
        if (this.pass === 1 && L.label) {
          var base = this.sym[L.operand.trim()];
          this.sym[L.label] = (base && base.erasable)
            ? { value: (ev - 0o400) & 0o377, bank: 0, off: (ev - 0o400) & 0o377, erasable: true }
            : { value: ev, bank: ev >> 10, off: ev & 0o1777 };
        }
        continue;
      }
      if (op === 'OCT' || op === 'OCTAL') {
        this.emit(parseWordList(L.operand, 8), 'OCT ' + L.operand, lineNo);
        continue;
      }
      if (op === 'DEC') {
        var vals = splitArgs(L.operand);
        for (var d = 0; d < vals.length; d++) {
          var dv2 = evalExpr(vals[d], this.sym, this.loc, this.pass, 10);
          this.emit(U.numToWord(dv2 | 0), 'DEC ' + vals[d], lineNo);
        }
        continue;
      }
      if (op === '2DEC') {
        var v2 = evalExpr(L.operand, this.sym, this.loc, this.pass, 10) | 0;
        var hi = Math.trunc(v2 / 16384), lo = v2 - hi * 16384;
        this.emit(U.numToWord(hi), '2DEC ' + v2, lineNo);
        this.emit(U.numToWord(lo), '', lineNo);
        continue;
      }
      if (op === 'GENADR' || op === 'ADRES' || op === 'REMADR') {
        var gv = evalExpr(L.operand, this.sym, this.loc, this.pass);
        this.emit(encOperand(gv), 'GENADR ' + L.operand, lineNo);
        continue;
      }
      if (op === 'ECADR') {
        var ec = evalExpr(L.operand, this.sym, this.loc, this.pass);
        this.emit(encOperand(ec), 'ECADR ' + L.operand, lineNo);
        continue;
      }
      if (op === 'FCADR') {
        var fc = evalExpr(L.operand, this.sym, this.loc, this.pass);
        var fb = (fc >> 10) & 0o37;
        var off2 = fc & 0o1777;
        this.emit(0o4000 | ((fb & 0o7) << 9) | off2, 'FCADR', lineNo);
        continue;
      }
      if (op === 'CADR' || op === 'BBCON' || op === '2CADR' || op === '2FCADR' || op === '2BCADR') {
        var cv = evalExpr(L.operand, this.sym, this.loc, this.pass);
        var cb = ((cv >> 10) & 0o37);
        var coff = cv & 0o1777;
        var loW = 0o4000 | ((cb & 0o7) << 9) | coff;
        var hiW = (((cb >> 3) & 0o37) << 10) | 0o0777;   // 简化 BBCON
        this.emit(loW, op + ' ' + L.operand, lineNo);
        if (op === '2CADR' || op === '2FCADR' || op === '2BCADR') this.emit(hiW, '', lineNo);
        continue;
      }

      // ---- 扩展指令 ----
      if (EXT[op]) {
        var opeV = L.operand ? evalExpr(L.operand, this.sym, this.loc, this.pass) : 0;
        if (opeV === undefined) { this.errors.push({ line: lineNo, msg: M('符号未定义: ', 'undefined symbol: ') + L.operand }); opeV = 0; }
        var enc = encOperand(opeV);
        // 与真实 AGC 汇编一致：EXTEND 需在源码中显式书写
        var ws = EXT[op](enc);
        for (var e2 = 0; e2 < ws.length; e2++) this.emit(ws[e2], op + ' ' + L.operand, lineNo);
        continue;
      }

      // ---- 基本指令 ----
      if (BASIC[op]) {
        var ov = 0;
        if (L.operand) {
          ov = evalExpr(L.operand, this.sym, this.loc, this.pass);
          if (ov === undefined) { this.errors.push({ line: lineNo, msg: M('符号未定义: ', 'undefined symbol: ') + L.operand }); ov = 0; }
        }
        var encd = encOperand(ov);
        var w2 = BASIC[op](encd);
        for (var w3 = 0; w3 < w2.length; w3++) this.emit(w2[w3], op + (L.operand ? ' ' + L.operand : ''), lineNo);
        continue;
      }

      this.errors.push({ line: lineNo, msg: M('未知操作码: ', 'unknown opcode: ') + L.opcode });
    }
  };

  function splitArgs(s) {
    var out = [], cur = '', depth = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim() !== '') out.push(cur.trim());
    return out;
  }
  function parseWordList(s, radix) {
    var parts = s.split(/[\s,]+/).filter(function (x) { return x !== ''; });
    var v = 0;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      v = radix === 8 ? parseInt(t, 8) : parseInt(t, 10);
      if (i === 0) return v & M15;      // 每行只放一个（简化）
    }
    return v & M15;
  }







  // ------------------------------------------------------------ 反汇编
  function disassembleRange(agc, bank, from, count) {
    var out = [];
    var extPending = false;
    for (var i = 0; i < count; i++) {
      var off = (from + i) & 0o1777;
      var w = agc.mem.fixed[bank & 0o37][off];
      var text;
      if (extPending) { text = U.disassembleExt(w) || ('OCT ' + oct(w, 5)); extPending = false; }
      else {
        text = U.disassemble(w);
        if (text === null) text = 'OCT ' + oct(w, 5);
        if (text === 'EXTEND') extPending = true;
      }
      out.push({ addr: oct((bank << 10) | off, 5), word: oct(w, 5), text: text });
    }
    return out;
  }

  APL.Assembler = Assembler;
  APL.Asm = {
    assemble: function (src) { return new Assembler().assemble(src); },
    tokenize: tokenize,
    disassembleRange: disassembleRange,
    BASIC: BASIC, EXT: EXT,
    ALIGN_AT: ALIGN_AT
  };

})(typeof window !== 'undefined' ? window : globalThis);
