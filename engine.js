/* =====================================================================
 *  CPU 5 層エンジン v2
 *    C  →  アセンブリ  →  機械語  →  論理回路  →  チューリングマシン
 *  5 つは同じプログラムをそれぞれ「独立した定義」で実行する。
 *  - C        : 構文木を C の意味論で解釈
 *  - ASM      : ニーモニックの意味で解釈
 *  - 機械語    : 16bit 語をオペコード表で解読して実行
 *  - 回路      : ゲートのネットリスト（単一サイクル CPU）を評価
 *  - TM       : 遷移関数 δ だけでテープを書き換える
 *  命令 1 つごとに状態を突き合わせ、一致を確認する。
 * ===================================================================== */
(function (root) {
'use strict';

const W = 8, MASK = 255;          // データ幅
const PCW = 6, MEM = 64;          // 命令メモリ 64 語
const IW = 16;                    // 命令語 16bit = op4 r3 s3 a6
const NREG = 8;
const REGN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const bin = (v, n) => (v >>> 0).toString(2).padStart(n, '0').slice(-n);
const ISA = [
  { op: 0, name: 'HALT', args: '', rtl: 'halted ← 1（PC はそのまま）' },
  { op: 1, name: 'INC', args: 'r', rtl: 'R[r] ← R[r] + 1;  PC ← PC + 1' },
  { op: 2, name: 'DEC', args: 'r', rtl: 'R[r] ← R[r] − 1;  PC ← PC + 1' },
  { op: 3, name: 'JZ', args: 'ra', rtl: 'if R[r] = 0 then PC ← a else PC ← PC + 1' },
  { op: 4, name: 'JMP', args: 'a', rtl: 'PC ← a' },
  { op: 5, name: 'ADD', args: 'rs', rtl: 'R[r] ← R[r] + R[s];  C ← 桁上げ;  PC ← PC + 1' },
  { op: 6, name: 'SUB', args: 'rs', rtl: 'R[r] ← R[r] − R[s];  C ← 借り (R[r] < R[s]);  PC ← PC + 1' },
  { op: 7, name: 'MOV', args: 'rs', rtl: 'R[r] ← R[s];  PC ← PC + 1' },
  { op: 8, name: 'SHR', args: 'r', rtl: 'R[r] ← R[r] >> 1;  C ← 元の最下位ビット;  PC ← PC + 1' },
  { op: 9, name: 'JC', args: 'a', rtl: 'if C = 1 then PC ← a else PC ← PC + 1' },
  { op: 10, name: 'JNC', args: 'a', rtl: 'if C = 0 then PC ← a else PC ← PC + 1' },
  { op: 11, name: 'JNZ', args: 'ra', rtl: 'if R[r] ≠ 0 then PC ← a else PC ← PC + 1' },
  { op: 12, name: '(未定義)', args: '', rtl: '異常停止' },
  { op: 13, name: '(未定義)', args: '', rtl: '異常停止' },
  { op: 14, name: '(未定義)', args: '', rtl: '異常停止' },
  { op: 15, name: '(未定義)', args: '', rtl: '異常停止' },
];
const OPC = {}; ISA.forEach(e => { if (e.op < 12) OPC[e.name] = e.op; });
const encode = (op, r, s, a) => ((op & 15) << 12) | ((r & 7) << 9) | ((s & 7) << 6) | (a & 63);
const decode = w => ({ op: (w >> 12) & 15, r: (w >> 9) & 7, s: (w >> 6) & 7, a: w & 63 });
const disasm = w => {
  const { op, r, s, a } = decode(w), e = ISA[op];
  if (op >= 12) return '??? (' + bin(op, 4) + ')';
  const p = [];
  for (const k of e.args) p.push(k === 'r' ? REGN[r] : k === 's' ? REGN[s] : String(a));
  return e.name + (p.length ? ' ' + p.join(', ') : '');
};

/* ---------------------------------------------------------------------
 *  定義レジストリ
 * ------------------------------------------------------------------- */
const DEFS = {};
function def(id, level, title, body, extra) { DEFS[id] = Object.assign({ id, level, title, body }, extra || {}); return id; }

// ---- C の意味論 ----
def('C-VAR', 'c', '変数宣言 → レジスタ割り当て',
  '`unsigned char x = n;` は 8bit の符号なし整数。宣言順に a, b, c, … のレジスタへ割り当てる（最大 8 個。比較などに作業用レジスタを 1 本使うときは 7 個まで）。初期値はレジスタの初期値。');
def('C-ARITH', 'c', '符号なし 8bit の算術',
  '+ − << の結果は 2^8 = 256 で割った余り（C11 N1570 6.2.5p9 / 6.3.1.3p2）。>> は切り捨ての 2 での割り算。');
def('C-INC', 'c', 'x++ / x += k', 'x ← (x + k) mod 256');
def('C-DEC', 'c', 'x-- / x -= k', 'x ← (x − k) mod 256');
def('C-ASG', 'c', '代入 x = 式', '右辺を計算して x に入れる。式は 定数 / 変数 / 変数 ± 変数 / 変数 ± 定数 / 変数 >> k / 変数 << k。結果は mod 256。');
def('C-WHILE', 'c', 'while (条件) S', '条件を評価し、真（0 以外）なら S を実行して先頭へ。偽なら抜ける（C11 6.8.5.1）。while (1) は条件を調べない無限ループ。');
def('C-IF', 'c', 'if (条件) S1 else S2', '条件が真なら S1、偽なら S2（C11 6.8.4.1）。');
def('C-COND', 'c', '条件式', 'x（≠0）, !x, x == 0, x != 0, x > 0, x <  y, x <= y, x > y, x >= y, x == y, x != y。比較は符号なしの大小。');
def('C-BREAK', 'c', 'break;', '一番内側の while から抜ける（C11 6.8.6.3）。');
def('C-RET', 'c', 'return;', 'main から戻る = プログラム停止。');
def('C-END', 'c', 'main の終わり', 'main の閉じ括弧に達したら停止。');

// ---- 翻訳規則 ----
def('T-INC', 't', 'T-INC  ⟦x += k⟧', 'INC x を k 回');
def('T-DEC', 't', 'T-DEC  ⟦x -= k⟧', 'DEC x を k 回');
def('T-CLR', 't', 'T-CLR  ⟦x = 0⟧', 'SUB x, x        ; x − x = 0');
def('T-CONST', 't', 'T-CONST  ⟦x = k⟧', 'SUB x, x\nINC x を k 回   ; 即値命令が無いので 1 ずつ数える');
def('T-MOV', 't', 'T-MOV  ⟦x = y⟧', 'MOV x, y');
def('T-ADD', 't', 'T-ADD  ⟦x = y + z⟧', 'MOV x, y        ; x が y なら省略\nADD x, z');
def('T-SUB', 't', 'T-SUB  ⟦x = y − z⟧', 'MOV x, y        ; x が y なら省略\nSUB x, z\n（x が z と同じなら作業用 t を使う: MOV t,y; SUB t,z; MOV x,t）');
def('T-SHR', 't', 'T-SHR  ⟦x = y >> k⟧', 'MOV x, y\nSHR x を k 回');
def('T-SHL', 't', 'T-SHL  ⟦x = y << k⟧', 'MOV x, y\nADD x, x を k 回   ; 2 倍 = 自分自身を足す');
def('T-WHILE', 't', 'T-WHILE  ⟦while (c) S⟧', 'L: ⟦c が偽なら E へ⟧\n   ⟦S⟧\n   JMP L\nE:');
def('T-IF', 't', 'T-IF  ⟦if (c) S⟧', '   ⟦c が偽なら E へ⟧\n   ⟦S⟧\nE:');
def('T-IFELSE', 't', 'T-IFELSE  ⟦if (c) S1 else S2⟧', '   ⟦c が偽なら F へ⟧\n   ⟦S1⟧\n   JMP E\nF: ⟦S2⟧\nE:');
def('T-BREAK', 't', 'T-BREAK  ⟦break⟧', 'JMP (一番内側の while の出口)');
def('T-RET', 't', 'T-RET  ⟦return⟧', 'HALT');
def('T-END', 't', 'T-END  main の末尾', 'HALT');
def('T-NZ', 't', 'T-NZ  ⟦x が偽なら L へ⟧', 'JZ x, L');
def('T-Z', 't', 'T-Z  ⟦x == 0 が偽なら L へ⟧', 'JNZ x, L');
def('T-LT', 't', 'T-LT  ⟦x < y が偽なら L へ⟧', 'MOV t, x\nSUB t, y        ; C = 1 ⇔ x < y（借りが出た）\nJNC L');
def('T-GE', 't', 'T-GE  ⟦x >= y が偽なら L へ⟧', 'MOV t, x\nSUB t, y\nJC L');
def('T-GT', 't', 'T-GT  ⟦x > y が偽なら L へ⟧', 'MOV t, y\nSUB t, x        ; C = 1 ⇔ y < x\nJNC L');
def('T-LE', 't', 'T-LE  ⟦x <= y が偽なら L へ⟧', 'MOV t, y\nSUB t, x\nJC L');
def('T-EQ', 't', 'T-EQ  ⟦x == y が偽なら L へ⟧', 'MOV t, x\nSUB t, y        ; 等しければ t = 0\nJNZ t, L');
def('T-NE', 't', 'T-NE  ⟦x != y が偽なら L へ⟧', 'MOV t, x\nSUB t, y\nJZ t, L');

// ---- アセンブリ ----
const A_TXT = {
  HALT: '停止。', INC: 'r ← r + 1 (mod 256)。C は変えない。', DEC: 'r ← r − 1 (mod 256)。C は変えない。',
  JZ: 'r = 0 ならラベル L へ、でなければ次の行へ。', JMP: '無条件にラベル L へ。',
  ADD: 'r ← r + s (mod 256)。256 以上になったら C = 1（桁上げ）、ならなければ C = 0。', SUB: 'r ← r − s (mod 256)。r < s なら C = 1（借り）、でなければ C = 0。',
  MOV: 'r ← s。', SHR: 'r ← r を右へ 1 ビットずらす（÷2 の切り捨て）。はみ出た最下位ビットを C へ。',
  JC: 'C = 1 なら L へ。', JNC: 'C = 0 なら L へ。', JNZ: 'r ≠ 0 なら L へ。',
};
const A_SYN = { HALT: 'HALT', INC: 'INC r', DEC: 'DEC r', JZ: 'JZ r, L', JMP: 'JMP L', ADD: 'ADD r, s', SUB: 'SUB r, s', MOV: 'MOV r, s', SHR: 'SHR r', JC: 'JC L', JNC: 'JNC L', JNZ: 'JNZ r, L' };
for (const k in A_TXT) def('A-' + k, 'asm', A_SYN[k], A_TXT[k]);
def('A-REG', 'asm', '.reg r, n', '疑似命令。実行前にレジスタ r を n にする（ローダーが設定。機械語には現れない）。');
def('A-LABEL', 'asm', 'ラベル L:', 'L は次に置かれた命令のアドレス（0 から数えた命令番号）を表す。');

// ---- 機械語 ----
ISA.forEach(e => def('M-' + bin(e.op, 4), 'mc', 'オペコード ' + bin(e.op, 4) + ' = ' + e.name, e.rtl, { isa: e }));
def('M-FMT', 'mc', '命令語の書式 (16bit)',
  'bit15..12 = オペコード oooo / bit11..9 = r / bit8..6 = s / bit5..0 = 分岐先アドレス aaaaaa\nレジスタ番号 000=a 001=b … 111=h。フラグ C は 1 ビット。');

// ---- 論理回路 ----
def('G-NOT', 'circ', 'NOT', 'y = ¬a');
def('G-AND', 'circ', 'AND', 'y = a·b·…（全部 1 のとき 1）');
def('G-OR', 'circ', 'OR', 'y = a + b + …（どれか 1 なら 1）');
def('G-XOR', 'circ', 'XOR', 'y = a ⊕ b（異なれば 1）');
def('G-NOR', 'circ', 'NOR', 'y = ¬(a + b + …)');
def('G-DFF', 'circ', 'D フリップフロップ', 'クロックの立ち上がりで Q ← D。それ以外の時刻は Q を保持する。');
def('G-ROM', 'circ', 'ROM 64×16', 'I = M[PC]。行デコーダで 1 行を選び、その行の 16bit を出力する組合せ回路。');
def('G-CONST', 'circ', '定数', '常に 0 または 1。');
def('G-CLK', 'circ', 'クロック', '1 周期 = 1 命令（単一サイクル CPU）。周期の終わりの立ち上がりで全 DFF が同時に更新される。');
def('G-PROP', 'circ', '組合せ回路の伝搬', 'DFF/ROM の出力から始まり、各ゲートは入力が確定してから 1 段遅れて出力が確定する。');

/* ---------------------------------------------------------------------
 *  C コンパイラ（部分集合）
 * ------------------------------------------------------------------- */
const C_KW = new Set(['unsigned', 'char', 'int', 'void', 'while', 'if', 'else', 'return', 'register', 'uint8_t', 'signed', 'short', 'long', 'for', 'do', 'break', 'continue']);
const OPS3 = ['>>=', '<<='];
const OPS2 = ['++', '--', '!=', '==', '+=', '-=', '>=', '<=', '>>', '<<', '&&', '||'];

function cTokenize(src, keepTrivia) {
  const toks = [];
  let i = 0;
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
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (OPS3.includes(three)) { i += 3; push('op', three, s); continue; }
    if (OPS2.includes(two)) { i += 2; push('op', two, s); continue; }
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
  const isv = (v, k = 0) => peek(k).v === v && peek(k).t !== 'num';
  const expect = (v, what) => { const t = next(); if (t.v !== v) throw new CError((what || ('「' + v + '」')) + ' が必要です（「' + (t.v || '終わり') + '」がありました）', t.s); return t; };
  const vars = [], byName = {};
  let loopDepth = 0;

  function parseNum() {
    const t = next();
    if (t.t !== 'num') throw new CError('数値が必要です', t.s);
    const v = /^0x/i.test(t.v) ? parseInt(t.v.slice(2), 16) : /^0b/i.test(t.v) ? parseInt(t.v.slice(2), 2) : parseInt(t.v, 10);
    if (isNaN(v)) throw new CError('数値として読めません: ' + t.v, t.s);
    return { v, t };
  }
  const isTypeStart = () => peek().t === 'kw' && ['unsigned', 'char', 'int', 'register', 'uint8_t', 'signed', 'short', 'long'].includes(peek().v);
  function parseDecl() {
    const st = peek().s, words = [];
    while (isTypeStart()) words.push(next().v);
    const w = words.filter(x => x !== 'register').join(' ');
    if (!(w === 'unsigned char' || w === 'uint8_t')) throw new CError('8bit CPU なので変数の型は unsigned char（または uint8_t）にしてください（「' + w + '」）', st);
    for (;;) {
      const id = next();
      if (id.t !== 'id') throw new CError('変数名が必要です', id.s);
      if (byName[id.v]) throw new CError('変数 ' + id.v + ' は宣言済みです', id.s);
      if (vars.length >= NREG) throw new CError('レジスタは 8 本なので変数は 8 個までです', id.s);
      let init = 0, e = id.e;
      if (isv('=')) { next(); const n = parseNum(); init = n.v; e = n.t.e; if (init > 255) throw new CError('初期値は 0〜255 にしてください', n.t.s); }
      const v = { name: id.v, reg: vars.length, init, s: id.s, e };
      vars.push(v); byName[id.v] = v;
      if (isv(',')) { next(); continue; }
      expect(';'); break;
    }
  }
  function varRef() {
    const t = next();
    if (t.t !== 'id') throw new CError('変数名が必要です（「' + t.v + '」）', t.s);
    const v = byName[t.v];
    if (!v) throw new CError('変数 ' + t.v + ' は宣言されていません', t.s);
    return v;
  }
  function operand() {
    if (peek().t === 'num') return { t: 'num', v: parseNum().v };
    return { t: 'var', v: varRef() };
  }
  function parseCond() {
    const s0 = peek().s;
    if (peek().t === 'num') { const n = parseNum(); if (n.v === 0) throw new CError('条件 0 は常に偽なので使えません', n.t.s); return { k: 'true', s: s0 }; }
    if (isv('!')) { next(); return { k: 'z', a: varRef() }; }
    const a = varRef();
    const rel = ['==', '!=', '<', '>', '<=', '>='];
    if (!rel.includes(peek().v)) return { k: 'nz', a };
    const op = next().v;
    if (peek().t === 'num') {
      const n = parseNum();
      if (n.v !== 0) throw new CError('定数との比較は 0 だけです。他の数は変数に入れて比べてください', n.t.s);
      if (op === '==') return { k: 'z', a };
      if (op === '!=' || op === '>') return { k: 'nz', a };
      throw new CError('符号なしなので x ' + op + ' 0 は常に同じ結果です', n.t.s);
    }
    const b = varRef();
    return { k: { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' }[op], a, b };
  }
  // 単純文 → 代入ノード {k:'asg', dst, expr, form}
  function simple(t) {
    if (t.v === '++' || t.v === '--') { next(); const v = varRef(); return asg(v, { t: 'bin', op: t.v[0], a: { t: 'var', v }, b: { t: 'num', v: 1 } }, t.v + v.name); }
    const v = varRef();
    const op = next();
    if (op.v === '++' || op.v === '--') return asg(v, { t: 'bin', op: op.v[0], a: { t: 'var', v }, b: { t: 'num', v: 1 } }, v.name + op.v);
    if (['+=', '-=', '>>=', '<<='].includes(op.v)) {
      const b = operand();
      if ((op.v === '>>=' || op.v === '<<=') && b.t !== 'num') throw new CError('シフト量は定数にしてください', op.s);
      return asg(v, { t: 'bin', op: op.v.slice(0, -1), a: { t: 'var', v }, b }, null);
    }
    if (op.v === '=') {
      const a = operand();
      if (['+', '-', '>>', '<<'].includes(peek().v)) {
        const o = next().v;
        const b = operand();
        if (a.t === 'num') throw new CError('左側は変数にしてください（例: x = y + 1）', op.s);
        if ((o === '>>' || o === '<<') && b.t !== 'num') throw new CError('シフト量は定数にしてください', op.s);
        return asg(v, { t: 'bin', op: o, a, b }, null);
      }
      return asg(v, a, null);
    }
    throw new CError('使える文: x++; x--; x = 式; x += y; x -= y; x >>= k; x <<= k; while; if; break; return;', op.s);
  }
  function asg(dst, expr) { return { k: 'asg', dst, expr }; }
  function parseStmt() {
    const t = peek();
    if (t.v === '{') return parseBlock();
    if (t.v === ';') { next(); return { k: 'empty', s: t.s, e: t.e }; }
    if (t.v === 'while' || t.v === 'for') {
      next(); expect('(');
      let c;
      if (t.v === 'for') { expect(';'); expect(';'); c = { k: 'true' }; }
      else c = parseCond();
      const rp = expect(')');
      loopDepth++;
      const body = parseStmt();
      loopDepth--;
      return { k: 'while', c, body, s: t.s, e: body.e, head: [t.s, rp.e], close: body.k === 'block' ? body.close : [body.s, body.e] };
    }
    if (t.v === 'if') {
      next(); expect('(');
      const c = parseCond();
      const rp = expect(')');
      const th = parseStmt();
      let el = null, elseKw = null;
      if (isv('else')) { const ek = next(); elseKw = [ek.s, ek.e]; el = parseStmt(); }
      return { k: 'if', c, then: th, else: el, s: t.s, e: (el || th).e, head: [t.s, rp.e], elseKw };
    }
    if (t.v === 'break') { next(); const sc = expect(';'); if (!loopDepth) throw new CError('break は while の中でだけ使えます', t.s); return { k: 'brk', s: t.s, e: sc.e }; }
    if (t.v === 'return') { next(); if (!isv(';')) parseNum(); const sc = expect(';'); return { k: 'ret', s: t.s, e: sc.e }; }
    if (t.v === 'do' || t.v === 'continue') throw new CError(t.v + ' は未対応です', t.s);
    if (t.t === 'id' || t.v === '++' || t.v === '--') {
      const n = simple(t);
      const sc = expect(';');
      n.s = t.s; n.e = sc.e;
      return n;
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

const MAXK = 8;
function cCompile(src) {
  const ast = cParse(src);
  const R = r => REGN[r];
  const used = ast.vars.length;
  let temp = -1;
  const T = (n) => { if (temp < 0) { if (used >= NREG) throw new CError('比較や引き算に作業用レジスタが 1 本必要です。変数を 7 個以下にしてください', n.s); temp = used; } return temp; };
  const lines = [];
  let uid = 0;
  const snip = n => src.slice(n.s, n.e).replace(/\s+/g, ' ');
  // 1 つの動作（node, role）の命令列をまとめて出す
  function emit(node, role, rule, list, com) {
    node.n = node.n || {};
    node.n[role] = list.length;
    list.forEach((x, i) => lines.push({ kind: 'instr', op: x[0], args: x.slice(1), node, role, rule: x.rule || rule, idx: i, cnt: list.length, com: i === 0 ? com : '' }));
  }
  const lab = name => lines.push({ kind: 'label', name });
  const rep = (k, f) => { const o = []; for (let i = 0; i < k; i++) o.push(f()); return o; };
  const ckK = (k, n) => { if (k > MAXK) throw new CError('定数は ' + MAXK + ' までです（即値命令が無いので 1 ずつ数えます）。大きい数は初期値つきの変数に入れてください', n.s); return k; };

  function genAsg(n) {
    const x = n.dst.reg, e = n.expr, X = R(x);
    let list = [], rule;
    const mov = (y) => (y === x ? [] : [['MOV', X, R(y)]]);
    if (e.t === 'num') {
      if (e.v === 0) { list = [['SUB', X, X]]; rule = 'T-CLR'; }
      else { ckK(e.v, n); list = [['SUB', X, X]].concat(rep(e.v, () => ['INC', X])); rule = 'T-CONST'; }
    } else if (e.t === 'var') { list = mov(e.v.reg); rule = 'T-MOV'; }
    else {
      const a = e.a.v.reg, b = e.b;
      if (e.op === '+') {
        if (b.t === 'num') { ckK(b.v, n); list = mov(a).concat(rep(b.v, () => ['INC', X])); rule = 'T-INC'; }
        else if (x === b.v.reg) { list = [['ADD', X, R(a)]]; rule = 'T-ADD'; }
        else { list = mov(a).concat([['ADD', X, R(b.v.reg)]]); rule = 'T-ADD'; }
      } else if (e.op === '-') {
        if (b.t === 'num') { ckK(b.v, n); list = mov(a).concat(rep(b.v, () => ['DEC', X])); rule = 'T-DEC'; }
        else if (x === b.v.reg && x !== a) { const t = R(T(n)); list = [['MOV', t, R(a)], ['SUB', t, R(b.v.reg)], ['MOV', X, t]]; rule = 'T-SUB'; }
        else { list = mov(a).concat([['SUB', X, R(b.v.reg)]]); rule = 'T-SUB'; }
      } else if (e.op === '>>') { ckK(b.v, n); list = mov(a).concat(rep(b.v, () => ['SHR', X])); rule = 'T-SHR'; }
      else if (e.op === '<<') { ckK(b.v, n); list = mov(a).concat(rep(b.v, () => ['ADD', X, X])); rule = 'T-SHL'; }
    }
    emit(n, 'asg', rule, list, snip(n));
  }
  // 条件が偽なら L へ跳ぶ命令列
  function genCond(node, c, L, com) {
    const A = c.a ? R(c.a.reg) : null, B = c.b ? R(c.b.reg) : null;
    let list = [], rule;
    switch (c.k) {
      case 'true': list = []; rule = 'T-WHILE'; break;
      case 'nz': list = [['JZ', A, L]]; rule = 'T-NZ'; break;
      case 'z': list = [['JNZ', A, L]]; rule = 'T-Z'; break;
      default: {
        const t = R(T(node));
        const sw = c.k === 'gt' || c.k === 'le';
        list = [['MOV', t, sw ? B : A], ['SUB', t, sw ? A : B]];
        const j = { lt: ['JNC', L], ge: ['JC', L], gt: ['JNC', L], le: ['JC', L], eq: ['JNZ', t, L], ne: ['JZ', t, L] }[c.k];
        list.push(j);
        rule = { lt: 'T-LT', ge: 'T-GE', gt: 'T-GT', le: 'T-LE', eq: 'T-EQ', ne: 'T-NE' }[c.k];
      }
    }
    emit(node, 'cond', rule, list, com);
  }
  const loops = [];
  function gen(n) {
    switch (n.k) {
      case 'block': n.body.forEach(gen); break;
      case 'empty': break;
      case 'asg': genAsg(n); break;
      case 'while': {
        const id = uid++, L = 'while' + id, E = 'endw' + id;
        n.labels = { L, E };
        lab(L);
        genCond(n, n.c, E, src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' '));
        loops.push(E);
        gen(n.body);
        loops.pop();
        emit(n, 'back', 'T-WHILE', [['JMP', L]], '} → ' + L + ' へ戻る');
        lab(E);
        break;
      }
      case 'if': {
        const id = uid++;
        const hd = src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' ');
        if (n.else) {
          const F = 'else' + id, E = 'endif' + id;
          genCond(n, n.c, F, hd);
          gen(n.then);
          emit(n, 'skip', 'T-IFELSE', [['JMP', E]], 'else を飛ばす');
          lab(F); gen(n.else); lab(E);
        } else {
          const E = 'endif' + id;
          genCond(n, n.c, E, hd);
          gen(n.then);
          lab(E);
        }
        break;
      }
      case 'brk': emit(n, 'brk', 'T-BREAK', [['JMP', loops[loops.length - 1]]], 'break'); break;
      case 'ret': emit(n, 'halt', 'T-RET', [['HALT']], 'return;'); break;
    }
  }
  gen(ast.body);
  emit(ast, 'halt', 'T-END', [['HALT']], 'main の終わり');
  ast.temp = temp;

  const out = ['; main.c から自動生成（翻訳規則 T-*）'], meta = [null];
  for (const v of ast.vars) { out.push(('        .reg  ' + R(v.reg) + ', ' + v.init).padEnd(32) + '; unsigned char ' + v.name + ' = ' + v.init + ';'); meta.push(null); }
  if (temp >= 0) { out.push(('        ; ' + R(temp) + ' は作業用（比較・一時計算）').padEnd(32)); meta.push(null); }
  let pend = [];
  for (const l of lines) {
    if (l.kind === 'label') { pend.push(l.name); continue; }
    while (pend.length > 1) { out.push(pend.shift() + ':'); meta.push(null); }
    const lb = pend.length ? pend.shift() + ':' : '';
    const body = l.op.padEnd(6) + l.args.join(', ');
    const t = lb.length >= 8 ? (lb + ' ' + body).padEnd(32) : (lb.padEnd(8) + body).padEnd(32);
    out.push(t + (l.com || l.idx === 0 ? '; ' + (l.com || '') + '  [' + l.rule + ']' : '; 〃'));
    meta.push({ node: l.node, role: l.role, rule: l.rule, idx: l.idx, cnt: l.cnt, last: l.idx === l.cnt - 1 });
  }
  while (pend.length) { out.push(pend.shift() + ':'); meta.push(null); }
  return { ast, asm: out.join('\n') + '\n', meta };
}

/* ---------------------------------------------------------------------
 *  アセンブラ
 * ------------------------------------------------------------------- */
function assemble(text) {
  const lines = text.split('\n');
  const errors = [], labels = {}, instrs = [];
  const init = new Array(NREG).fill(0);
  const lineAddr = new Array(lines.length).fill(-1);
  const regOf = (s, ln) => { const i = REGN.indexOf((s || '').trim().toLowerCase()); if (i < 0) errors.push({ line: ln, msg: 'レジスタは a〜h のどれかです（「' + (s || '') + '」）' }); return Math.max(i, 0); };
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
    if ((m = s.match(/^\.reg\s+([a-hA-H])\s*[,=]\s*(\w+)$/))) {
      const r = regOf(m[1], ln), v = parseInt(m[2]);
      if (isNaN(v) || v < 0 || v > 255) errors.push({ line: ln, msg: '初期値は 0〜255 です' });
      init[r] = v & MASK; return;
    }
    if (s[0] === '.') { errors.push({ line: ln, msg: '知らない疑似命令です: ' + s.split(/\s/)[0] }); return; }
    m = s.match(/^([A-Za-z]+)\s*(.*)$/);
    if (!m) { errors.push({ line: ln, msg: '読めません: ' + s }); return; }
    const mn = m[1].toUpperCase();
    const args = m[2] ? m[2].split(',').map(x => x.trim()).filter(x => x) : [];
    if (OPC[mn] === undefined) { errors.push({ line: ln, msg: '知らない命令です: ' + mn + '（' + Object.keys(OPC).join(' ') + '）' }); return; }
    const sig = ISA[OPC[mn]].args;
    if (args.length !== sig.length) errors.push({ line: ln, msg: mn + ' のオペランドは ' + sig.length + ' 個です（' + A_SYN[mn] + '）' });
    const it = { addr: instrs.length, op: mn, r: 0, s: 0, target: null, targetText: null, line: ln };
    [...sig].forEach((k, i) => { if (k === 'r') it.r = regOf(args[i], ln); else if (k === 's') it.s = regOf(args[i], ln); else it.targetText = args[i]; });
    lineAddr[ln] = instrs.length;
    instrs.push(it);
  });
  let implicitHalt = false;
  const last = instrs[instrs.length - 1];
  if (!last || !(last.op === 'HALT' || last.op === 'JMP')) { instrs.push({ addr: instrs.length, op: 'HALT', r: 0, s: 0, line: -1, implicit: true }); implicitHalt = true; }
  if (instrs.length > MEM) errors.push({ line: 0, msg: '命令が ' + instrs.length + ' 個あります。命令メモリは ' + MEM + ' 語までです' });
  for (const it of instrs) {
    if (it.targetText == null) continue;
    const t = it.targetText;
    if (labels[t] !== undefined) it.target = labels[t];
    else if (/^\d+$/.test(t)) it.target = parseInt(t);
    else { errors.push({ line: it.line, msg: 'ラベル ' + t + ' が見つかりません' }); it.target = 0; }
    if (it.target >= instrs.length) errors.push({ line: it.line, msg: '分岐先 ' + t + ' (=' + it.target + ') がプログラムの外です' });
  }
  const words = instrs.map(it => encode(OPC[it.op], it.r, it.s, it.target || 0));
  return { words, instrs, labels, init, lineAddr, errors, implicitHalt, lines };
}

/* ---------------------------------------------------------------------
 *  レベル 1 : C インタプリタ
 *    yield は「これから実行する動作」。動作 1 つは命令 n 個ぶん（n は翻訳結果の長さ）。
 * ------------------------------------------------------------------- */
class CInterp {
  constructor(ast) {
    this.ast = ast;
    this.env = {};
    ast.vars.forEach(v => this.env[v.name] = v.init);
    this.halted = false;
    this.gen = this.run();
    this.cur = this.gen.next().value;
  }
  val(o) { return o.t === 'num' ? o.v : this.env[o.v.name]; }
  evalExpr(e) {
    if (e.t !== 'bin') return this.val(e) & MASK;
    const a = this.val(e.a), b = this.val(e.b);
    switch (e.op) { case '+': return (a + b) & MASK; case '-': return (a - b) & MASK; case '>>': return (a >> b) & MASK; case '<<': return (a << b) & MASK; }
  }
  test(c) {
    const a = c.a ? this.env[c.a.name] : 0, b = c.b ? this.env[c.b.name] : 0;
    switch (c.k) { case 'true': return true; case 'nz': return a !== 0; case 'z': return a === 0; case 'lt': return a < b; case 'gt': return a > b; case 'le': return a <= b; case 'ge': return a >= b; case 'eq': return a === b; case 'ne': return a !== b; }
  }
  *ev(node, role, def, stack) { if (node.n && node.n[role] > 0) yield { node, role, def, stack, cnt: node.n[role] }; }
  // 戻り値: undefined | 'brk' | 'ret'
  *exec(n, stack) {
    switch (n.k) {
      case 'block': for (const c of n.body) { const r = yield* this.exec(c, stack); if (r) return r; } return;
      case 'empty': return;
      case 'asg': yield* this.ev(n, 'asg', 'C-ASG', stack); this.env[n.dst.name] = this.evalExpr(n.expr); return;
      case 'while': {
        const st = stack.concat([n]);
        for (;;) {
          yield* this.ev(n, 'cond', 'C-WHILE', st);
          if (!this.test(n.c)) return;
          const r = yield* this.exec(n.body, st);
          if (r === 'brk') return;
          if (r === 'ret') return r;
          yield* this.ev(n, 'back', 'C-WHILE', st);
        }
      }
      case 'if': {
        const st = stack.concat([n]);
        yield* this.ev(n, 'cond', 'C-IF', st);
        if (this.test(n.c)) {
          const r = yield* this.exec(n.then, st); if (r) return r;
          if (n.else) yield* this.ev(n, 'skip', 'C-IF', st);
        } else if (n.else) { const r = yield* this.exec(n.else, st); if (r) return r; }
        return;
      }
      case 'brk': yield* this.ev(n, 'brk', 'C-BREAK', stack); return 'brk';
      case 'ret': yield* this.ev(n, 'halt', 'C-RET', stack); return 'ret';
    }
  }
  *run() {
    const top = [this.ast];
    const r = yield* this.exec(this.ast.body, top);
    if (r !== 'ret') yield* this.ev(this.ast, 'halt', 'C-END', top);
    this.halted = true;
    for (;;) yield null;
  }
  step() { if (this.halted || !this.cur) return; const was = this.cur; this.cur = this.gen.next().value; if (was.role === 'halt') this.halted = true; }
  regs() { const r = new Array(NREG).fill(0); this.ast.vars.forEach(v => r[v.reg] = this.env[v.name]); return r; }
}

/* ---------------------------------------------------------------------
 *  レベル 2 : アセンブリ インタプリタ
 * ------------------------------------------------------------------- */
class AsmInterp {
  constructor(asmRes) { this.a = asmRes; this.reset(); }
  reset() { this.R = this.a.init.slice(); this.C = 0; this.pc = 0; this.halted = false; this.count = new Array(this.a.instrs.length).fill(0); }
  cur() { return this.a.instrs[this.pc]; }
  tgt(it) { return this.a.labels[it.targetText] ?? it.target; }
  step() {
    if (this.halted) return;
    const it = this.a.instrs[this.pc];
    if (!it) { this.halted = true; return; }
    this.count[this.pc]++;
    const R = this.R, r = it.r, s = it.s;
    let next = this.pc + 1;
    switch (it.op) {
      case 'INC': R[r] = (R[r] + 1) & MASK; break;
      case 'DEC': R[r] = (R[r] - 1) & MASK; break;
      case 'ADD': { const t = R[r] + R[s]; this.C = t > MASK ? 1 : 0; R[r] = t & MASK; break; }
      case 'SUB': { this.C = R[r] < R[s] ? 1 : 0; R[r] = (R[r] - R[s]) & MASK; break; }
      case 'MOV': R[r] = R[s]; break;
      case 'SHR': this.C = R[r] & 1; R[r] >>= 1; break;
      case 'JZ': if (R[r] === 0) next = this.tgt(it); break;
      case 'JNZ': if (R[r] !== 0) next = this.tgt(it); break;
      case 'JC': if (this.C) next = this.tgt(it); break;
      case 'JNC': if (!this.C) next = this.tgt(it); break;
      case 'JMP': next = this.tgt(it); break;
      case 'HALT': this.halted = true; next = this.pc; break;
    }
    this.pc = next;
  }
}

/* ---------------------------------------------------------------------
 *  レベル 3 : 機械語インタプリタ
 * ------------------------------------------------------------------- */
class McInterp {
  constructor(words, init) { this.words = words; this.init = init; this.reset(); }
  reset() { this.R = this.init.slice(); this.C = 0; this.pc = 0; this.halted = false; this.err = null; this.trace = []; }
  fetch() { return this.pc < this.words.length ? this.words[this.pc] : 0; }
  step() {
    if (this.halted) return;
    const w = this.fetch(), { op, r, s, a } = decode(w), R = this.R;
    const pc0 = this.pc, before = R[r], c0 = this.C;
    let npc = (this.pc + 1) & (MEM - 1);
    switch (op) {
      case 0: this.halted = true; npc = this.pc; break;
      case 1: R[r] = (R[r] + 1) & MASK; break;
      case 2: R[r] = (R[r] - 1) & MASK; break;
      case 3: if (R[r] === 0) npc = a; break;
      case 4: npc = a; break;
      case 5: { const t = R[r] + R[s]; this.C = t >> 8; R[r] = t & MASK; break; }
      case 6: { const t = R[r] - R[s]; this.C = t < 0 ? 1 : 0; R[r] = t & MASK; break; }
      case 7: R[r] = R[s]; break;
      case 8: this.C = R[r] & 1; R[r] = R[r] >> 1; break;
      case 9: if (this.C) npc = a; break;
      case 10: if (!this.C) npc = a; break;
      case 11: if (R[r] !== 0) npc = a; break;
      default: this.halted = true; npc = this.pc; this.err = '未定義オペコード ' + bin(op, 4);
    }
    this.pc = npc;
    this.trace.push({ pc: pc0, w, r, before, after: R[r], c0, c1: this.C, npc });
    if (this.trace.length > 200) this.trace.shift();
  }
}

/* ---------------------------------------------------------------------
 *  レベル 4 : ゲートレベル回路（単一サイクル CPU）
 * ------------------------------------------------------------------- */
const BLOCKS = [
  { id: 'pc', name: 'PC・フラグ', desc: 'プログラムカウンタ (6bit DFF)、停止フラグ HALTED、桁上げフラグ C' },
  { id: 'rom', name: 'ROM（命令メモリ）', desc: '64 語 × 16bit。プログラム内蔵方式: 命令はデータと同じ 2 進数として格納' },
  { id: 'dec', name: '命令デコーダ', desc: 'オペコード 4bit → one-hot の制御信号' },
  { id: 'rsel', name: 'r 選択', desc: 'r 3bit → SR0..SR7（書き込み先・X 側）' },
  { id: 'ssel', name: 's 選択', desc: 's 3bit → SS0..SS7（W 側）' },
  { id: 'rmux', name: '読み出し X', desc: 'X = R[r]（8 入力 MUX × 8bit）' },
  { id: 'smux', name: '読み出し W', desc: 'W = R[s]（8 入力 MUX × 8bit）' },
  { id: 'zero', name: 'ゼロ検出', desc: 'Z = ¬(X7+…+X0)' },
  { id: 'alu', name: 'ALU', desc: 'Σ = X + B + cin。B = 1 (INC) / 11111111 (DEC) / W (ADD) / ¬W, cin=1 (SUB)。結果 Y = Σ / W (MOV) / X>>1 (SHR)' },
  { id: 'regs', name: 'レジスタファイル', desc: 'a〜h の 8×8bit DFF と書き込み選択' },
  { id: 'pcinc', name: 'PC+1', desc: '6bit 半加算器チェーン' },
  { id: 'br', name: '分岐・フラグ制御', desc: 'BR = JMP + JZ·Z + JNZ·¬Z + JC·C + JNC·¬C / HOLD = HALT / C の次の値' },
  { id: 'pcmux', name: '次 PC 選択', desc: 'NPC = HOLD ? PC : (BR ? aaaaaa : PC+1)' },
];

function buildCircuit() {
  const nets = [], byName = {}, gates = [];
  const net = name => { if (byName[name] !== undefined) return byName[name]; const id = nets.length; nets.push({ id, name, driver: -1 }); byName[name] = id; return id; };
  const G = (type, insN, outN, block, role) => {
    const ins = insN.map(n => typeof n === 'number' ? n : net(n));
    const out = net(outN);
    const base = type.replace(/\d+$/, '');
    const g = { id: gates.length, type, base, ins, out, block, role, def: 'G-' + (base === 'CONST' ? 'CONST' : base) };
    nets[out].driver = g.id; gates.push(g);
    return out;
  };
  const dffs = [];
  const DFF = (d, q, block, role) => { G('DFF', [d], q, block, role); dffs.push(byName[q]); };
  const OPN = ['HALT', 'INC', 'DEC', 'JZ', 'JMP', 'ADD', 'SUB', 'MOV', 'SHR', 'JC', 'JNC', 'JNZ'];

  G('CONST1', [], 'ONE', 'alu', '定数 1');
  G('CONST0', [], 'ZERO_C', 'alu', '定数 0');
  // ROM
  const romOuts = []; for (let i = 0; i < IW; i++) romOuts.push(net('I' + i));
  const rom = { id: gates.length, type: 'ROM', base: 'ROM', ins: [0, 1, 2, 3, 4, 5].map(i => net('PC' + i)), out: romOuts[0], outs: romOuts, block: 'rom', role: 'I15..I0 = M[PC]', def: 'G-ROM' };
  romOuts.forEach(o => nets[o].driver = rom.id); gates.push(rom);
  // 命令デコーダ (I15..I12)
  for (let i = 12; i < 16; i++) G('NOT', ['I' + i], 'nI' + i, 'dec', 'nI' + i + ' = ¬I' + i);
  OPN.forEach((nm, op) => {
    const b = bin(op, 4);
    const ins = [15, 14, 13, 12].map((bit, k) => (b[k] === '1' ? 'I' : 'nI') + bit);
    G('AND4', ins, 'is' + nm, 'dec', 'is' + nm + ' = ' + ins.map(x => x[0] === 'n' ? '¬' + x.slice(1) : x).join('·') + '   (' + b + ')');
  });
  G('AND2', ['I15', 'I14'], 'isBAD', 'dec', 'isBAD = I15·I14   (11xx: 未定義)');
  // r / s 選択
  const sel = (blk, pre, hi) => {
    for (let i = hi - 2; i <= hi; i++) G('NOT', ['I' + i], 'nI' + i, blk, 'nI' + i + ' = ¬I' + i);
    for (let k = 0; k < 8; k++) {
      const b = bin(k, 3);
      const ins = [hi, hi - 1, hi - 2].map((bit, j) => (b[j] === '1' ? 'I' : 'nI') + bit);
      G('AND3', ins, pre + k, blk, pre + k + ' = ' + ins.map(x => x[0] === 'n' ? '¬' + x.slice(1) : x).join('·') + '   (' + REGN[k] + ')');
    }
  };
  sel('rsel', 'SR', 11); sel('ssel', 'SS', 8);
  // 読み出し MUX
  for (let i = 0; i < W; i++) {
    const tx = REGN.map((r, k) => G('AND2', ['SR' + k, 'R' + r + i], 'x' + r + i, 'rmux', 'x' + r + i + ' = SR' + k + '·R' + r + i));
    G('OR8', tx, 'X' + i, 'rmux', 'X' + i + ' = Σ_k SRk·Rk' + i);
    const tw = REGN.map((r, k) => G('AND2', ['SS' + k, 'R' + r + i], 'w' + r + i, 'smux', 'w' + r + i + ' = SS' + k + '·R' + r + i));
    G('OR8', tw, 'W' + i, 'smux', 'W' + i + ' = Σ_k SSk·Rk' + i);
  }
  G('NOR8', [0, 1, 2, 3, 4, 5, 6, 7].map(i => 'X' + i), 'Z', 'zero', 'Z = ¬(X0+X1+…+X7)');
  // ALU
  for (let i = 0; i < W; i++) {
    G('NOT', ['W' + i], 'nW' + i, 'alu', 'nW' + i + ' = ¬W' + i);
    G('AND2', ['isADD', 'W' + i], 'bA' + i, 'alu', 'B' + i + ' の ADD 側: isADD·W' + i);
    G('AND2', ['isSUB', 'nW' + i], 'bS' + i, 'alu', 'B' + i + ' の SUB 側: isSUB·¬W' + i);
    G(i === 0 ? 'OR4' : 'OR3', i === 0 ? ['bA0', 'bS0', 'isDEC', 'isINC'] : ['bA' + i, 'bS' + i, 'isDEC'], 'B' + i, 'alu',
      'B' + i + ' = isADD·W' + i + ' + isSUB·¬W' + i + ' + isDEC' + (i === 0 ? ' + isINC' : ''));
    const c = i === 0 ? 'isSUB' : 'c' + i;
    G('XOR2', ['X' + i, 'B' + i], 'p' + i, 'alu', 'FA' + i + ': p' + i + ' = X' + i + ' ⊕ B' + i);
    G('XOR2', ['p' + i, c], 'u' + i, 'alu', 'FA' + i + ': Σ' + i + ' = p' + i + ' ⊕ ' + (i ? 'c' + i : 'cin (= isSUB)'));
    G('AND2', ['X' + i, 'B' + i], 'g' + i, 'alu', 'FA' + i + ': g' + i + ' = X' + i + '·B' + i);
    G('AND2', ['p' + i, c], 'h' + i, 'alu', 'FA' + i + ': h' + i + ' = p' + i + '·' + (i ? 'c' + i : 'cin'));
    G('OR2', ['g' + i, 'h' + i], 'c' + (i + 1), 'alu', 'FA' + i + ': c' + (i + 1) + ' = g' + i + ' + h' + i);
  }
  G('OR2', ['isMOV', 'isSHR'], 'nonA', 'alu', 'nonA = isMOV + isSHR（加算器の結果を使わない）');
  G('NOT', ['nonA'], 'useS', 'alu', 'useS = ¬nonA');
  for (let i = 0; i < W; i++) {
    G('AND2', ['useS', 'u' + i], 'ys' + i, 'alu', 'Y' + i + ' の Σ 側');
    G('AND2', ['isMOV', 'W' + i], 'ym' + i, 'alu', 'Y' + i + ' の MOV 側: isMOV·W' + i);
    if (i < 7) G('AND2', ['isSHR', 'X' + (i + 1)], 'yh' + i, 'alu', 'Y' + i + ' の SHR 側: isSHR·X' + (i + 1));
    G(i < 7 ? 'OR3' : 'OR2', i < 7 ? ['ys' + i, 'ym' + i, 'yh' + i] : ['ys' + i, 'ym' + i], 'Y' + i, 'alu', 'Y' + i + ' = 結果の選択');
  }
  // レジスタファイル
  G('OR6', ['isINC', 'isDEC', 'isADD', 'isSUB', 'isMOV', 'isSHR'], 'WE', 'regs', 'WE = INC+DEC+ADD+SUB+MOV+SHR（レジスタに書く命令）');
  REGN.forEach((r, k) => {
    G('AND2', ['WE', 'SR' + k], 'WE' + r, 'regs', 'WE' + r + ' = WE·SR' + k);
    G('NOT', ['WE' + r], 'nWE' + r, 'regs', 'nWE' + r + ' = ¬WE' + r);
    for (let i = 0; i < W; i++) {
      G('AND2', ['WE' + r, 'Y' + i], 'wy' + r + i, 'regs', 'D' + r + i + ' 書込側: WE' + r + '·Y' + i);
      G('AND2', ['nWE' + r, 'R' + r + i], 'wk' + r + i, 'regs', 'D' + r + i + ' 保持側: ¬WE' + r + '·R' + r + i);
      G('OR2', ['wy' + r + i, 'wk' + r + i], 'D' + r + i, 'regs', 'D' + r + i + ' = WE' + r + ' ? Y' + i + ' : R' + r + i);
    }
  });
  REGN.forEach(r => { for (let i = 0; i < W; i++) DFF('D' + r + i, 'R' + r + i, 'regs', 'R' + r + i + ' ← D' + r + i + '（クロック↑）'); });
  // PC+1
  for (let i = 0; i < PCW; i++) {
    const k = i === 0 ? 'ONE' : 'k' + i;
    G('XOR2', ['PC' + i, k], 'P' + i, 'pcinc', 'P' + i + ' = PC' + i + ' ⊕ k' + i);
    if (i < PCW - 1) G('AND2', ['PC' + i, k], 'k' + (i + 1), 'pcinc', 'k' + (i + 1) + ' = PC' + i + '·k' + i);
  }
  // 分岐・フラグ制御
  G('NOT', ['Z'], 'nZ', 'br', 'nZ = ¬Z');
  G('NOT', ['CF'], 'nCF', 'br', 'nCF = ¬C');
  G('AND2', ['isJZ', 'Z'], 'tJZ', 'br', 'tJZ = isJZ·Z');
  G('AND2', ['isJNZ', 'nZ'], 'tJNZ', 'br', 'tJNZ = isJNZ·¬Z');
  G('AND2', ['isJC', 'CF'], 'tJC', 'br', 'tJC = isJC·C');
  G('AND2', ['isJNC', 'nCF'], 'tJNC', 'br', 'tJNC = isJNC·¬C');
  G('OR5', ['isJMP', 'tJZ', 'tJNZ', 'tJC', 'tJNC'], 'BR', 'br', 'BR = JMP + tJZ + tJNZ + tJC + tJNC（分岐する）');
  G('OR2', ['isHALT', 'isBAD'], 'HOLD', 'br', 'HOLD = isHALT + isBAD（PC を止める）');
  G('NOT', ['BR'], 'nBR', 'br', 'nBR = ¬BR');
  G('NOT', ['HOLD'], 'nHOLD', 'br', 'nHOLD = ¬HOLD');
  G('NOT', ['c8'], 'nc8', 'br', 'nc8 = ¬c8（引き算の借り）');
  G('AND2', ['isADD', 'c8'], 'fA', 'br', 'fA = isADD·c8（足し算の桁上げ）');
  G('AND2', ['isSUB', 'nc8'], 'fS', 'br', 'fS = isSUB·¬c8（借り = X < W）');
  G('AND2', ['isSHR', 'X0'], 'fH', 'br', 'fH = isSHR·X0（はみ出たビット）');
  G('OR3', ['isADD', 'isSUB', 'isSHR'], 'fW', 'br', 'fW = ADD+SUB+SHR（C を書き換える命令）');
  G('NOT', ['fW'], 'nfW', 'br', 'nfW = ¬fW');
  G('AND2', ['nfW', 'CF'], 'fK', 'br', 'fK = ¬fW·C（保持）');
  G('OR4', ['fA', 'fS', 'fH', 'fK'], 'C_D', 'br', 'C_D = fA + fS + fH + fK（C の次の値）');
  // 次 PC
  for (let i = 0; i < PCW; i++) {
    G('AND2', ['BR', 'I' + i], 'ba' + i, 'pcmux', 'BR·a' + i);
    G('AND2', ['nBR', 'P' + i], 'bp' + i, 'pcmux', '¬BR·P' + i);
    G('OR2', ['ba' + i, 'bp' + i], 'M' + i, 'pcmux', 'M' + i + ' = BR ? I' + i + ' : P' + i);
    G('AND2', ['HOLD', 'PC' + i], 'hp' + i, 'pcmux', 'HOLD·PC' + i);
    G('AND2', ['nHOLD', 'M' + i], 'hm' + i, 'pcmux', '¬HOLD·M' + i);
    G('OR2', ['hp' + i, 'hm' + i], 'NPC' + i, 'pcmux', 'NPC' + i + ' = HOLD ? PC' + i + ' : M' + i);
  }
  for (let i = 0; i < PCW; i++) DFF('NPC' + i, 'PC' + i, 'pc', 'PC' + i + ' ← NPC' + i + '（クロック↑）');
  G('OR2', ['HALTED', 'HOLD'], 'HALT_D', 'pc', 'HALT_D = HALTED + HOLD');
  DFF('HALT_D', 'HALTED', 'pc', 'HALTED ← HALT_D（クロック↑）');
  DFF('C_D', 'CF', 'pc', 'C ← C_D（クロック↑）');

  const isSrc = g => g.type === 'DFF';
  const depth = new Int16Array(nets.length), order = [], done = new Uint8Array(gates.length);
  const visit = gid => {
    if (done[gid] === 2) return; if (done[gid] === 1) throw new Error('組合せループ: ' + gates[gid].role);
    done[gid] = 1;
    const g = gates[gid];
    if (!isSrc(g)) for (const n of g.ins) { const d = nets[n].driver; if (d < 0) throw new Error('未接続 ' + nets[n].name); if (!isSrc(gates[d])) visit(d); }
    done[gid] = 2;
    if (!isSrc(g)) order.push(gid);
  };
  gates.forEach(g => visit(g.id));
  for (const gid of order) {
    const g = gates[gid];
    let d = 0; for (const n of g.ins) d = Math.max(d, depth[n]);
    const dd = g.type === 'ROM' ? d + 2 : g.base === 'CONST' ? 0 : d + 1;
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
    this.q = new Uint8Array(C.nets.length);
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
      switch (g.base) {
        case 'CONST': y = g.type === 'CONST1' ? 1 : 0; break;
        case 'NOT': y = v[I[0]] ^ 1; break;
        case 'AND': y = 1; for (const n of I) y &= v[n]; break;
        case 'OR': y = 0; for (const n of I) y |= v[n]; break;
        case 'XOR': y = v[I[0]] ^ v[I[1]]; break;
        case 'NOR': y = 0; for (const n of I) y |= v[n]; y ^= 1; break;
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
  clock() {
    const C = this.C;
    if (this.halted()) return;
    const v = this.v, nq = this.q.slice();
    for (const n of C.dffs) { const g = C.gates[C.nets[n].driver]; nq[n] = v[g.ins[0]]; }
    this.q = nq; this.cycles++; this.prev = v; this.v = this.settle();
  }
  val(name) { return this.v[this.C.byName[name]]; }
  bus(prefix, n, src) { const s = src || this.v; let x = 0; for (let i = 0; i < n; i++) x |= s[this.C.byName[prefix + i]] << i; return x; }
  pc() { return this.bus('PC', PCW, this.q); }
  flagC() { return this.q[this.C.byName.CF]; }
  halted() { return !!this.q[this.C.byName.HALTED]; }
  regs() { return REGN.map(r => this.bus('R' + r, W, this.q)); }
}

/* ---------------------------------------------------------------------
 *  レベル 5 : チューリングマシン
 *    印（マーカー）方式: レジスタの区切り # を T / S / B に書き換えて
 *    「どのレジスタを操作するか」をテープ上に置き、状態は少数に保つ。
 * ------------------------------------------------------------------- */
const SIGMA = ['^', '*', ':', '0', '1', 'x', 'y', ']', '#', 'T', 'S', 'B', '!', '$', '_'];
const SYMI = {}; SIGMA.forEach((s, i) => SYMI[s] = i);
const PHASE = {
  fetch: { name: '命令の取り出し', cpu: 'PC が指す命令を読む' },
  decode: { name: '解読', cpu: '命令デコーダ' },
  operand: { name: 'オペランド指定', cpu: 'r / s 選択と読み出し MUX' },
  alu: { name: '演算', cpu: 'ALU' },
  test: { name: '条件判定', cpu: 'ゼロ検出・分岐制御' },
  flag: { name: 'フラグ', cpu: '桁上げフラグ C' },
  clean: { name: '後片付け', cpu: '（TM 特有: 印を消す）' },
  adv: { name: 'PC ← PC+1', cpu: 'PC+1 と次 PC 選択' },
  jump: { name: 'PC ← aaaaaa', cpu: '次 PC 選択 (BR=1)' },
  halt: { name: '停止', cpu: 'HALTED' },
};
// TM の擬似コード（状態はどれかの行に属する）
const TM_CODE = [
  { id: 'fetch', ph: 'fetch', text: 'loop:  左へ進んで PC の印 * を探す', why: 'CPU の「PC が指す命令を取り出す」。TM には番地で直接読む仕組みが無いので、実行中の命令の直前に * を置き、それを探しに行く。' },
  { id: 'dec1', ph: 'decode', text: '  op ← * の右の 4 ビットを読む（解読 1）', why: '4 ビットを 1 つずつ読み、読んだ値ごとに別の状態へ進む（状態の二分木）。4 段読み終えた時点で、どの状態にいるかが op そのもの。' },
  { id: 'markT', ph: 'operand', text: '  r ← 次の 3 ビット; レジスタ r の区切り # を T に書き換える', why: 'r は 0〜7 の 8 通りなので有限状態で覚えられる。レジスタ領域で # を r 個飛ばし、r+1 個目を T にする。こうすると以後は「T を探す」だけでよく、r を覚え続ける必要がない（状態数が増えない）。' },
  { id: 'markS', ph: 'operand', text: '  （2 オペランド）s ← その次の 3 ビット; レジスタ s の区切りを S に（T と同じなら B に）', why: 'ADD/SUB/MOV は 2 つのレジスタを使う。もう 1 つの印 S で 2 本目を指す。r = s のときは 1 つの区切りに 2 つの役割が重なるので B（Both）にする。' },
  { id: 'dec2', ph: 'decode', text: '  * に戻り op をもう一度読む（解読 2）', why: '印を付けている間は op を状態に持っていない（持つと状態数が 8〜64 倍になる）。そこで命令をもう一度読み直して、今度は実行する処理へ振り分ける。' },
  { id: 'inc', ph: 'alu', text: '  INC: T の右端（最下位）から 1→0 を書きつつ左へ、0 を 1 にしたら終わり', why: '2 進数の +1 は「下から続く 1 を全部 0 にし、最初の 0 を 1 にする」。桁上げが続いている間は同じ状態に留まる = 状態が桁上げ 1 ビットを覚えている。' },
  { id: 'dec', ph: 'alu', text: '  DEC: T の右端から 0→1 を書きつつ左へ、1 を 0 にしたら終わり', why: '−1 は「下から続く 0 を全部 1 にし、最初の 1 を 0 にする」（借りの伝搬）。' },
  { id: 'shr', ph: 'alu', text: '  SHR: T の左端から右へ、1 つ前のビットを書きながら進む。最後にはみ出たビットを C へ', why: '右シフト = 各ビットを 1 つ右へずらす。状態が「直前に読んだビット」を 1 つだけ覚えて運ぶ。' },
  { id: 'jz', ph: 'test', text: '  JZ/JNZ: T のレジスタに 1 があるか調べる', why: '0 かどうか = ビットを左から見て 1 に出会うか。1 に出会った瞬間に判定が決まる（CPU の NOR8 と同じ判定）。' },
  { id: 'jc', ph: 'test', text: '  JC/JNC: ! の右の C を読む', why: 'フラグ C はテープ末尾の 1 マス。読んだ値で分岐するかどうかが決まる。' },
  { id: 'addS', ph: 'alu', text: '  ADD/SUB/MOV: S の「未処理の最下位ビット」b を読み、x/y の印を付ける', why: '2 つの数を下の桁から 1 桁ずつ処理する筆算。処理済みのビットは 0→x, 1→y に書き換えておき、次は「印の無い一番右」を探せばよい。桁の位置をテープ自身が覚えている。' },
  { id: 'addT', ph: 'alu', text: '      b と桁上げ c を状態に持って T へ行き、未処理の最下位ビットに a+b+c（a−b−c / b）を書く', why: '状態が覚えるのは b と c の 2 ビット（4 通り）だけ。T の同じ桁に着いたら和（差）のビットを書いて印を付け、新しい c を持って S へ戻る。8 回で 8 ビット全部が終わる。' },
  { id: 'flag', ph: 'flag', text: '      全部済んだら最後の桁上げ（借り）を C に書く', why: 'S に未処理ビットが残っていない = 8 桁終わった。状態が持っている c がそのまま桁上げフラグ。' },
  { id: 'bpath', ph: 'alu', text: '  r = s（B）: ADD は左シフト、SUB は 0 クリア、MOV は何もしない', why: '同じレジスタ同士だと S と T の印が重なり筆算の印が衝突する。x + x = 2x（左シフト）、x − x = 0 は印無しで直接できるので別の手順にした。' },
  { id: 'clean', ph: 'clean', text: '  後片付け: x→0, y→1, T/S/B→#', why: 'TM 特有の作業。印はテープ上の「作業メモ」なので、次の命令の前に元の記号に戻す。CPU には相当する部品が無い。' },
  { id: 'adv', ph: 'adv', text: '  PC ← PC+1: * を : に戻し、次の区切りを * にする → loop', why: 'PC+1 = 印を 1 命令ぶん右へ動かすこと。番地を数える必要はなく、次の区切りを探すだけ。' },
  { id: 'jread', ph: 'jump', text: '  分岐: * に戻り、命令の aaaaaa（6 ビット）を状態に読み込む', why: 'aaaaaa は 0〜63 なので 64 通りの状態で覚えられる（二分木で 1 ビットずつ）。' },
  { id: 'jgol', ph: 'jump', text: '      aaaaaa を覚えたまま左端 ^ へ（途中の * は消す）', why: '絶対番地なので、先頭から数え直すために左端へ戻る。古い PC の印はここで消す。' },
  { id: 'jcnt', ph: 'jump', text: '      区切りを数えて aaaaaa 番目の命令に * を付ける → loop', why: '区切りを 1 つ越えるごとに覚えている数を 1 減らす（状態 CNT_v → CNT_v−1）。0 になった区切りが分岐先。' },
  { id: 'halt', ph: 'halt', text: 'HALT: 停止状態に入る', why: 'op = 0000 を読んだら停止状態へ。停止状態には遷移が無いので機械が止まる。' },
];

function buildTM() {
  const rules = [], states = [], info = {};
  const S = (q, line, desc) => { if (!info[q]) { const L = TM_CODE.find(x => x.id === line); info[q] = { q, line, phase: L.ph, desc, idx: states.length }; states.push(q); } return q; };
  const seen = new Set();
  const T = (q, syms, q2, w, d, note) => {
    for (const s of [].concat(syms)) {
      const key = q + '|' + s;
      if (seen.has(key)) throw new Error('δ 重複 ' + key);
      seen.add(key);
      rules.push({ id: rules.length, q, s, q2, w: w == null ? s : w, d, note: note || '' });
    }
  };
  const BITS = ['0', '1'], MB = ['x', 'y'], AB = ['0', '1', 'x', 'y'];
  const PROG = ['0', '1', ':', '*'];
  const REGA = ['0', '1', 'x', 'y', '#', 'T', 'S', 'B'];
  const ALLNB = ['*', ':', '0', '1', 'x', 'y', ']', '#', 'T', 'S', 'B', '!', '$'];
  const mk = b => (b === '0' ? 'x' : 'y');

  S('F', 'fetch', '開始: PC の印 * を探して左へ');
  T('F', ALLNB.filter(s => s !== '*'), 'F', null, 'L', '* を探して左へ');
  T('F', '*', 'D', null, 'R', '印を見つけた → 命令の先頭へ');
  S('HALT', 'halt', '停止（HALT 命令）'); S('HALT_ERR', 'halt', '異常停止');

  // 解読 1: op 4 ビット
  const tree = (pre, line, what, leaf, after) => {
    for (let k = 0; k < 4; k++) for (let v = 0; v < (1 << k); v++) {
      const p = k ? bin(v, k) : '';
      const q = pre + p;
      S(q, line, what + ': ' + (k ? '「' + p + '」まで読んだ、' : '') + 'bit' + (15 - k) + ' を読む');
      for (const b of BITS) {
        if (k < 3) T(q, b, pre + p + b, null, 'R', 'op の ' + (k + 1) + ' ビット目 = ' + b);
        else { const op = parseInt(p + b, 2); const r = leaf(op); T(q, b, r[0], null, r[1] || 'R', 'op = ' + p + b + ' → ' + r[2]); }
      }
    }
  };
  const CLS1 = [1, 2, 3, 8, 11], CLS2 = [5, 6, 7];
  tree('D', 'dec1', '解読 1', op => {
    if (op === 0) return ['HALT', 'R', 'HALT: 停止'];
    if (CLS1.includes(op)) return ['MR1_', 'R', ISA[op].name + '（オペランド 1 個）→ r を読む'];
    if (CLS2.includes(op)) return ['MR2_', 'R', ISA[op].name + '（オペランド 2 個）→ r を読む'];
    if (op === 4) return ['JB', 'L', 'JMP → 分岐先を読む'];
    if (op === 9) return ['JC_F', 'R', 'JC → C を見に行く'];
    if (op === 10) return ['JNC_F', 'R', 'JNC → C を見に行く'];
    return ['HALT_ERR', 'R', '未定義の命令'];
  });
  T('D', ']', 'HALT_ERR', null, 'R', 'PC がプログラムの外');
  // r / s を 3 ビット読む
  const reg3 = (pre, line, what, then) => {
    for (let k = 0; k < 3; k++) for (let v = 0; v < (1 << k); v++) {
      const p = k ? bin(v, k) : '';
      S(pre + p, line, what + ': ' + (k ? '「' + p + '」まで読んだ' : '3 ビット読む'));
      for (const b of BITS) {
        if (k < 2) T(pre + p, b, pre + p + b, null, 'R', what + ' の ' + (k + 1) + ' ビット目 = ' + b);
        else { const r = parseInt(p + b, 2); T(pre + p, b, then(r), null, 'R', what + ' = ' + p + b + ' = レジスタ ' + REGN[r] + ' を覚えた'); }
      }
    }
  };
  for (const c of [1, 2]) {
    reg3('MR' + c + '_', 'markT', 'r', r => 'GT' + c + '_' + r);
    for (let k = 0; k < 8; k++) {
      const q = 'GT' + c + '_' + k;
      S(q, 'markT', 'レジスタ領域へ。区切り # をあと ' + k + ' 個飛ばして、その次を T にする');
      T(q, PROG.concat([']', '0', '1']).filter((v, i, a) => a.indexOf(v) === i), q, null, 'R', '右へ（# を探す）');
      if (k === 0) T(q, '#', c === 1 ? 'BKE' : 'BKS', 'T', 'L', '目的のレジスタの区切り → T を書く（r を覚える役目をテープに渡す）');
      else T(q, '#', 'GT' + c + '_' + (k - 1), null, 'R', '# を 1 つ飛ばした（あと ' + (k - 1) + ' 個）');
    }
  }
  S('BKS', 'markS', 's を読むため * まで戻る');
  T('BKS', ALLNB.filter(s => s !== '*'), 'BKS', null, 'L', '* へ戻る');
  T('BKS', '*', 'SK7', null, 'R', '命令の先頭');
  for (let k = 7; k >= 1; k--) { S('SK' + k, 'markS', 'op と r を読み飛ばす（あと ' + k + ' ビット）'); T('SK' + k, BITS, k === 1 ? 'MS_' : 'SK' + (k - 1), null, 'R', '読み飛ばす'); }
  reg3('MS_', 'markS', 's', r => 'GS_' + r);
  for (let k = 0; k < 8; k++) {
    const q = 'GS_' + k;
    S(q, 'markS', '区切りをあと ' + k + ' 個飛ばして、その次を S（T なら B）にする');
    T(q, PROG.concat([']']).filter((v, i, a) => a.indexOf(v) === i), q, null, 'R', '右へ');
    if (k === 0) { T(q, '#', 'BKE', 'S', 'L', '2 本目のレジスタ → S を書く'); T(q, 'T', 'BKE', 'B', 'L', 'r と s が同じレジスタ → B（Both）を書く'); }
    else { T(q, '#', 'GS_' + (k - 1), null, 'R', '区切りを 1 つ飛ばした'); T(q, 'T', 'GS_' + (k - 1), null, 'R', '区切り（T）を 1 つ飛ばした'); }
  }
  S('BKE', 'dec2', '解読 2 のため * まで戻る');
  T('BKE', ALLNB.filter(s => s !== '*'), 'BKE', null, 'L', '* へ戻る');
  T('BKE', '*', 'E', null, 'R', '命令の先頭 → op を読み直す');
  tree('E', 'dec2', '解読 2', op => {
    const m = { 1: ['IN_FT', 'INC 実行へ'], 2: ['DE_FT', 'DEC 実行へ'], 3: ['JZ_FT', 'JZ 判定へ'], 11: ['JN_FT', 'JNZ 判定へ'], 8: ['SH_FT', 'SHR 実行へ'], 5: ['AD_ST', 'ADD 実行へ'], 6: ['SU_ST', 'SUB 実行へ'], 7: ['MV_ST', 'MOV 実行へ'] }[op];
    return m ? [m[0], 'R', m[1]] : ['HALT_ERR', 'R', '（ここには来ない）'];
  });

  // T を探す共通の形
  const findT = (q, line, desc, nxt) => { S(q, line, desc); T(q, PROG.concat([']', '#', '!']).filter((v, i, a) => a.indexOf(v) === i), q, null, 'R', 'T を探して右へ'); T(q, 'T', nxt, null, 'R', 'T を見つけた → レジスタの中へ'); };
  // INC / DEC
  findT('IN_FT', 'inc', 'INC: T を探す', 'IN_END');
  S('IN_END', 'inc', 'INC: レジスタの右端（最下位ビット）へ');
  T('IN_END', BITS, 'IN_END', null, 'R', '右端を探す'); T('IN_END', ['#', '!'], 'IN_C', null, 'L', '右端の次 → 最下位ビットへ戻る');
  S('IN_C', 'inc', 'INC: 桁上げ 1 を持って左へ');
  T('IN_C', '1', 'IN_C', '0', 'L', '1 + 1 = 10 → 0 を書いて桁上げ続行');
  T('IN_C', '0', 'UNM', '1', 'L', '0 + 1 = 1 → 桁上げ終わり');
  T('IN_C', 'T', 'ADV_L', '#', 'L', '最上位を越えた（256 で一周）→ T を # に戻す');
  findT('DE_FT', 'dec', 'DEC: T を探す', 'DE_END');
  S('DE_END', 'dec', 'DEC: レジスタの右端へ');
  T('DE_END', BITS, 'DE_END', null, 'R', '右端を探す'); T('DE_END', ['#', '!'], 'DE_B', null, 'L', '最下位ビットへ戻る');
  S('DE_B', 'dec', 'DEC: 借り 1 を持って左へ');
  T('DE_B', '0', 'DE_B', '1', 'L', '0 − 1 → 1 を書いて借り続行');
  T('DE_B', '1', 'UNM', '0', 'L', '1 − 1 = 0 → 借り終わり');
  T('DE_B', 'T', 'ADV_L', '#', 'L', '最上位を越えた（0 − 1 = 255）→ T を # に戻す');
  S('UNM', 'clean', '印 T まで左へ戻って # に戻す（その後 PC+1）');
  T('UNM', BITS.concat(['#', '!']), 'UNM', null, 'L', 'T を探して左へ');
  T('UNM', 'T', 'ADV_L', '#', 'L', 'T → # に戻した');
  S('UNMJ', 'clean', '印 T を # に戻す（その後 分岐）');
  T('UNMJ', BITS.concat(['#', '!']), 'UNMJ', null, 'L', 'T を探して左へ');
  T('UNMJ', 'T', 'JB', '#', 'L', 'T → # に戻した → 分岐先を読みに行く');
  // SHR
  findT('SH_FT', 'shr', 'SHR: T を探す', 'SH_H0');
  for (const h of BITS) {
    S('SH_H' + h, 'shr', 'SHR: 直前のビット ' + h + ' を持って右へ（書き込む値 = ' + h + '）');
    for (const x of BITS) T('SH_H' + h, x, 'SH_H' + x, h, 'R', 'ここに ' + h + ' を書き、元の ' + x + ' を次へ運ぶ');
    T('SH_H' + h, '#', 'SH_F' + h, null, 'R', '右端を越えた: はみ出たビット = ' + h + ' → C へ');
    T('SH_H' + h, '!', 'SH_W' + h, null, 'R', '右端を越えた: はみ出たビット = ' + h + ' → C へ');
    S('SH_F' + h, 'flag', 'C（! の右）へ行く（はみ出たビット ' + h + '）');
    T('SH_F' + h, BITS.concat(['#']), 'SH_F' + h, null, 'R', '! を探して右へ');
    T('SH_F' + h, '!', 'SH_W' + h, null, 'R', 'C のマスへ');
    S('SH_W' + h, 'flag', 'C に ' + h + ' を書く');
    T('SH_W' + h, BITS, 'UNM', h, 'L', 'C ← ' + h);
  }
  // JZ / JNZ
  findT('JZ_FT', 'jz', 'JZ: T を探す', 'JZ_SC');
  S('JZ_SC', 'jz', 'JZ: 1 があるか調べる');
  T('JZ_SC', '0', 'JZ_SC', null, 'R', 'まだ全部 0');
  T('JZ_SC', '1', 'UNM', null, 'L', '1 があった → 0 でない → 分岐しない');
  T('JZ_SC', ['#', '!'], 'UNMJ', null, 'L', '最後まで 0 → 0 である → 分岐する');
  findT('JN_FT', 'jz', 'JNZ: T を探す', 'JN_SC');
  S('JN_SC', 'jz', 'JNZ: 1 があるか調べる');
  T('JN_SC', '0', 'JN_SC', null, 'R', 'まだ全部 0');
  T('JN_SC', '1', 'UNMJ', null, 'L', '1 があった → 0 でない → 分岐する');
  T('JN_SC', ['#', '!'], 'UNM', null, 'L', '最後まで 0 → 分岐しない');
  // JC / JNC
  for (const [p, nm, on1] of [['JC', 'JC', true], ['JNC', 'JNC', false]]) {
    S(p + '_F', 'jc', nm + ': ! を探して右へ');
    T(p + '_F', ALLNB.filter(s => s !== '!' && s !== '$'), p + '_F', null, 'R', '! を探して右へ');
    T(p + '_F', '!', p + '_R', null, 'R', 'C のマスへ');
    S(p + '_R', 'jc', nm + ': C を読む');
    T(p + '_R', '1', on1 ? 'JB' : 'ADV_L', null, 'L', 'C = 1 → ' + (on1 ? '分岐する' : '分岐しない'));
    T(p + '_R', '0', on1 ? 'ADV_L' : 'JB', null, 'L', 'C = 0 → ' + (on1 ? '分岐しない' : '分岐する'));
  }
  // ADD / SUB / MOV
  for (const P of ['AD', 'SU', 'MV']) {
    const nm = { AD: 'ADD', SU: 'SUB', MV: 'MOV' }[P];
    const C = P === 'MV' ? [''] : ['0', '1'];
    const cw = c => (P === 'MV' ? '' : '（' + (P === 'AD' ? '桁上げ' : '借り') + ' ' + c + '）');
    S(P + '_ST', 'addS', nm + ': 最初の印（T / S / B）を探す');
    T(P + '_ST', PROG.concat([']', '#']).filter((v, i, a) => a.indexOf(v) === i), P + '_ST', null, 'R', '印を探して右へ');
    T(P + '_ST', ['T', 'S'], P + '_GL' + C[0], null, 'L', 'T と S は別のレジスタ → 筆算を始める');
    T(P + '_ST', 'B', P === 'AD' ? 'AB_END' : P === 'SU' ? 'SB_Z' : 'CLN_L', null, P === 'MV' ? 'L' : 'R', 'r = s（B）→ ' + (P === 'AD' ? '左シフト' : P === 'SU' ? '0 にする' : '何もしない'));
    for (const c of C) {
      S(P + '_GL' + c, 'addS', nm + ': レジスタ領域の左端 ] へ' + cw(c));
      T(P + '_GL' + c, REGA, P + '_GL' + c, null, 'L', '] へ');
      T(P + '_GL' + c, ']', P + '_FS' + c, null, 'R', '左端 → S を探す');
      S(P + '_FS' + c, 'addS', nm + ': S を探す' + cw(c));
      T(P + '_FS' + c, AB.concat(['#', 'T']), P + '_FS' + c, null, 'R', 'S を探して右へ');
      T(P + '_FS' + c, 'S', P + '_FE' + c, null, 'R', 'S → レジスタの中へ');
      S(P + '_FE' + c, 'addS', nm + ': S のレジスタの右端へ' + cw(c));
      T(P + '_FE' + c, AB, P + '_FE' + c, null, 'R', '右端を探す');
      T(P + '_FE' + c, ['#', 'T', '!'], P + '_SR' + c, null, 'L', '右端 → 左へ見ていく');
      S(P + '_SR' + c, 'addS', nm + ': S の未処理（印の無い）一番右のビットを探す' + cw(c));
      T(P + '_SR' + c, MB, P + '_SR' + c, null, 'L', '処理済み（x/y）なので飛ばす');
      for (const b of BITS) T(P + '_SR' + c, b, P + '_G2' + b + c, mk(b), 'L', 'S の次の桁は ' + b + ' → 印 ' + mk(b) + ' を付け、b = ' + b + ' を持って T へ');
      if (P === 'MV') T(P + '_SR' + c, 'S', 'CLN_L', null, 'L', '8 桁すべて済んだ → 後片付け');
      else T(P + '_SR' + c, 'S', 'FL' + c, null, 'R', '8 桁すべて済んだ → 最後の' + (P === 'AD' ? '桁上げ' : '借り') + ' ' + c + ' を C へ');
      for (const b of BITS) {
        const k = b + c, bc = '（b=' + b + (P === 'MV' ? '' : ', c=' + c) + '）';
        S(P + '_G2' + k, 'addT', nm + ': ] へ戻る' + bc);
        T(P + '_G2' + k, REGA, P + '_G2' + k, null, 'L', '] へ');
        T(P + '_G2' + k, ']', P + '_FT' + k, null, 'R', '左端 → T を探す');
        S(P + '_FT' + k, 'addT', nm + ': T を探す' + bc);
        T(P + '_FT' + k, AB.concat(['#', 'S']), P + '_FT' + k, null, 'R', 'T を探して右へ');
        T(P + '_FT' + k, 'T', P + '_TE' + k, null, 'R', 'T → レジスタの中へ');
        S(P + '_TE' + k, 'addT', nm + ': T のレジスタの右端へ' + bc);
        T(P + '_TE' + k, AB, P + '_TE' + k, null, 'R', '右端を探す');
        T(P + '_TE' + k, ['#', 'S', '!'], P + '_TR' + k, null, 'L', '右端 → 左へ見ていく');
        S(P + '_TR' + k, 'addT', nm + ': T の未処理の一番右のビットに書く' + bc);
        T(P + '_TR' + k, MB, P + '_TR' + k, null, 'L', '処理済みなので飛ばす');
        for (const a of BITS) {
          let out, c2, why;
          if (P === 'AD') { const s = +a + +b + +c; out = String(s & 1); c2 = String(s >> 1); why = a + ' + ' + b + ' + ' + c + ' = ' + bin(s, 2) + ' → ' + out + ' を書き、桁上げ ' + c2; }
          else if (P === 'SU') { let d = +a - +b - +c; c2 = d < 0 ? '1' : '0'; d = (d + 2) & 1; out = String(d); why = a + ' − ' + b + ' − ' + c + ' → ' + out + ' を書き、借り ' + c2; }
          else { out = b; c2 = ''; why = 'S の ' + b + ' をそのまま写す'; }
          T(P + '_TR' + k, a, P + '_GL' + c2, mk(out), 'L', why + '（印 ' + mk(out) + '）→ S へ戻る');
        }
      }
    }
  }
  for (const c of BITS) {
    S('FL' + c, 'flag', 'C（! の右）へ行く（書く値 ' + c + '）');
    T('FL' + c, REGA, 'FL' + c, null, 'R', '! を探して右へ');
    T('FL' + c, '!', 'FW' + c, null, 'R', 'C のマスへ');
    S('FW' + c, 'flag', 'C に ' + c + ' を書く');
    T('FW' + c, BITS, 'CLN_L', c, 'L', 'C ← ' + c + ' → 後片付けへ');
  }
  // B（r = s）の場合
  S('AB_END', 'bpath', 'ADD x,x: 右端へ（左シフトの準備）');
  T('AB_END', BITS, 'AB_END', null, 'R', '右端を探す');
  T('AB_END', ['#', '!'], 'AB_H0', null, 'L', '右端 → 最下位へ');
  for (const h of BITS) {
    S('AB_H' + h, 'bpath', 'ADD x,x: 右隣のビット ' + h + ' を持って左へ（x + x = 左シフト）');
    for (const x of BITS) T('AB_H' + h, x, 'AB_H' + x, h, 'L', 'ここに ' + h + ' を書き、元の ' + x + ' を左へ運ぶ');
    T('AB_H' + h, 'B', 'FL' + h, null, 'R', '最上位からはみ出たビット ' + h + ' = 桁上げ → C へ');
  }
  S('SB_Z', 'bpath', 'SUB x,x: 全ビットを 0 にする（x − x = 0）');
  T('SB_Z', BITS, 'SB_Z', '0', 'R', '0 を書く');
  T('SB_Z', '#', 'FL0', null, 'R', '終わり → 借りは 0');
  T('SB_Z', '!', 'FW0', null, 'R', '終わり → 借りは 0');
  // 後片付け
  S('CLN_L', 'clean', '後片付け: レジスタ領域の左端 ] へ');
  T('CLN_L', REGA.concat(['!']), 'CLN_L', null, 'L', '] へ');
  T('CLN_L', ']', 'CLN_R', null, 'R', '左端 → 印を消しながら右へ');
  S('CLN_R', 'clean', '後片付け: x→0, y→1, T/S/B→# にしながら右へ');
  T('CLN_R', 'x', 'CLN_R', '0', 'R', '印を消す x → 0'); T('CLN_R', 'y', 'CLN_R', '1', 'R', '印を消す y → 1');
  T('CLN_R', ['T', 'S', 'B'], 'CLN_R', '#', 'R', '区切りの印を # に戻す');
  T('CLN_R', BITS.concat(['#']), 'CLN_R', null, 'R', 'そのまま');
  T('CLN_R', '!', 'ADV_L', null, 'L', 'レジスタ領域の終わり → PC+1 へ');
  // PC+1
  S('ADV_L', 'adv', 'PC+1: 印 * まで左へ戻る');
  T('ADV_L', ALLNB.filter(s => s !== '*'), 'ADV_L', null, 'L', '* を探して左へ');
  T('ADV_L', '*', 'ADV_R', ':', 'R', '印を消す');
  S('ADV_R', 'adv', 'PC+1: 次の区切りに印を付ける');
  T('ADV_R', BITS, 'ADV_R', null, 'R', '今の命令を越える');
  T('ADV_R', ':', 'D', '*', 'R', '次の命令に印 * → 解読へ');
  T('ADV_R', ']', 'HALT_ERR', null, 'R', 'プログラムの外へ出た');
  // 分岐
  S('JB', 'jread', '分岐: * まで戻る');
  T('JB', ALLNB.filter(s => s !== '*'), 'JB', null, 'L', '* を探して左へ');
  T('JB', '*', 'JS10', null, 'R', '命令の先頭へ');
  for (let k = 10; k >= 1; k--) { S('JS' + k, 'jread', '分岐: op・r・s を読み飛ばす（あと ' + k + ' ビット）'); T('JS' + k, BITS, k === 1 ? 'RD_0_0' : 'JS' + (k - 1), null, 'R', '読み飛ばす'); }
  for (let k = 0; k < 6; k++) for (let v = 0; v < (1 << k); v++) {
    const q = 'RD_' + k + '_' + v;
    S(q, 'jread', '分岐先 aaaaaa を読む: ' + k + ' ビット読んだ（' + (k ? bin(v, k) : '—') + '）');
    for (const b of BITS) {
      const v2 = v * 2 + (+b);
      if (k === 5) T(q, b, 'GOL_' + v2, null, 'L', 'aaaaaa = ' + bin(v2, 6) + ' = ' + v2 + ' を状態に記憶');
      else T(q, b, 'RD_' + (k + 1) + '_' + v2, null, 'R', 'aaaaaa の ' + (k + 1) + ' ビット目 = ' + b);
    }
  }
  for (let v = 0; v < 64; v++) {
    const g = 'GOL_' + v, c = 'CNT_' + v;
    S(g, 'jgol', '分岐先 ' + v + ' を覚えたまま左端 ^ へ（途中の * は消す）');
    T(g, BITS.concat([':']), g, null, 'L', '左端へ');
    T(g, '*', g, ':', 'L', '古い PC の印を消す');
    T(g, '^', c, null, 'R', '左端 → 命令を数え始める');
    S(c, 'jcnt', 'あと ' + v + ' 命令ぶん区切りを数える');
    T(c, BITS, c, null, 'R', '命令を越える');
    if (v === 0) T(c, ':', 'D', '*', 'R', 'ここが分岐先 → 印 * を付け解読へ');
    else T(c, ':', 'CNT_' + (v - 1), null, 'R', '区切りを 1 つ数えた（あと ' + (v - 1) + '）');
    T(c, ']', 'HALT_ERR', null, 'R', '分岐先がプログラムの外');
  }
  // 数値テーブル
  const NS = SIGMA.length, qi = {};
  states.forEach((q, i) => qi[q] = i);
  const table = new Int32Array(states.length * NS).fill(-1);
  const rq2 = new Int32Array(rules.length), rw = new Uint8Array(rules.length), rd = new Int8Array(rules.length);
  for (const r of rules) {
    if (qi[r.q2] === undefined) throw new Error('未定義の状態 ' + r.q2);
    table[qi[r.q] * NS + SYMI[r.s]] = r.id;
    rq2[r.id] = qi[r.q2]; rw[r.id] = SYMI[r.w]; rd[r.id] = r.d === 'R' ? 1 : -1;
  }
  for (const r of rules) def('TM-' + r.id, 'tm', 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')', r.note + '\n状態 ' + r.q + ': ' + info[r.q].desc, { rule: r });
  return { rules, states, info, qi, table, rq2, rw, rd, NS, D: qi.D, F: qi.F, HALT: qi.HALT, HERR: qi.HALT_ERR };
}

def('TM-DEF', 'tm', 'チューリングマシン M = (Q, Σ, δ, q0, F)',
  'Q: 状態の集合 / Σ = {^ * : 0 1 x y ] # T S B ! $ _} / δ: Q×Σ → Q×Σ×{L,R} / q0 = F / 停止状態 = {HALT, HALT_ERR}。\n各ステップでヘッド下の記号 s と状態 q から δ(q, s) = (q′, s′, D) を引き、s′ を書いて D に動き q′ に移る。δ に無い組は停止。');
def('TM-TAPE', 'tm', 'テープの書式',
  '^ [*|:] 命令0 : 命令1 : … ] #a #b #c #d #e #f #g #h ! C $\n命令は機械語と同じ 16bit。* は PC の印。レジスタは 8bit（左が最上位）。C は桁上げフラグ 1 マス。\n作業中だけ現れる記号: T / S / B（操作するレジスタの印）、x / y（処理済みの 0 / 1）。');
// 設計の解説（CPU の概念 → TM の技法）
def('TMD-1', 'tmd', '有限状態で覚えるもの', '状態は有限個なので「上限が決まっている小さな値」だけを覚える:\n・op（16 通り）… 解読の二分木の葉\n・レジスタ番号 r, s（8 通り）\n・分岐先 aaaaaa（64 通り）\n・桁上げ / 借り / 運んでいるビット（2 通り）\nレジスタの値（256 通り × 8 本）は状態に入れずテープに置く。');
def('TMD-2', 'tmd', 'テープ上の印 = ポインタ', 'CPU は配線でレジスタを選ぶが、TM には配線が無い。代わりに区切り # を T / S / B に書き換え、「このレジスタを使う」という目印をテープに置く。以後は印を探すだけでよいので、r や s を状態に持ち続けなくて済む（状態数が 8 倍・64 倍に膨らまない）。');
def('TMD-3', 'tmd', '処理済みの印 = 桁の位置', '筆算で今どの桁かを覚えるのに、処理したビットを 0→x, 1→y と書き換える。「印の無い一番右」が次の桁。位置をテープ自身が覚えるので、状態は桁上げ 1 ビットだけ持てばよい。');
def('TMD-4', 'tmd', '2 回の解読', '1 回目の解読で「オペランドが何個か」だけ見て印を付け、* に戻って op を読み直してから実行へ振り分ける。CPU の「解読 → オペランド読み出し → 実行」の 3 段に対応する。');
def('TMD-5', 'tmd', '時間の代償', '回路は 1 クロックで全ビットを並列に処理するが、TM はヘッドが 1 マスずつ往復する。ADD は 8 桁 × (S ↔ T の往復) で数百〜千ステップ、命令の取り出しはテープ長に比例する。計算できるものは同じ（チューリング完全）で、速さだけが違う。');
def('TMD-6', 'tmd', '後片付け', 'x/y や T/S/B は作業用のメモ。命令の終わりに必ず元へ戻すので、命令と命令の間のテープは常に「機械語 + レジスタ + C」だけの綺麗な形になる。だから命令ごとに 5 層を突き合わせられる。');

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
    init.forEach(v => { t.push('#'); for (const b of bin(v, W)) t.push(b); });
    t.push('!', '0', '$', '_', '_', '_');
    return Uint8Array.from(t.map(s => SYMI[s]));
  }
  reset() {
    this.tape = TM.makeTape(this.words, this.init);
    this.head = 1; this.qi = this.M.F; this.steps = 0; this.lastId = -1; this.halted = false; this.err = null;
    this.hist = []; this.ruleCount = new Uint32Array(this.M.rules.length);
    this.progEnd = this.tape.indexOf(SYMI[']']);
    this.regStart = []; for (let k = 0; k < NREG; k++) this.regStart.push(this.progEnd + 2 + k * (W + 1));
    this.flagPos = this.progEnd + 1 + NREG * (W + 1) + 1;
  }
  get q() { return this.M.states[this.qi]; }
  get last() { return this.lastId >= 0 ? this.M.rules[this.lastId] : null; }
  sym(i) { return SIGMA[this.tape[i]]; }
  rule() { const id = this.M.table[this.qi * this.M.NS + this.tape[this.head]]; return id >= 0 ? this.M.rules[id] : null; }
  step() {
    if (this.halted) return null;
    const M = this.M, id = M.table[this.qi * M.NS + this.tape[this.head]];
    if (id < 0) { this.halted = true; this.err = 'δ(' + this.q + ', ' + this.sym(this.head) + ') が未定義'; this.qi = M.HERR; return null; }
    const prev = this.qi;
    this.tape[this.head] = M.rw[id];
    this.head += M.rd[id];
    this.qi = M.rq2[id];
    this.steps++; this.lastId = id; this.ruleCount[id]++;
    this.hist.push(id, this.steps); if (this.hist.length > 128) this.hist.splice(0, 2);
    if (this.qi === M.HALT || this.qi === M.HERR) { this.halted = true; if (this.qi === M.HERR) this.err = M.rules[id].note; }
    return (this.qi === M.D && prev !== M.F) || this.halted;
  }
  // 速い連続実行（表示用の履歴は最後の 64 歩だけ残す）
  run(n) {
    const M = this.M, tb = M.table, NS = M.NS, rq2 = M.rq2, rw = M.rw, rd = M.rd, tape = this.tape, cnt = this.ruleCount;
    let q = this.qi, h = this.head, last = this.lastId, k = 0;
    const tail = Math.max(0, n - 64);
    for (; k < n; k++) {
      const id = tb[q * NS + tape[h]];
      if (id < 0) { this.err = 'δ(' + M.states[q] + ', ' + SIGMA[tape[h]] + ') が未定義'; q = M.HERR; this.halted = true; break; }
      tape[h] = rw[id]; h += rd[id]; const p = q; q = rq2[id]; cnt[id]++; last = id;
      if (k >= tail) { this.hist.push(id, this.steps + k + 1); }
      if (q === M.HALT || q === M.HERR) { k++; this.halted = true; if (q === M.HERR) this.err = M.rules[id].note; break; }
      if (q === M.D && p !== M.F) { k++; break; }
    }
    if (this.hist.length > 128) this.hist.splice(0, this.hist.length - 128);
    this.qi = q; this.head = h; this.lastId = last; this.steps += k;
    return k;
  }
  regs() { return this.regStart.map(s => { let v = 0; for (let i = 0; i < W; i++) v = v * 2 + (this.tape[s + i] === SYMI['1'] ? 1 : 0); return v; }); }
  flagC() { return this.tape[this.flagPos] === SYMI['1'] ? 1 : 0; }
  pc() {
    let n = -1; const c1 = SYMI[':'], c2 = SYMI['*'];
    for (let i = 1; i < this.progEnd; i++) { const c = this.tape[i]; if (c === c1 || c === c2) { n++; if (c === c2) return n; } }
    return -1;
  }
  lookahead() {
    if (this.halted) return 0;
    const M = this.M, tb = M.table, NS = M.NS, t = this.tape.slice();
    let q = this.qi, h = this.head, n = 0;
    for (;;) {
      const id = tb[q * NS + t[h]];
      n++;
      if (id < 0) break;
      t[h] = M.rw[id]; h += M.rd[id]; const p = q; q = M.rq2[id];
      if ((q === M.D && p !== M.F) || q === M.HALT || q === M.HERR) break;
      if (n > 5e6) break;
    }
    return n;
  }
}

/* ---------------------------------------------------------------------
 *  5 層の同期実行
 * ------------------------------------------------------------------- */
function buildProgram(source, mode) {
  const res = { mode, errors: [] };
  if (mode === 'c') {
    try {
      const comp = cCompile(source);
      res.c = { src: source, ast: comp.ast, meta: comp.meta, temp: comp.ast.temp };
      res.asmText = comp.asm;
    } catch (e) {
      if (e instanceof CError) { const lc = lineCol(source, e.pos || 0); res.errors.push({ level: 'c', line: lc.line - 1, col: lc.col, msg: e.message }); return res; }
      throw e;
    }
  } else { res.asmText = source; res.c = null; }
  const as = assemble(res.asmText);
  res.asm = as;
  as.errors.forEach(e => res.errors.push({ level: 'asm', line: e.line, msg: e.msg }));
  if (res.errors.length) return res;
  if (res.c) res.c.ast.vars.forEach(v => { as.init[v.reg] = v.init; });
  if (res.c) as.instrs.forEach(it => { it.meta = it.line >= 0 ? res.c.meta[it.line] : null; });
  res.words = as.words; res.init = as.init; res.ok = true;
  return res;
}

class Sim {
  constructor(prog) { this.prog = prog; this.reset(); }
  reset() {
    const P = this.prog;
    this.cI = P.c ? new CInterp(P.c.ast) : null;
    this.aI = new AsmInterp(P.asm);
    this.mI = new McInterp(P.words, P.init);
    this.ck = new Circuit(P.words, P.init);
    this.tm = new TM(P.words, P.init);
    this.instr = 0; this.p = 0;
    this.segN = this.tm.lookahead(); this.segDone = 0;
    this.halted = false; this.cSync = true;
    this.check = this.verify();
    this.lastCommit = null;
  }
  advance(dp) {
    if (this.halted) return 0;
    let commits = 0, guard = 0;
    this.p += dp;
    while (!this.halted && guard++ < 100000) {
      const target = Math.min(this.segN, Math.floor(this.p * this.segN));
      if (this.segDone < target && !this.tm.halted) this.segDone += this.tm.run(target - this.segDone);
      if (this.p >= 1) { this.p -= 1; this.commit(); commits++; } else break;
    }
    return commits;
  }
  microStep() {
    if (this.halted) return;
    if (this.segDone < this.segN) { this.tm.step(); this.segDone++; }
    this.p = this.segDone / this.segN;
    if (this.segDone >= this.segN) { this.p = 0; this.commit(); }
  }
  stepInstr() { if (!this.halted) { this.p = 1; this.advance(0); this.p = 0; } }
  runToEnd(maxInstr) { let n = 0; while (!this.halted && n++ < (maxInstr || 1e6)) { this.p = 1; this.advance(0); } this.p = 0; return n; }
  commit() {
    if (this.segDone < this.segN && !this.tm.halted) this.segDone += this.tm.run(this.segN - this.segDone);
    const before = { pc: this.mI.pc, word: this.mI.fetch(), asm: this.aI.cur(), c: this.cI ? this.cI.cur : null };
    this.ck.clock();
    this.mI.step();
    this.aI.step();
    const m = before.asm && before.asm.meta;
    this.cSync = !this.cI || !m || m.last;
    if (this.cI && m && m.last) this.cI.step();
    this.instr++;
    this.lastCommit = before;
    this.check = this.verify(before);
    this.halted = this.mI.halted;
    this.segN = this.tm.lookahead(); this.segDone = 0;
    if (this.halted) this.p = 0;
  }
  verify(before) {
    const R = { asm: this.aI.R, mc: this.mI.R, circ: this.ck.regs(), tm: this.tm.regs() };
    const Cf = { asm: this.aI.C, mc: this.mI.C, circ: this.ck.flagC(), tm: this.tm.flagC() };
    if (this.cI && this.cSync) R.c = this.cI.regs();
    const PCs = { asm: this.aI.pc, mc: this.mI.pc, circ: this.ck.pc(), tm: this.tm.halted ? this.mI.pc : this.tm.pc() };
    const H = { asm: this.aI.halted, mc: this.mI.halted, circ: this.ck.halted(), tm: this.tm.halted };
    if (this.cI && this.cSync) H.c = this.cI.halted;
    const ref = R.mc, bad = [];
    for (const k in R) for (let i = 0; i < NREG; i++) {
      if (k === 'c' && !this.prog.c.ast.vars.some(v => v.reg === i)) continue;
      if (R[k][i] !== ref[i]) bad.push(k + ' のレジスタ ' + REGN[i] + ' = ' + R[k][i] + '（機械語では ' + ref[i] + '）');
    }
    for (const k in Cf) if (Cf[k] !== Cf.mc) bad.push(k + ' のフラグ C = ' + Cf[k] + '（機械語では ' + Cf.mc + '）');
    for (const k in PCs) if (PCs[k] !== PCs.mc) bad.push(k + ' の PC = ' + PCs[k] + '（機械語では ' + PCs.mc + '）');
    for (const k in H) if (H[k] !== H.mc) bad.push(k + ' の停止状態が違う');
    if (this.cI && before && before.asm && before.asm.meta && before.asm.meta.idx === 0 && before.c) {
      const m = before.asm.meta;
      if (m.node !== before.c.node || m.role !== before.c.role) bad.push('C の動作（' + before.c.role + '）と命令の出どころ（' + m.role + '）が違う');
    }
    if (this.tm.err && !this.mI.err) bad.push('TM: ' + this.tm.err);
    return { ok: bad.length === 0, bad, R, PCs, H, Cf, cSync: this.cSync };
  }
}

const api = { W, MASK, PCW, MEM, IW, NREG, REGN, OPC, ISA, DEFS, BLOCKS, PHASE, SIGMA, SYMI, TM_CODE,
  bin, encode, decode, disasm, cTokenize, cParse, cCompile, CError, lineCol, assemble,
  CInterp, AsmInterp, McInterp, Circuit, TM, buildProgram, Sim, buildCircuit, buildTM };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CPU5 = api;
})(typeof window !== 'undefined' ? window : globalThis);
