/* =====================================================================
 *  CPU 5 層エンジン
 *    C  →  アセンブリ  →  機械語  →  論理回路  →  チューリングマシン
 *  5 つは同じプログラムをそれぞれ「独立した定義」で実行する。
 *  - C        : 構文木を C の意味論 (while / if / ++ / --) で解釈
 *  - ASM      : ニーモニックの意味 (INC r : r ← r+1 …) で解釈
 *  - 機械語    : 10bit 語をオペコード表で解読して実行
 *  - 回路      : ゲート (AND/OR/XOR/NOT/NOR/DFF) のネットリストを評価
 *  - TM       : 遷移関数 δ だけでテープを書き換える
 *  命令 1 つごとに 5 層の状態を突き合わせ、一致を確認する。
 * ===================================================================== */
(function (root) {
'use strict';

const W = 8;            // データ幅 (bit)
const MASK = (1 << W) - 1;
const PCW = 5;          // PC 幅 → 命令メモリ 32 語
const MEM = 1 << PCW;
const IW = 10;          // 命令語幅
const REGN = ['a', 'b', 'c', 'd'];
const OPN = ['HALT', 'INC', 'DEC', 'JZ', 'JMP'];
const OPC = { HALT: 0, INC: 1, DEC: 2, JZ: 3, JMP: 4 };

const bin = (v, n) => (v >>> 0).toString(2).padStart(n, '0').slice(-n);
const encode = (op, r, a) => ((op & 7) << 7) | ((r & 3) << 5) | (a & 31);
const decode = w => ({ op: (w >> 7) & 7, r: (w >> 5) & 3, a: w & 31 });
const disasm = w => {
  const { op, r, a } = decode(w);
  switch (op) {
    case 0: return 'HALT';
    case 1: return 'INC ' + REGN[r];
    case 2: return 'DEC ' + REGN[r];
    case 3: return 'JZ ' + REGN[r] + ', ' + a;
    case 4: return 'JMP ' + a;
    default: return '??? (' + bin(op, 3) + ')';
  }
};

/* ---------------------------------------------------------------------
 *  定義レジストリ : 画面上のあらゆる動きはここのどれかに紐づく
 * ------------------------------------------------------------------- */
const DEFS = {};
function def(id, level, title, body, extra) { DEFS[id] = Object.assign({ id, level, title, body }, extra || {}); return id; }

// ---- C の意味論 ----
def('C-VAR', 'c', '変数宣言 → レジスタ割り当て',
  '`unsigned char x = n;` は 8bit の符号なし整数。宣言順に a, b, c, d のレジスタへ割り当てる（最大 4 個）。初期値はレジスタの初期値になる。');
def('C-INC', 'c', 'x++ / ++x / x += 1',
  'x ← (x + 1) mod 256。unsigned char は整数昇格の後 unsigned char に戻すとき 2^8 で剰余をとる（C11 N1570 6.3.1.3p2、符号なし算術は剰余 2^N: 6.2.5p9）。255 の次は 0。');
def('C-DEC', 'c', 'x-- / --x / x -= 1',
  'x ← (x − 1) mod 256。0 の 1 つ前は 255（符号なし算術の剰余, C11 6.2.5p9）。');
def('C-WHILE', 'c', 'while (x) S',
  '制御式 x を評価し、0 と等しくなければ S を実行して先頭に戻る。0 と等しくなったら抜ける（C11 6.8.5.1）。`x != 0`, `x > 0` も同じ意味。');
def('C-IF', 'c', 'if (x) S1 else S2',
  'x が 0 と等しくなければ S1、等しければ S2 を実行（C11 6.8.4.1）。`if (x == 0) A else B` は `if (x) B else A` と同じ意味として扱う（脱糖）。');
def('C-ZERO', 'c', 'x = 0;（糖衣構文）',
  'この CPU に代入命令は無いので `x = 0;` は `while (x) x--;` に書き換えてから実行する。');
def('C-RET', 'c', 'return;', 'main から戻る = プログラム停止。');
def('C-END', 'c', 'main の終わり', 'main の閉じ括弧に達したら停止。');

// ---- 翻訳規則 (C → ASM) ----
def('T-INC', 't', 'T-INC  ⟦x++⟧', '⟦x++;⟧ = INC r(x)');
def('T-DEC', 't', 'T-DEC  ⟦x--⟧', '⟦x--;⟧ = DEC r(x)');
def('T-WHILE', 't', 'T-WHILE  ⟦while (x) S⟧',
  'L: JZ r(x), E    ; cond — 0 なら脱出\n   ⟦S⟧\n   JMP L          ; back — 先頭へ\nE:');
def('T-IF', 't', 'T-IF  ⟦if (x) S⟧', '   JZ r(x), E    ; cond\n   ⟦S⟧\nE:');
def('T-IFELSE', 't', 'T-IFELSE  ⟦if (x) S1 else S2⟧',
  '   JZ r(x), F    ; cond\n   ⟦S1⟧\n   JMP E          ; skip — else を飛ばす\nF: ⟦S2⟧\nE:');
def('T-RET', 't', 'T-RET  ⟦return;⟧', '⟦return;⟧ = HALT');
def('T-END', 't', 'T-END  main の末尾', 'main の末尾に HALT を置く');

// ---- アセンブリ ----
def('A-INC', 'asm', 'INC r', 'r ← r + 1 (mod 256)、次の行へ。');
def('A-DEC', 'asm', 'DEC r', 'r ← r − 1 (mod 256)、次の行へ。');
def('A-JZ', 'asm', 'JZ r, L', 'r = 0 ならラベル L の行へ、そうでなければ次の行へ。');
def('A-JMP', 'asm', 'JMP L', '無条件にラベル L の行へ。');
def('A-HALT', 'asm', 'HALT', '停止。');
def('A-REG', 'asm', '.reg r, n', '疑似命令。実行前にレジスタ r を n にする（機械語には現れない）。');
def('A-LABEL', 'asm', 'ラベル L:', 'L は次に置かれた命令のアドレス（0 から数えた命令番号）を表す。');

// ---- 機械語 (ISA) ----
const ISA = [
  { op: 0, name: 'HALT', fmt: '000 -- -----', rtl: 'halted ← 1（PC はそのまま）' },
  { op: 1, name: 'INC', fmt: '001 rr -----', rtl: 'R[rr] ← R[rr] + 1;  PC ← PC + 1' },
  { op: 2, name: 'DEC', fmt: '010 rr -----', rtl: 'R[rr] ← R[rr] − 1;  PC ← PC + 1' },
  { op: 3, name: 'JZ', fmt: '011 rr aaaaa', rtl: 'if R[rr] = 0 then PC ← aaaaa else PC ← PC + 1' },
  { op: 4, name: 'JMP', fmt: '100 -- aaaaa', rtl: 'PC ← aaaaa' },
  { op: 5, name: '(未定義)', fmt: '101 -- -----', rtl: '異常停止' },
  { op: 6, name: '(未定義)', fmt: '110 -- -----', rtl: '異常停止' },
  { op: 7, name: '(未定義)', fmt: '111 -- -----', rtl: '異常停止' },
];
ISA.forEach(e => def('M-' + bin(e.op, 3), 'mc', 'オペコード ' + bin(e.op, 3) + ' = ' + e.name,
  '書式 ' + e.fmt + '\n' + e.rtl, { isa: e }));
def('M-FMT', 'mc', '命令語の書式 (10bit)',
  'bit9..7 = オペコード / bit6..5 = レジスタ番号 rr (00=a 01=b 10=c 11=d) / bit4..0 = 分岐先アドレス aaaaa');

// ---- 論理回路 ----
def('G-NOT', 'circ', 'NOT', 'y = ¬a');
def('G-AND', 'circ', 'AND', 'y = a·b·…（全部 1 のとき 1）');
def('G-OR', 'circ', 'OR', 'y = a + b + …（どれか 1 なら 1）');
def('G-XOR', 'circ', 'XOR', 'y = a ⊕ b（異なれば 1）');
def('G-NOR', 'circ', 'NOR', 'y = ¬(a + b + …)');
def('G-DFF', 'circ', 'D フリップフロップ', 'クロックの立ち上がりで Q ← D。それ以外の時刻は Q を保持する。');
def('G-ROM', 'circ', 'ROM 32×10', 'I = M[PC]。行デコーダで 1 行を選び、その行の 10bit を出力する組合せ回路。');
def('G-CONST', 'circ', '定数', '常に 0 または 1。');
def('G-CLK', 'circ', 'クロック', '1 周期 = 1 命令（単一サイクル CPU）。周期の終わりの立ち上がりで全 DFF が同時に更新される。');
def('G-PROP', 'circ', '組合せ回路の伝搬', 'DFF/ROM の出力から始まり、各ゲートは入力が確定してから 1 段遅れて出力が確定する。表示の「深さ」は確定した段数。');

// ---- チューリングマシン ----
def('TM-DEF', 'tm', 'チューリングマシン M = (Q, Σ, δ, q0, F)',
  'Q: 状態の集合 / Σ = {^ * : 0 1 ] # $ _} / δ: Q×Σ → Q×Σ×{L,R} / q0 = F / 停止状態 = {HALT, HALT_ERR}。各ステップでヘッド下の記号 s と状態 q から δ(q, s) = (q′, s′, D) を引き、s′ を書いて D に動き q′ に移る。');
def('TM-TAPE', 'tm', 'テープの書式',
  '^ [:|*] 命令0 : 命令1 : … ] レジスタa # b # c # d $\n命令は機械語と同じ 10bit。* は PC の印（実行中の命令の直前の区切り）。レジスタは 8bit、左が最上位。');

/* ---------------------------------------------------------------------
 *  C コンパイラ (部分集合)
 * ------------------------------------------------------------------- */
const C_KW = new Set(['unsigned', 'char', 'int', 'void', 'while', 'if', 'else', 'return', 'register', 'uint8_t', 'signed', 'short', 'long', 'for', 'do']);

function cTokenize(src, keepTrivia) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const push = (t, v, s) => toks.push({ t, v, s, e: i });
  while (i < src.length) {
    const ch = src[i], s = i;
    if (ch === '\n') { i++; if (keepTrivia) push('ws', '\n', s); continue; }
    if (/\s/.test(ch)) { while (i < src.length && /[ \t\r]/.test(src[i])) i++; if (keepTrivia) push('ws', src.slice(s, i), s); continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; if (keepTrivia) push('com', src.slice(s, i), s); continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; if (keepTrivia) push('com', src.slice(s, i), s); continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; if (keepTrivia) push('pp', src.slice(s, i), s); continue; }
    if (/[A-Za-z_]/.test(ch)) { while (i < src.length && /\w/.test(src[i])) i++; const v = src.slice(s, i); push(C_KW.has(v) ? 'kw' : 'id', v, s); continue; }
    if (/[0-9]/.test(ch)) { while (i < src.length && /[0-9a-fA-FxXbB]/.test(src[i])) i++; push('num', src.slice(s, i), s); continue; }
    const two = src.substr(i, 2);
    if (['++', '--', '!=', '==', '+=', '-=', '>=', '<='].includes(two)) { i += 2; push('op', two, s); continue; }
    i++; push('op', ch, s);
  }
  if (!keepTrivia) toks.push({ t: 'eof', v: '', s: src.length, e: src.length });
  return toks;
}

function lineCol(src, pos) {
  let line = 1, col = 1;
  for (let i = 0; i < pos && i < src.length; i++) { if (src[i] === '\n') { line++; col = 1; } else col++; }
  return { line, col };
}

class CError extends Error { constructor(msg, pos) { super(msg); this.pos = pos; } }

function cParse(src) {
  const toks = cTokenize(src, false);
  let p = 0;
  const peek = (k = 0) => toks[p + k];
  const next = () => toks[p++];
  const is = (v, k = 0) => peek(k).v === v && peek(k).t !== 'id' || (peek(k).t === 'id' && false);
  const isv = (v, k = 0) => peek(k).v === v;
  const expect = (v, what) => { const t = next(); if (t.v !== v) throw new CError((what || ('「' + v + '」')) + ' が必要です（「' + (t.v || '終わり') + '」がありました）', t.s); return t; };
  const vars = [];      // {name, reg, init, s, e}
  const byName = {};

  function parseNum() {
    const t = next();
    if (t.t !== 'num') throw new CError('数値が必要です', t.s);
    let v = /^0x/i.test(t.v) ? parseInt(t.v.slice(2), 16) : /^0b/i.test(t.v) ? parseInt(t.v.slice(2), 2) : parseInt(t.v, 10);
    if (isNaN(v)) throw new CError('数値として読めません: ' + t.v, t.s);
    return { v, t };
  }
  function isTypeStart() { return peek().t === 'kw' && ['unsigned', 'char', 'int', 'register', 'uint8_t', 'signed', 'short', 'long'].includes(peek().v); }
  function parseDecl() {
    const st = peek().s;
    const words = [];
    while (isTypeStart()) words.push(next().v);
    const w = words.filter(x => x !== 'register').join(' ');
    if (!(w === 'unsigned char' || w === 'uint8_t')) throw new CError('8bit CPU なので変数の型は unsigned char（または uint8_t）にしてください（「' + w + '」）', st);
    for (;;) {
      const id = next();
      if (id.t !== 'id') throw new CError('変数名が必要です', id.s);
      if (byName[id.v]) throw new CError('変数 ' + id.v + ' は宣言済みです', id.s);
      if (vars.length >= 4) throw new CError('レジスタは a〜d の 4 本だけなので変数は 4 個までです', id.s);
      let init = 0, e = id.e;
      if (isv('=')) { next(); const n = parseNum(); init = n.v; e = n.t.e; if (init > 255) throw new CError('初期値は 0〜255 にしてください', n.t.s); }
      const v = { name: id.v, reg: vars.length, init, s: id.s, e };
      vars.push(v); byName[id.v] = v;
      if (isv(',')) { next(); continue; }
      expect(';');
      break;
    }
  }
  function varRef() {
    const t = next();
    if (t.t !== 'id') throw new CError('変数名が必要です', t.s);
    const v = byName[t.v];
    if (!v) throw new CError('変数 ' + t.v + ' は宣言されていません', t.s);
    return { v, t };
  }
  function parseCond() {
    // x | !x | x != 0 | x == 0 | x > 0
    let neg = false;
    if (isv('!')) { next(); neg = true; }
    const { v, t } = varRef();
    if (!neg && (isv('!=') || isv('==') || isv('>'))) {
      const op = next().v;
      const n = parseNum();
      if (n.v !== 0) throw new CError('条件は 0 との比較だけ使えます（x != 0, x == 0, x > 0）', n.t.s);
      if (op === '==') neg = true;
    }
    return { reg: v.reg, name: v.name, neg };
  }
  function parseStmt() {
    const t = peek();
    if (t.v === '{') return parseBlock();
    if (t.v === ';') { next(); return { k: 'empty', s: t.s, e: t.e }; }
    if (t.v === 'while') {
      next(); expect('(');
      const c = parseCond();
      const rp = expect(')');
      if (c.neg) throw new CError('while (x == 0) は未対応です（while (x) か while (x != 0) を使ってください）', t.s);
      const body = parseStmt();
      return { k: 'while', reg: c.reg, name: c.name, body, s: t.s, e: body.e, head: [t.s, rp.e], close: body.k === 'block' ? body.close : [body.s, body.e] };
    }
    if (t.v === 'if') {
      next(); expect('(');
      const c = parseCond();
      const rp = expect(')');
      const th = parseStmt();
      let el = null, elseKw = null;
      if (isv('else')) { const ek = next(); elseKw = [ek.s, ek.e]; el = parseStmt(); }
      const n = { k: 'if', reg: c.reg, name: c.name, s: t.s, e: (el || th).e, head: [t.s, rp.e], elseKw };
      if (c.neg) { // 脱糖: if (x==0) A else B  ≡  if (x) B else A
        n.then = el || { k: 'empty', s: rp.e, e: rp.e };
        n.else = th;
        n.sugar = 'if (' + c.name + ' == 0) A else B  ≡  if (' + c.name + ') B else A';
        if (!elseKw) n.elseKw = [th.s, th.e];
      } else { n.then = th; n.else = el; }
      return n;
    }
    if (t.v === 'return') {
      next();
      if (!isv(';')) parseNum();
      const sc = expect(';');
      return { k: 'ret', s: t.s, e: sc.e };
    }
    if (t.v === 'for' || t.v === 'do') throw new CError(t.v + ' 文は未対応です（while を使ってください）', t.s);
    if (t.v === '++' || t.v === '--') {
      next(); const { v } = varRef(); const sc = expect(';');
      return { k: t.v === '++' ? 'inc' : 'dec', reg: v.reg, name: v.name, s: t.s, e: sc.e };
    }
    if (t.t === 'id') {
      const { v } = varRef();
      const op = next();
      if (op.v === '++' || op.v === '--') { const sc = expect(';'); return { k: op.v === '++' ? 'inc' : 'dec', reg: v.reg, name: v.name, s: t.s, e: sc.e }; }
      if (op.v === '+=' || op.v === '-=') {
        const n = parseNum(); if (n.v !== 1) throw new CError('+= / -= は 1 だけ使えます', n.t.s);
        const sc = expect(';'); return { k: op.v === '+=' ? 'inc' : 'dec', reg: v.reg, name: v.name, s: t.s, e: sc.e };
      }
      if (op.v === '=') {
        const n = parseNum(); if (n.v !== 0) throw new CError('代入は x = 0; だけ使えます（この CPU には代入命令がありません）', n.t.s);
        const sc = expect(';');
        const s = t.s, e = sc.e;
        // 脱糖: x = 0;  ≡  while (x) x--;
        return { k: 'while', reg: v.reg, name: v.name, s, e, head: [s, e], close: [s, e], sugarZero: true,
          body: { k: 'dec', reg: v.reg, name: v.name, s, e, sugarZero: true } };
      }
      throw new CError('使える文: x++; x--; x = 0; while (x) …; if (x) … else …; return;', op.s);
    }
    throw new CError('ここに「' + t.v + '」は書けません', t.s);
  }
  function parseBlock() {
    const lb = expect('{');
    const body = [];
    while (isTypeStart()) parseDecl();
    while (!isv('}')) {
      if (peek().t === 'eof') throw new CError('「}」が足りません', lb.s);
      if (isTypeStart()) throw new CError('宣言はブロックの先頭に書いてください', peek().s);
      body.push(parseStmt());
    }
    const rb = next();
    return { k: 'block', body, s: lb.s, e: rb.e, close: [rb.s, rb.e] };
  }

  while (isTypeStart()) parseDecl();
  const rt = next();
  if (!(rt.v === 'void' || rt.v === 'int')) throw new CError('void main(void) { … } が必要です', rt.s);
  const mn = next();
  if (mn.v !== 'main') throw new CError('関数は main だけ書けます', mn.s);
  expect('('); if (isv('void')) next(); expect(')');
  const body = parseBlock();
  if (peek().t !== 'eof') throw new CError('main の後ろには何も書けません', peek().s);
  return { k: 'main', body, vars, s: rt.s, e: body.e, close: body.close, head: [rt.s, mn.e] };
}

// 構文木 → アセンブリ行 (各行に C の出どころと翻訳規則を付ける)
function cCompile(src) {
  const ast = cParse(src);
  const lines = []; // {text, kind:'instr'|'label'|'dir'|'com', src, role, rule}
  let uid = 0;
  const R = r => REGN[r];
  const ins = (op, args, node, role, rule, com) => lines.push({ kind: 'instr', op, args, node, role, rule, com });
  const lab = (name) => lines.push({ kind: 'label', name });
  const snip = n => src.slice(n.s, n.e).replace(/\s+/g, ' ').slice(0, 26);
  const headTxt = n => src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' ');

  lines.push({ kind: 'com', text: '; main.c から自動生成（翻訳規則 T-*）' });
  for (const v of ast.vars) lines.push({ kind: 'dir', text: '.reg  ' + R(v.reg) + ', ' + v.init, com: 'unsigned char ' + v.name + ' = ' + v.init + ';' });

  function gen(n) {
    switch (n.k) {
      case 'block': n.body.forEach(gen); break;
      case 'empty': break;
      case 'inc': ins('INC', [R(n.reg)], n, 'inc', 'T-INC', n.sugarZero ? null : snip(n)); break;
      case 'dec': ins('DEC', [R(n.reg)], n, 'dec', n.sugarZero ? 'T-WHILE' : 'T-DEC', n.sugarZero ? n.name + ' = 0 → ' + n.name + '--' : snip(n)); break;
      case 'while': {
        const id = uid++, L = 'while' + id, E = 'endw' + id;
        lab(L);
        ins('JZ', [R(n.reg), E], n, 'cond', 'T-WHILE', n.sugarZero ? n.name + ' = 0 ≡ while (' + n.name + ') ' + n.name + '--' : headTxt(n));
        gen(n.body);
        ins('JMP', [L], n, 'back', 'T-WHILE', '} → ' + L + ' へ戻る');
        lab(E);
        break;
      }
      case 'if': {
        const id = uid++;
        if (n.else) {
          const F = 'else' + id, E = 'endif' + id;
          ins('JZ', [R(n.reg), F], n, 'cond', 'T-IFELSE', n.sugar ? headTxt(n) + ' ⇒ 脱糖' : headTxt(n));
          gen(n.then);
          ins('JMP', [E], n, 'skip', 'T-IFELSE', 'else を飛ばす');
          lab(F);
          gen(n.else);
          lab(E);
        } else {
          const E = 'endif' + id;
          ins('JZ', [R(n.reg), E], n, 'cond', 'T-IF', headTxt(n));
          gen(n.then);
          lab(E);
        }
        break;
      }
      case 'ret': ins('HALT', [], n, 'halt', 'T-RET', 'return;'); break;
    }
  }
  gen(ast.body);
  ins('HALT', [], ast, 'halt', 'T-END', 'main の終わり');

  // テキスト化
  const out = [];
  const meta = [];  // 行番号 → {node, role, rule}
  let pendingLabels = [];
  for (const l of lines) {
    if (l.kind === 'label') { pendingLabels.push(l.name); continue; }
    if (l.kind === 'com') { out.push(l.text); meta.push(null); continue; }
    if (l.kind === 'dir') {
      out.push(('        ' + l.text).padEnd(30) + '; ' + l.com); meta.push(null); continue;
    }
    // 2 個以上のラベルが重なるときは前のほうを単独行に
    while (pendingLabels.length > 1) { out.push(pendingLabels.shift() + ':'); meta.push(null); }
    const lb = pendingLabels.length ? (pendingLabels.shift() + ':') : '';
    const body = l.op.padEnd(6) + l.args.join(', ');
    let t = (lb.padEnd(8) + body).padEnd(30);
    if (lb.length >= 8) t = (lb + ' ' + body).padEnd(30);
    out.push(t + '; ' + (l.com || '') + '  [' + l.rule + ']');
    meta.push({ node: l.node, role: l.role, rule: l.rule });
  }
  while (pendingLabels.length) { out.push(pendingLabels.shift() + ':'); meta.push(null); }
  return { ast, asm: out.join('\n') + '\n', meta };
}

/* ---------------------------------------------------------------------
 *  アセンブラ
 * ------------------------------------------------------------------- */
function assemble(text) {
  const lines = text.split('\n');
  const errors = [];
  const labels = {};
  const instrs = [];          // {addr, op, reg, target, targetText, line}
  const init = [0, 0, 0, 0];
  const initSet = [false, false, false, false];
  const lineAddr = new Array(lines.length).fill(-1);
  const regOf = (s, ln) => { const i = REGN.indexOf((s || '').trim().toLowerCase()); if (i < 0) errors.push({ line: ln, msg: 'レジスタは a, b, c, d のどれかです（「' + (s || '') + '」）' }); return Math.max(i, 0); };

  lines.forEach((raw, ln) => {
    let s = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '');
    let m;
    while ((m = s.match(/^\s*([A-Za-z_]\w*)\s*:/))) {
      if (labels[m[1]] !== undefined) errors.push({ line: ln, msg: 'ラベル ' + m[1] + ' が重複しています' });
      labels[m[1]] = instrs.length;
      s = s.slice(m[0].length);
    }
    s = s.trim();
    if (!s) return;
    if ((m = s.match(/^\.reg\s+([a-dA-D])\s*[,=]\s*(\w+)$/))) {
      const r = regOf(m[1], ln); const v = parseInt(m[2]);
      if (isNaN(v) || v < 0 || v > 255) errors.push({ line: ln, msg: '初期値は 0〜255 です' });
      init[r] = v & MASK; initSet[r] = true; return;
    }
    if (s[0] === '.') { errors.push({ line: ln, msg: '知らない疑似命令です: ' + s.split(/\s/)[0] }); return; }
    m = s.match(/^([A-Za-z]+)\s*(.*)$/);
    const mn = m[1].toUpperCase();
    const args = m[2] ? m[2].split(',').map(x => x.trim()).filter(x => x) : [];
    const it = { addr: instrs.length, op: mn, reg: 0, target: null, targetText: null, line: ln };
    const need = (n) => { if (args.length !== n) errors.push({ line: ln, msg: mn + ' のオペランドは ' + n + ' 個です' }); };
    switch (mn) {
      case 'INC': case 'DEC': need(1); it.reg = regOf(args[0], ln); break;
      case 'JZ': need(2); it.reg = regOf(args[0], ln); it.targetText = args[1]; break;
      case 'JMP': need(1); it.targetText = args[0]; break;
      case 'HALT': need(0); break;
      default: errors.push({ line: ln, msg: '知らない命令です: ' + mn + '（INC DEC JZ JMP HALT）' }); return;
    }
    lineAddr[ln] = instrs.length;
    instrs.push(it);
  });
  let implicitHalt = false;
  const last = instrs[instrs.length - 1];
  if (!last || !(last.op === 'HALT' || last.op === 'JMP')) {
    instrs.push({ addr: instrs.length, op: 'HALT', reg: 0, target: null, line: -1, implicit: true });
    implicitHalt = true;
  }
  if (instrs.length > MEM) errors.push({ line: 0, msg: '命令が ' + instrs.length + ' 個あります。命令メモリは ' + MEM + ' 語までです' });
  for (const it of instrs) {
    if (it.targetText == null) continue;
    const t = it.targetText;
    if (labels[t] !== undefined) it.target = labels[t];
    else if (/^\d+$/.test(t)) it.target = parseInt(t);
    else { errors.push({ line: it.line, msg: 'ラベル ' + t + ' が見つかりません' }); it.target = 0; }
    if (it.target >= instrs.length) errors.push({ line: it.line, msg: '分岐先 ' + t + ' (=' + it.target + ') がプログラムの外です' });
  }
  const words = instrs.map(it => encode(OPC[it.op], it.reg, it.target || 0));
  return { words, instrs, labels, init, initSet, lineAddr, errors, implicitHalt, lines };
}

/* ---------------------------------------------------------------------
 *  レベル 1 : C インタプリタ（構文木を直接歩く）
 *    yield は「これから実行する動作」。next() でその動作を実行する。
 * ------------------------------------------------------------------- */
class CInterp {
  constructor(ast) {
    this.ast = ast;
    this.env = {};
    ast.vars.forEach(v => this.env[v.name] = v.init);
    this.halted = false;
    this.gen = this.run();
    this.cur = this.gen.next().value;   // 保留中の動作
  }
  *exec(n, stack) {
    switch (n.k) {
      case 'block': for (const c of n.body) { if (yield* this.exec(c, stack)) return true; } return false;
      case 'empty': return false;
      case 'inc': yield { node: n, role: 'inc', def: 'C-INC', stack };
        this.env[n.name] = (this.env[n.name] + 1) & MASK; return false;
      case 'dec': yield { node: n, role: 'dec', def: n.sugarZero ? 'C-ZERO' : 'C-DEC', stack };
        this.env[n.name] = (this.env[n.name] - 1) & MASK; return false;
      case 'while': {
        const st = stack.concat([n]);
        for (;;) {
          yield { node: n, role: 'cond', def: n.sugarZero ? 'C-ZERO' : 'C-WHILE', stack: st };
          if (this.env[n.name] === 0) return false;
          if (yield* this.exec(n.body, st)) return true;
          yield { node: n, role: 'back', def: n.sugarZero ? 'C-ZERO' : 'C-WHILE', stack: st };
        }
      }
      case 'if': {
        const st = stack.concat([n]);
        yield { node: n, role: 'cond', def: 'C-IF', stack: st };
        if (this.env[n.name] !== 0) {
          if (yield* this.exec(n.then, st)) return true;
          if (n.else) yield { node: n, role: 'skip', def: 'C-IF', stack: st };
        } else if (n.else) { if (yield* this.exec(n.else, st)) return true; }
        return false;
      }
      case 'ret': yield { node: n, role: 'halt', def: 'C-RET', stack }; return true;
    }
    return false;
  }
  *run() {
    const top = [this.ast];
    const stop = yield* this.exec(this.ast.body, top);
    if (!stop) yield { node: this.ast, role: 'halt', def: 'C-END', stack: top };
    this.halted = true;
    for (;;) yield null;
  }
  step() { if (this.halted || !this.cur) return; const was = this.cur; this.cur = this.gen.next().value; if (was.role === 'halt') { this.halted = true; } }
  regs() { const r = [0, 0, 0, 0]; this.ast.vars.forEach(v => r[v.reg] = this.env[v.name]); return r; }
}

/* ---------------------------------------------------------------------
 *  レベル 2 : アセンブリ インタプリタ（ニーモニックの意味で実行）
 * ------------------------------------------------------------------- */
class AsmInterp {
  constructor(asmRes) { this.a = asmRes; this.reset(); }
  reset() { this.R = this.a.init.slice(); this.pc = 0; this.halted = false; this.err = null; this.count = new Array(this.a.instrs.length).fill(0); }
  cur() { return this.a.instrs[this.pc]; }
  step() {
    if (this.halted) return;
    const it = this.a.instrs[this.pc];
    if (!it) { this.halted = true; this.err = 'PC がプログラムの外'; return; }
    this.count[this.pc]++;
    switch (it.op) {
      case 'INC': this.R[it.reg] = (this.R[it.reg] + 1) & MASK; this.pc++; break;
      case 'DEC': this.R[it.reg] = (this.R[it.reg] - 1) & MASK; this.pc++; break;
      case 'JZ': this.pc = this.R[it.reg] === 0 ? this.a.labels[it.targetText] ?? it.target : this.pc + 1; break;
      case 'JMP': this.pc = this.a.labels[it.targetText] ?? it.target; break;
      case 'HALT': this.halted = true; break;
    }
  }
}

/* ---------------------------------------------------------------------
 *  レベル 3 : 機械語インタプリタ（オペコード表で解読）
 * ------------------------------------------------------------------- */
class McInterp {
  constructor(words, init) { this.words = words; this.init = init; this.reset(); }
  reset() { this.R = this.init.slice(); this.pc = 0; this.halted = false; this.err = null; this.trace = []; }
  fetch() { return this.pc < this.words.length ? this.words[this.pc] : 0; }
  step() {
    if (this.halted) return;
    const w = this.fetch();
    const { op, r, a } = decode(w);
    const before = this.R[r];
    const pc0 = this.pc;
    switch (op) {
      case 0: this.halted = true; break;
      case 1: this.R[r] = (this.R[r] + 1) & MASK; this.pc = (this.pc + 1) & (MEM - 1); break;
      case 2: this.R[r] = (this.R[r] - 1) & MASK; this.pc = (this.pc + 1) & (MEM - 1); break;
      case 3: this.pc = this.R[r] === 0 ? a : (this.pc + 1) & (MEM - 1); break;
      case 4: this.pc = a; break;
      default: this.halted = true; this.err = '未定義オペコード ' + bin(op, 3);
    }
    this.trace.push({ pc: pc0, w, before, after: this.R[r], r, npc: this.pc });
    if (this.trace.length > 200) this.trace.shift();
  }
}

/* ---------------------------------------------------------------------
 *  レベル 4 : ゲートレベル回路（単一サイクル CPU）
 * ------------------------------------------------------------------- */
const BLOCKS = [
  { id: 'pc', name: 'PC・停止フラグ', desc: 'プログラムカウンタ (5bit DFF) と停止フラグ HALTED' },
  { id: 'rom', name: 'ROM（命令メモリ）', desc: '32 語 × 10bit。プログラム内蔵方式: 命令はデータと同じ 2 進数として格納' },
  { id: 'dec', name: '命令デコーダ', desc: 'オペコード 3bit → one-hot の制御信号' },
  { id: 'rsel', name: 'レジスタ選択', desc: 'rr 2bit → S0..S3' },
  { id: 'rmux', name: '読み出し MUX', desc: '選ばれたレジスタを X バスへ' },
  { id: 'zero', name: 'ゼロ検出', desc: 'Z = ¬(X7+…+X0)' },
  { id: 'alu', name: 'ALU（8bit 加算器）', desc: 'Y = X + B。B = 00000001 (INC) / 11111111 (DEC)。リプルキャリー' },
  { id: 'regs', name: 'レジスタファイル', desc: 'a〜d の 4×8bit DFF と書き込み選択' },
  { id: 'pcinc', name: 'PC+1', desc: '5bit 半加算器チェーン' },
  { id: 'br', name: '分岐制御', desc: 'BR = JMP + JZ·Z / HOLD = HALT' },
  { id: 'pcmux', name: '次 PC 選択', desc: 'NPC = HOLD ? PC : (BR ? aaaaa : PC+1)' },
];

function buildCircuit() {
  const nets = [];      // {id, name, driver}
  const byName = {};
  const gates = [];     // {id, type, ins, out, outs, block, role, def}
  const net = (name) => { if (byName[name] !== undefined) return byName[name]; const id = nets.length; nets.push({ id, name, driver: -1 }); byName[name] = id; return id; };
  const G = (type, insN, outN, block, role) => {
    const ins = insN.map(n => typeof n === 'number' ? n : net(n));
    const out = net(outN);
    const g = { id: gates.length, type, ins, out, block, role, def: 'G-' + (type === 'DFF' ? 'DFF' : type.replace(/\d+$/, '')) };
    nets[out].driver = g.id;
    gates.push(g);
    return out;
  };
  const dffs = [];
  const DFF = (d, q, block, role) => { G('DFF', [d], q, block, role); dffs.push(byName[q]); };

  // 定数
  G('CONST1', [], 'ONE', 'alu', '定数 1（B0 と PC+1 の加数）');
  G('CONST0', [], 'ZERO_C', 'alu', '定数 0（c0 = 最下位への桁上げ入力）');

  // ROM
  const romOuts = []; for (let i = 0; i < IW; i++) romOuts.push(net('I' + i));
  const rom = { id: gates.length, type: 'ROM', ins: [0, 1, 2, 3, 4].map(i => net('PC' + i)), out: romOuts[0], outs: romOuts, block: 'rom', role: 'I9..I0 = M[PC]', def: 'G-ROM' };
  romOuts.forEach(o => nets[o].driver = rom.id);
  gates.push(rom);

  // 命令デコーダ
  G('NOT', ['I9'], 'nI9', 'dec', 'nI9 = ¬I9'); G('NOT', ['I8'], 'nI8', 'dec', 'nI8 = ¬I8'); G('NOT', ['I7'], 'nI7', 'dec', 'nI7 = ¬I7');
  G('AND3', ['nI9', 'nI8', 'nI7'], 'isHALT', 'dec', 'isHALT = ¬I9·¬I8·¬I7   (000)');
  G('AND3', ['nI9', 'nI8', 'I7'], 'isINC', 'dec', 'isINC = ¬I9·¬I8·I7   (001)');
  G('AND3', ['nI9', 'I8', 'nI7'], 'isDEC', 'dec', 'isDEC = ¬I9·I8·¬I7   (010)');
  G('AND3', ['nI9', 'I8', 'I7'], 'isJZ', 'dec', 'isJZ = ¬I9·I8·I7   (011)');
  G('AND3', ['I9', 'nI8', 'nI7'], 'isJMP', 'dec', 'isJMP = I9·¬I8·¬I7   (100)');
  G('OR2', ['I8', 'I7'], 'I87', 'dec', 'I87 = I8 + I7');
  G('AND2', ['I9', 'I87'], 'isBAD', 'dec', 'isBAD = I9·(I8+I7)   (101,110,111: 未定義)');

  // レジスタ選択
  G('NOT', ['I6'], 'nI6', 'rsel', 'nI6 = ¬I6'); G('NOT', ['I5'], 'nI5', 'rsel', 'nI5 = ¬I5');
  G('AND2', ['nI6', 'nI5'], 'S0', 'rsel', 'S0 = ¬I6·¬I5   (a)');
  G('AND2', ['nI6', 'I5'], 'S1', 'rsel', 'S1 = ¬I6·I5   (b)');
  G('AND2', ['I6', 'nI5'], 'S2', 'rsel', 'S2 = I6·¬I5   (c)');
  G('AND2', ['I6', 'I5'], 'S3', 'rsel', 'S3 = I6·I5   (d)');

  // 読み出し MUX
  for (let i = 0; i < W; i++) {
    const t = REGN.map((r, k) => G('AND2', ['S' + k, 'R' + r + i], 'm' + r + i, 'rmux', 'm' + r + i + ' = S' + k + '·R' + r + i));
    G('OR4', t, 'X' + i, 'rmux', 'X' + i + ' = ma' + i + ' + mb' + i + ' + mc' + i + ' + md' + i);
  }
  // ゼロ検出
  G('NOR8', [0, 1, 2, 3, 4, 5, 6, 7].map(i => 'X' + i), 'Z', 'zero', 'Z = ¬(X0+X1+…+X7)');

  // ALU: Y = X + B,  B0 = 1, Bi = isDEC (i≥1), c0 = 0
  for (let i = 0; i < W; i++) {
    const B = i === 0 ? 'ONE' : 'isDEC';
    const c = i === 0 ? 'ZERO_C' : 'c' + i;
    G('XOR2', ['X' + i, B], 'p' + i, 'alu', 'FA' + i + ': p' + i + ' = X' + i + ' ⊕ B' + i + (i ? '  (B' + i + ' = isDEC)' : '  (B0 = 1)'));
    G('XOR2', ['p' + i, c], 'Y' + i, 'alu', 'FA' + i + ': Y' + i + ' = p' + i + ' ⊕ c' + i);
    G('AND2', ['X' + i, B], 'g' + i, 'alu', 'FA' + i + ': g' + i + ' = X' + i + '·B' + i + '（生成）');
    G('AND2', ['p' + i, c], 'h' + i, 'alu', 'FA' + i + ': h' + i + ' = p' + i + '·c' + i + '（伝搬）');
    G('OR2', ['g' + i, 'h' + i], 'c' + (i + 1), 'alu', 'FA' + i + ': c' + (i + 1) + ' = g' + i + ' + h' + i + '（桁上げ）');
  }

  // レジスタファイル（書き込み）
  G('OR2', ['isINC', 'isDEC'], 'WE', 'regs', 'WE = isINC + isDEC（レジスタに書く命令）');
  REGN.forEach((r, k) => {
    G('AND2', ['WE', 'S' + k], 'WE' + r, 'regs', 'WE' + r + ' = WE·S' + k);
    G('NOT', ['WE' + r], 'nWE' + r, 'regs', 'nWE' + r + ' = ¬WE' + r);
    for (let i = 0; i < W; i++) {
      G('AND2', ['WE' + r, 'Y' + i], 'wy' + r + i, 'regs', 'D' + r + i + ' の書込側: WE' + r + '·Y' + i);
      G('AND2', ['nWE' + r, 'R' + r + i], 'wk' + r + i, 'regs', 'D' + r + i + ' の保持側: ¬WE' + r + '·R' + r + i);
      G('OR2', ['wy' + r + i, 'wk' + r + i], 'D' + r + i, 'regs', 'D' + r + i + ' = WE' + r + ' ? Y' + i + ' : R' + r + i);
    }
  });
  REGN.forEach(r => { for (let i = 0; i < W; i++) DFF('D' + r + i, 'R' + r + i, 'regs', 'R' + r + i + ' ← D' + r + i + '（クロック↑）'); });

  // PC + 1
  for (let i = 0; i < PCW; i++) {
    const k = i === 0 ? 'ONE' : 'k' + i;
    G('XOR2', ['PC' + i, k], 'P' + i, 'pcinc', 'P' + i + ' = PC' + i + ' ⊕ k' + i + (i ? '' : '  (k0 = 1)'));
    if (i < PCW - 1) G('AND2', ['PC' + i, k], 'k' + (i + 1), 'pcinc', 'k' + (i + 1) + ' = PC' + i + '·k' + i + '（桁上げ）');
  }
  // 分岐制御
  G('AND2', ['isJZ', 'Z'], 'JZZ', 'br', 'JZZ = isJZ·Z（JZ で 0 だった）');
  G('OR2', ['isJMP', 'JZZ'], 'BR', 'br', 'BR = isJMP + JZZ（分岐する）');
  G('OR2', ['isHALT', 'isBAD'], 'HOLD', 'br', 'HOLD = isHALT + isBAD（PC を止める）');
  G('NOT', ['BR'], 'nBR', 'br', 'nBR = ¬BR');
  G('NOT', ['HOLD'], 'nHOLD', 'br', 'nHOLD = ¬HOLD');
  // 次 PC
  for (let i = 0; i < PCW; i++) {
    G('AND2', ['BR', 'I' + i], 'ba' + i, 'pcmux', 'BR·aaaaa' + i);
    G('AND2', ['nBR', 'P' + i], 'bp' + i, 'pcmux', '¬BR·P' + i);
    G('OR2', ['ba' + i, 'bp' + i], 'M' + i, 'pcmux', 'M' + i + ' = BR ? I' + i + ' : P' + i);
    G('AND2', ['HOLD', 'PC' + i], 'hp' + i, 'pcmux', 'HOLD·PC' + i);
    G('AND2', ['nHOLD', 'M' + i], 'hm' + i, 'pcmux', '¬HOLD·M' + i);
    G('OR2', ['hp' + i, 'hm' + i], 'NPC' + i, 'pcmux', 'NPC' + i + ' = HOLD ? PC' + i + ' : M' + i);
  }
  for (let i = 0; i < PCW; i++) DFF('NPC' + i, 'PC' + i, 'pc', 'PC' + i + ' ← NPC' + i + '（クロック↑）');
  G('OR2', ['HALTED', 'HOLD'], 'HALT_D', 'pc', 'HALT_D = HALTED + HOLD');
  DFF('HALT_D', 'HALTED', 'pc', 'HALTED ← HALT_D（クロック↑）');

  // トポロジカル順序と深さ
  const isSrc = g => g.type === 'DFF';
  const depth = new Int16Array(nets.length);
  const order = [];
  const done = new Uint8Array(gates.length);
  const visit = (gid) => {
    if (done[gid] === 2) return; if (done[gid] === 1) throw new Error('組合せループ');
    done[gid] = 1;
    const g = gates[gid];
    if (!isSrc(g)) for (const n of g.ins) { const d = nets[n].driver; if (d >= 0 && !isSrc(gates[d])) visit(d); }
    done[gid] = 2;
    if (!isSrc(g)) order.push(gid);
  };
  gates.forEach(g => visit(g.id));
  for (const gid of order) {
    const g = gates[gid];
    let d = 0; for (const n of g.ins) d = Math.max(d, depth[n]);
    const dd = g.type === 'ROM' ? d + 2 : g.type.startsWith('CONST') ? 0 : d + 1;
    (g.outs || [g.out]).forEach(o => depth[o] = dd);
  }
  let maxDepth = 0; for (let i = 0; i < nets.length; i++) maxDepth = Math.max(maxDepth, depth[i]);
  return { nets, byName, gates, order, depth, maxDepth, dffs };
}

class Circuit {
  constructor(words, init) {
    this.C = Circuit.netlist || (Circuit.netlist = buildCircuit());
    this.words = words; this.init = init;
    this.reset();
  }
  reset() {
    const C = this.C;
    this.q = new Uint8Array(C.nets.length);      // DFF の状態（Q）
    for (let i = 0; i < PCW; i++) this.q[C.byName['PC' + i]] = 0;
    REGN.forEach((r, k) => { for (let i = 0; i < W; i++) this.q[C.byName['R' + r + i]] = (this.init[k] >> i) & 1; });
    this.cycles = 0;
    this.v = this.settle();
    this.prev = this.v.slice();
  }
  settle() {
    const C = this.C, v = new Uint8Array(C.nets.length);
    for (const n of C.dffs) v[n] = this.q[n];
    for (const gid of C.order) {
      const g = C.gates[gid], I = g.ins;
      let y = 0;
      switch (g.type) {
        case 'CONST1': y = 1; break;
        case 'CONST0': y = 0; break;
        case 'NOT': y = v[I[0]] ^ 1; break;
        case 'AND2': y = v[I[0]] & v[I[1]]; break;
        case 'AND3': y = v[I[0]] & v[I[1]] & v[I[2]]; break;
        case 'OR2': y = v[I[0]] | v[I[1]]; break;
        case 'OR4': y = v[I[0]] | v[I[1]] | v[I[2]] | v[I[3]]; break;
        case 'XOR2': y = v[I[0]] ^ v[I[1]]; break;
        case 'NOR8': { let o = 0; for (const n of I) o |= v[n]; y = o ^ 1; break; }
        case 'ROM': {
          let a = 0; I.forEach((n, k) => a |= v[n] << k);
          const w = a < this.words.length ? this.words[a] : 0;
          g.outs.forEach((o, k) => v[o] = (w >> k) & 1);
          continue;
        }
      }
      v[g.out] = y;
    }
    return v;
  }
  // クロックの立ち上がり：全 DFF が同時に Q ← D
  clock() {
    const C = this.C;
    if (this.halted()) return;
    const v = this.v;
    const nq = this.q.slice();
    for (const n of C.dffs) { const g = C.gates[C.nets[n].driver]; nq[n] = v[g.ins[0]]; }
    this.q = nq;
    this.cycles++;
    this.prev = v;
    this.v = this.settle();
  }
  val(name) { return this.v[this.C.byName[name]]; }
  bus(prefix, n, src) { const s = src || this.v; let x = 0; for (let i = 0; i < n; i++) x |= s[this.C.byName[prefix + i]] << i; return x; }
  pc() { return this.bus('PC', PCW, this.q); }
  halted() { return !!this.q[this.C.byName.HALTED]; }
  regs() { return REGN.map(r => this.bus('R' + r, W, this.q)); }
}

/* ---------------------------------------------------------------------
 *  レベル 5 : チューリングマシン
 * ------------------------------------------------------------------- */
const SIGMA = ['^', '*', ':', '0', '1', ']', '#', '$', '_'];
const PHASE = {
  fetch: { name: '命令の取り出し', cpu: 'PC の印 * を探す' },
  decode: { name: '解読', cpu: '命令デコーダ' },
  rsel: { name: 'レジスタ番号の解読', cpu: 'レジスタ選択' },
  seek: { name: 'オペランドへ移動', cpu: 'レジスタファイルの読み出し' },
  alu: { name: 'ALU（桁上げ/借り）', cpu: 'ALU 加算器' },
  zero: { name: 'ゼロ判定', cpu: 'ゼロ検出' },
  adv: { name: 'PC ← PC+1', cpu: 'PC+1 と次 PC 選択' },
  addr: { name: '分岐先の読み出し', cpu: '命令の aaaaa フィールド' },
  jump: { name: 'PC ← aaaaa（印を移動）', cpu: '次 PC 選択 (BR=1)' },
  halt: { name: '停止', cpu: 'HALTED' },
};

function buildTM() {
  const delta = new Map();
  const rules = [];
  const states = [];
  const info = {};
  const S = (q, phase, desc, grp) => { if (!info[q]) { info[q] = { q, phase, desc, grp, idx: states.length }; states.push(q); } return q; };
  const T = (q, s, q2, w, d, note) => {
    const key = q + '\u0001' + s;
    if (delta.has(key)) throw new Error('δ 重複 ' + q + ',' + s);
    const r = { id: rules.length, q, s, q2, w: w == null ? s : w, d, note: note || '' };
    delta.set(key, r); rules.push(r);
  };
  const BITS = ['0', '1'];
  const RG = REGN;

  S('F', 'fetch', '開始: PC の印 * を探して左へ', 'fetch');
  for (const s of ['0', '1', ':', ']', '#', '$']) T('F', s, 'F', null, 'L', '* を探して左へ');
  T('F', '*', 'D', null, 'R', '印を見つけた → 命令の先頭へ');
  // 解読木
  S('D', 'decode', 'オペコード bit9 を読む', 'dec');
  ['D0', 'D1'].forEach(q => S(q, 'decode', 'オペコード bit8 を読む（' + q.slice(1) + '…）', 'dec'));
  ['D00', 'D01', 'D10', 'D11'].forEach(q => S(q, 'decode', 'オペコード bit7 を読む（' + q.slice(1) + '…）', 'dec'));
  S('HALT', 'halt', '停止（HALT 命令）', 'halt');
  S('HALT_ERR', 'halt', '異常停止', 'halt');
  T('D', '0', 'D0', null, 'R', 'op=0..'); T('D', '1', 'D1', null, 'R', 'op=1..');
  T('D0', '0', 'D00', null, 'R', 'op=00.'); T('D0', '1', 'D01', null, 'R', 'op=01.');
  T('D1', '0', 'D10', null, 'R', 'op=10.'); T('D1', '1', 'D11', null, 'R', 'op=11.');
  T('D00', '0', 'HALT', null, 'R', 'op=000 → HALT');
  T('D00', '1', 'INC_R', null, 'R', 'op=001 → INC');
  T('D01', '0', 'DEC_R', null, 'R', 'op=010 → DEC');
  T('D01', '1', 'JZ_R', null, 'R', 'op=011 → JZ');
  T('D10', '0', 'JMP_S1', null, 'R', 'op=100 → JMP');
  T('D10', '1', 'HALT_ERR', null, 'R', 'op=101 未定義');
  T('D11', '0', 'HALT_ERR', null, 'R', 'op=110 未定義'); T('D11', '1', 'HALT_ERR', null, 'R', 'op=111 未定義');
  T('D', ']', 'HALT_ERR', null, 'R', 'PC がプログラムの外');

  for (const X of ['INC', 'DEC', 'JZ']) {
    S(X + '_R', 'rsel', X + ': レジスタ番号 bit6 を読む', X);
    S(X + '_R0', 'rsel', X + ': bit5 を読む（0.）', X); S(X + '_R1', 'rsel', X + ': bit5 を読む（1.）', X);
    T(X + '_R', '0', X + '_R0', null, 'R', 'rr=0.'); T(X + '_R', '1', X + '_R1', null, 'R', 'rr=1.');
    for (let r = 0; r < 4; r++) {
      const q = X + '_SEEK_' + RG[r];
      S(q, 'seek', X + ' ' + RG[r] + ': レジスタ領域 ] まで右へ', X);
      T(X + '_R' + (r >> 1), String(r & 1), q, null, 'R', 'rr=' + bin(r, 2) + ' → レジスタ ' + RG[r]);
      for (const s of ['0', '1', ':', '*']) T(q, s, q, null, 'R', '] を探して右へ');
      const tgt = r === 0 ? X + '_IN' : X + '_K' + r;
      T(q, ']', tgt, null, 'R', r === 0 ? 'レジスタ a に入った' : '# をあと ' + r + ' 個越える');
    }
    for (let k = 1; k <= 3; k++) {
      const q = X + '_K' + k;
      S(q, 'seek', X + ': # をあと ' + k + ' 個越える', X);
      for (const s of BITS) T(q, s, q, null, 'R', 'ビットを越える');
      T(q, '#', k === 1 ? X + '_IN' : X + '_K' + (k - 1), null, 'R', k === 1 ? '目的のレジスタに入った' : '# を 1 個越えた');
    }
    if (X === 'JZ') {
      S('JZ_IN', 'zero', 'JZ: レジスタに 1 が 1 つでもあるか調べる', X);
      T('JZ_IN', '0', 'JZ_IN', null, 'R', 'まだ全部 0');
      T('JZ_IN', '1', 'ADV_L', null, 'L', '1 があった → 0 でない → 分岐しない');
      T('JZ_IN', '#', 'JZ_BACK', null, 'L', '全部 0 → 分岐する');
      T('JZ_IN', '$', 'JZ_BACK', null, 'L', '全部 0 → 分岐する');
    } else {
      S(X + '_IN', 'seek', X + ': レジスタの最下位ビットへ（右端まで）', X);
      for (const s of BITS) T(X + '_IN', s, X + '_IN', null, 'R', '右端を探す');
      const A = X === 'INC' ? 'INC_C' : 'DEC_B';
      T(X + '_IN', '#', A, null, 'L', '右端 → 最下位ビットへ');
      T(X + '_IN', '$', A, null, 'L', '右端 → 最下位ビットへ');
    }
  }
  S('INC_C', 'alu', 'INC: 桁上げ 1 を左へ伝える', 'INC');
  T('INC_C', '1', 'INC_C', '0', 'L', '1+1 = 10 → 0 を書き桁上げ続行');
  T('INC_C', '0', 'ADV_L', '1', 'L', '0+1 = 1 → 桁上げ終わり');
  T('INC_C', ']', 'ADV_L', null, 'L', '最上位を越えた（mod 256 で桁あふれ）');
  T('INC_C', '#', 'ADV_L', null, 'L', '最上位を越えた（mod 256 で桁あふれ）');
  S('DEC_B', 'alu', 'DEC: 借り 1 を左へ伝える', 'DEC');
  T('DEC_B', '0', 'DEC_B', '1', 'L', '0−1 → 1 を書き借り続行');
  T('DEC_B', '1', 'ADV_L', '0', 'L', '1−1 = 0 → 借り終わり');
  T('DEC_B', ']', 'ADV_L', null, 'L', '最上位を越えた（mod 256 で 0−1 = 255）');
  T('DEC_B', '#', 'ADV_L', null, 'L', '最上位を越えた（mod 256 で 0−1 = 255）');

  S('ADV_L', 'adv', 'PC+1: 印 * まで左へ戻る', 'adv');
  for (const s of ['0', '1', ':', ']', '#', '$']) T('ADV_L', s, 'ADV_L', null, 'L', '* を探して左へ');
  T('ADV_L', '*', 'ADV_R', ':', 'R', '印を消す');
  S('ADV_R', 'adv', 'PC+1: 次の区切りに印を付ける', 'adv');
  for (const s of BITS) T('ADV_R', s, 'ADV_R', null, 'R', '命令を越える');
  T('ADV_R', ':', 'D', '*', 'R', '次の命令に印 * → 解読へ');
  T('ADV_R', ']', 'HALT_ERR', null, 'R', 'プログラムの外へ出た');

  S('JZ_BACK', 'addr', 'JZ: 0 だった → 印 * まで戻る', 'JZ');
  for (const s of ['0', '1', ':', ']', '#', '$']) T('JZ_BACK', s, 'JZ_BACK', null, 'L', '* を探して左へ');
  T('JZ_BACK', '*', 'JZ_SK5', null, 'R', '命令の先頭へ');
  for (let k = 5; k >= 1; k--) {
    S('JZ_SK' + k, 'addr', 'JZ: op と rr をあと ' + k + ' ビット読み飛ばす', 'JZ');
    for (const s of BITS) T('JZ_SK' + k, s, k === 1 ? 'RD_0_0' : 'JZ_SK' + (k - 1), null, 'R', '読み飛ばす');
  }
  S('JMP_S1', 'addr', 'JMP: rr を読み飛ばす (1/2)', 'JMP'); S('JMP_S2', 'addr', 'JMP: rr を読み飛ばす (2/2)', 'JMP');
  for (const s of BITS) { T('JMP_S1', s, 'JMP_S2', null, 'R', '読み飛ばす'); T('JMP_S2', s, 'RD_0_0', null, 'R', '読み飛ばす'); }
  // aaaaa を有限状態に読み込む
  for (let k = 0; k < 5; k++) for (let v = 0; v < (1 << k); v++) {
    const q = 'RD_' + k + '_' + v;
    S(q, 'addr', '分岐先 aaaaa を読む: ' + k + ' ビット読んだ（' + (k ? bin(v, k) : '—') + '）', 'RD');
    for (const s of BITS) {
      const v2 = v * 2 + (+s);
      if (k === 4) T(q, s, 'GOL_' + v2, null, 'L', 'aaaaa = ' + bin(v2, 5) + ' = ' + v2 + ' を状態に記憶');
      else T(q, s, 'RD_' + (k + 1) + '_' + v2, null, 'R', '次のビット');
    }
  }
  for (let v = 0; v < 32; v++) {
    const g = 'GOL_' + v, c = 'CNT_' + v;
    S(g, 'jump', '分岐先 ' + v + ' を記憶したままテープ左端 ^ へ（途中の * は消す）', 'GOL');
    for (const s of ['0', '1', ':']) T(g, s, g, null, 'L', '左端へ');
    T(g, '*', g, ':', 'L', '古い印を消す');
    T(g, '^', c, null, 'R', '左端 → 命令を数え始める');
    S(c, 'jump', 'あと ' + v + ' 命令ぶん右へ数える', 'CNT');
    for (const s of BITS) T(c, s, c, null, 'R', '命令を越える');
    if (v === 0) T(c, ':', 'D', '*', 'R', 'ここが分岐先 → 印 * を付け解読へ');
    else T(c, ':', 'CNT_' + (v - 1), null, 'R', '命令 1 つ数えた');
    T(c, ']', 'HALT_ERR', null, 'R', '分岐先がプログラムの外');
  }
  for (const r of rules) {
    def('TM-' + r.id, 'tm', 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')', r.note + '\n状態 ' + r.q + ': ' + info[r.q].desc, { rule: r });
  }
  return { delta, rules, states, info };
}

class TM {
  constructor(words, init) {
    this.M = TM.machine || (TM.machine = buildTM());
    this.words = words; this.init = init;
    this.reset();
  }
  static makeTape(words, init) {
    const t = ['^'];
    words.forEach((w, i) => { t.push(i === 0 ? '*' : ':'); for (const b of bin(w, IW)) t.push(b); });
    t.push(']');
    init.forEach((v, k) => { if (k) t.push('#'); for (const b of bin(v, W)) t.push(b); });
    t.push('$');
    for (let i = 0; i < 4; i++) t.push('_');
    return t;
  }
  reset() {
    this.tape = TM.makeTape(this.words, this.init);
    this.head = 1; this.q = 'F'; this.steps = 0; this.last = null; this.halted = false; this.err = null;
    this.hist = []; this.ruleCount = new Uint32Array(this.M.rules.length);
    this.layout();
  }
  layout() {
    // テープ上の領域（表示用、δ には使わない）
    this.progEnd = this.tape.indexOf(']');
    this.regStart = [];
    let p = this.progEnd + 1;
    for (let k = 0; k < 4; k++) { this.regStart.push(p); p += W + 1; }
  }
  rule() { return this.M.delta.get(this.q + '\u0001' + this.tape[this.head]); }
  step() {
    if (this.halted) return null;
    const r = this.rule();
    if (!r) { this.halted = true; this.err = 'δ(' + this.q + ', ' + this.tape[this.head] + ') が未定義'; this.q = 'HALT_ERR'; return null; }
    const prevQ = this.q;
    this.tape[this.head] = r.w;
    this.head += r.d === 'R' ? 1 : -1;
    if (this.head >= this.tape.length) this.tape.push('_');
    this.q = r.q2;
    this.steps++;
    this.last = r;
    this.ruleCount[r.id]++;
    this.hist.push({ r: r.id, step: this.steps });
    if (this.hist.length > 64) this.hist.shift();
    if (r.q2 === 'HALT' || r.q2 === 'HALT_ERR') { this.halted = true; if (r.q2 === 'HALT_ERR') this.err = r.note; }
    return { r, boundary: (r.q2 === 'D' && prevQ !== 'F') || this.halted };
  }
  regs() { return this.regStart.map(s => parseInt(this.tape.slice(s, s + W).join(''), 2)); }
  pc() {
    let n = -1;
    for (let i = 1; i < this.progEnd; i++) { const c = this.tape[i]; if (c === ':' || c === '*') { n++; if (c === '*') return n; } }
    return -1;
  }
  // 現在の命令が終わるまでのステップ数を下見する（テープを複製して空回し）
  lookahead() {
    if (this.halted) return 0;
    const saveT = this.tape.slice(), saveH = this.head, saveQ = this.q;
    let n = 0; const D = this.M.delta;
    let t = saveT, h = saveH, q = saveQ;
    for (;;) {
      const r = D.get(q + '\u0001' + t[h]);
      if (!r) { n++; break; }
      const pq = q;
      t[h] = r.w; h += r.d === 'R' ? 1 : -1; if (h >= t.length) t.push('_');
      q = r.q2; n++;
      if ((q === 'D' && pq !== 'F') || q === 'HALT' || q === 'HALT_ERR') break;
      if (n > 1e6) break;
    }
    return n;
  }
}

/* ---------------------------------------------------------------------
 *  5 層の同期実行
 * ------------------------------------------------------------------- */
function buildProgram(source, mode) {
  // mode: 'c' (C から) | 'asm' (アセンブリから)
  const res = { mode, errors: [] };
  if (mode === 'c') {
    try {
      const comp = cCompile(source);
      res.c = { src: source, ast: comp.ast, meta: comp.meta };
      res.asmText = comp.asm;
    } catch (e) {
      if (e instanceof CError) { const lc = lineCol(source, e.pos); res.errors.push({ level: 'c', line: lc.line - 1, col: lc.col, msg: e.message }); return res; }
      throw e;
    }
  } else { res.asmText = source; res.c = null; }
  const as = assemble(res.asmText);
  res.asm = as;
  as.errors.forEach(e => res.errors.push({ level: 'asm', line: e.line, msg: e.msg }));
  if (res.errors.length) return res;
  // C の変数とアセンブリのレジスタ初期値を一致させる
  if (res.c) { res.c.ast.vars.forEach(v => { as.init[v.reg] = v.init; }); }
  // 行 → C 対応表
  if (res.c) as.instrs.forEach(it => { it.meta = it.line >= 0 ? res.c.meta[it.line] : null; });
  res.words = as.words;
  res.init = as.init;
  res.ok = true;
  return res;
}

class Sim {
  constructor(prog) {
    this.prog = prog;
    this.reset();
  }
  reset() {
    const P = this.prog;
    this.cI = P.c ? new CInterp(P.c.ast) : null;
    this.aI = new AsmInterp(P.asm);
    this.mI = new McInterp(P.words, P.init);
    this.ck = new Circuit(P.words, P.init);
    this.tm = new TM(P.words, P.init);
    this.instr = 0;              // 実行済み命令数
    this.p = 0;                  // 現在の命令の進み具合 [0,1)
    this.segN = this.tm.lookahead();
    this.segDone = 0;
    this.halted = false;
    this.check = this.verify();
    this.log = [];
    this.lastCommit = null;
  }
  // 現在の命令（各層が「いまやっていること」）
  current() {
    const a = this.aI.cur();
    return { addr: this.mI.pc, word: this.mI.fetch(), asm: a, c: this.cI ? this.cI.cur : null };
  }
  // 進捗を進める（TM はステップ数で比例配分）
  advance(dp) {
    if (this.halted) return 0;
    let commits = 0;
    this.p += dp;
    let guard = 0;
    while (!this.halted && guard++ < 10000) {
      const target = Math.min(this.segN, Math.floor(this.p * this.segN));
      while (this.segDone < target && !this.tm.halted) { this.tm.step(); this.segDone++; }
      if (this.p >= 1) { this.p -= 1; this.commit(); commits++; } else break;
    }
    return commits;
  }
  // TM を 1 ステップだけ進め、他の層はその割合ぶんだけ進める
  microStep() {
    if (this.halted) return;
    if (this.segDone < this.segN) { this.tm.step(); this.segDone++; }
    this.p = this.segDone / this.segN;
    if (this.segDone >= this.segN) { this.p = 0; this.commit(); }
  }
  stepInstr() { if (!this.halted) { this.p = 1; this.advance(0); this.p = 0; } }
  commit() {
    // 1) TM: この命令の残りステップ
    while (this.segDone < this.segN && !this.tm.halted) { this.tm.step(); this.segDone++; }
    const before = { pc: this.mI.pc, word: this.mI.fetch(), asm: this.aI.cur(), c: this.cI ? this.cI.cur : null, regs: this.mI.R.slice() };
    // 2) 回路: クロック立ち上がり
    this.ck.clock();
    // 3) 機械語
    this.mI.step();
    // 4) アセンブリ
    this.aI.step();
    // 5) C
    if (this.cI) this.cI.step();
    this.instr++;
    this.lastCommit = before;
    this.check = this.verify(before);
    this.halted = this.mI.halted;
    this.segN = this.tm.lookahead();
    this.segDone = 0;
    if (this.halted) this.p = 0;
  }
  verify(before) {
    const L = [];
    const R = {
      asm: this.aI.R, mc: this.mI.R, circ: this.ck.regs(), tm: this.tm.regs(),
    };
    if (this.cI) R.c = this.cI.regs();
    const PCs = { asm: this.aI.pc, mc: this.mI.pc, circ: this.ck.pc(), tm: this.tm.halted ? this.mI.pc : this.tm.pc() };
    const H = { asm: this.aI.halted, mc: this.mI.halted, circ: this.ck.halted(), tm: this.tm.halted };
    if (this.cI) H.c = this.cI.halted;
    const ref = R.mc;
    const bad = [];
    for (const k in R) for (let i = 0; i < 4; i++) {
      // C は宣言された変数だけ比べる
      if (k === 'c' && !this.prog.c.ast.vars.some(v => v.reg === i)) continue;
      if (R[k][i] !== ref[i]) bad.push(k + ' のレジスタ ' + REGN[i] + ' = ' + R[k][i] + '（機械語では ' + ref[i] + '）');
    }
    for (const k in PCs) if (PCs[k] !== PCs.mc) bad.push(k + ' の PC = ' + PCs[k] + '（機械語では ' + PCs.mc + '）');
    for (const k in H) if (H[k] !== H.mc) bad.push(k + ' の停止状態が違う');
    // C の動作とアセンブリ行の対応
    if (this.cI && before && before.asm && before.asm.meta && before.c) {
      const m = before.asm.meta;
      if (m.node !== before.c.node || m.role !== before.c.role) bad.push('C の動作（' + before.c.role + '）と命令の出どころ（' + m.role + '）が違う');
    }
    if (this.tm.err && !this.mI.err) bad.push('TM: ' + this.tm.err);
    return { ok: bad.length === 0, bad, R, PCs, H };
  }
}

const api = { W, MASK, PCW, MEM, IW, REGN, OPN, OPC, ISA, DEFS, BLOCKS, PHASE, SIGMA,
  bin, encode, decode, disasm, cTokenize, cParse, cCompile, CError, lineCol, assemble,
  CInterp, AsmInterp, McInterp, Circuit, TM, buildProgram, Sim, buildCircuit, buildTM };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CPU5 = api;
})(typeof window !== 'undefined' ? window : globalThis);
