/* =====================================================================
 *  CPU 5 層エンジン v3（16bit / RAM / 関数呼び出し）
 *    C  →  アセンブリ  →  機械語  →  論理回路  →  チューリングマシン
 *  5 つは同じプログラムをそれぞれ「独立した定義」で実行し、
 *  命令ごと（C は動作のまとまりごと）に状態を突き合わせる。
 *  TM は重いプログラムでは省略できる（Sim の useTM）。
 * ===================================================================== */
(function (root) {
'use strict';

const W = 16, MASK = 0xFFFF;      // データ幅
const PCW = 8, MEM = 256;         // 命令メモリ 256 語
const IW = 16;                    // 命令語 16bit
const NREG = 8, RAMN = 64, ABITS = 6;
const REGN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const bin = (v, n) => (v >>> 0).toString(2).padStart(n, '0').slice(-n);
const ISA = [
  { op: 0, name: 'HALT', fmt: '0000 ··· ·········', rtl: 'halted ← 1（PC はそのまま）' },
  { op: 1, name: 'INC', fmt: '0001 rrr ·········', rtl: 'R[r] ← R[r] + 1' },
  { op: 2, name: 'DEC', fmt: '0010 rrr ·········', rtl: 'R[r] ← R[r] − 1' },
  { op: 3, name: 'JZ', fmt: '0011 rrr aaaaaaaaa', rtl: 'if R[r] = 0 then PC ← a' },
  { op: 4, name: 'JMP', fmt: '0100 ··· aaaaaaaaa', rtl: 'PC ← a' },
  { op: 5, name: 'ADD', fmt: '0101 rrr sss ······', rtl: 'R[r] ← R[r] + R[s];  C ← 桁上げ' },
  { op: 6, name: 'SUB', fmt: '0110 rrr sss ······', rtl: 'R[r] ← R[r] − R[s];  C ← 借り (R[r] < R[s])' },
  { op: 7, name: 'MOV', fmt: '0111 rrr sss ······', rtl: 'R[r] ← R[s]' },
  { op: 8, name: 'SHR', fmt: '1000 rrr ·········', rtl: 'R[r] ← R[r] >> 1;  C ← 元の最下位ビット' },
  { op: 9, name: 'JC/JNC', fmt: '1001 ··c aaaaaaaaa', rtl: 'c=0 (JC): if C = 1 then PC ← a / c=1 (JNC): if C = 0 then PC ← a' },
  { op: 10, name: 'JNZ', fmt: '1010 rrr aaaaaaaaa', rtl: 'if R[r] ≠ 0 then PC ← a' },
  { op: 11, name: 'LDI', fmt: '1011 rrr iiiiiiiii', rtl: 'R[r] ← i（0〜511）' },
  { op: 12, name: 'LD', fmt: '1100 rrr sss ······', rtl: 'R[r] ← RAM[R[s] mod 64]' },
  { op: 13, name: 'ST', fmt: '1101 rrr sss ······', rtl: 'RAM[R[s] mod 64] ← R[r]' },
  { op: 14, name: 'CALL', fmt: '1110 ··· aaaaaaaaa', rtl: 'LR ← PC + 1;  PC ← a' },
  { op: 15, name: 'RET', fmt: '1111 ··· ·········', rtl: 'PC ← LR' },
];
const MN = { HALT: [0, ''], INC: [1, 'r'], DEC: [2, 'r'], JZ: [3, 'ra'], JMP: [4, 'a'], ADD: [5, 'rs'], SUB: [6, 'rs'], MOV: [7, 'rs'], SHR: [8, 'r'],
  JC: [9, 'a', 0], JNC: [9, 'a', 1], JNZ: [10, 'ra'], LDI: [11, 'ri'], LD: [12, 'rm'], ST: [13, 'rm'], CALL: [14, 'a'], RET: [15, ''] };
const OPC = {}; for (const k in MN) OPC[k] = MN[k][0];
const USES_S = op => op === 5 || op === 6 || op === 7 || op === 12 || op === 13;
const encode = (op, r, s, a) => USES_S(op) ? ((op << 12) | ((r & 7) << 9) | ((s & 7) << 6)) : ((op << 12) | ((r & 7) << 9) | (a & 511));
const decode = w => ({ op: (w >> 12) & 15, r: (w >> 9) & 7, s: (w >> 6) & 7, a: w & 511 });
const mnOf = w => { const { op, r } = decode(w); return op === 9 ? (r & 1 ? 'JNC' : 'JC') : ISA[op].name; };
const disasm = w => {
  const { r, s, a } = decode(w), m = mnOf(w), sig = MN[m][1];
  const p = [];
  for (const k of sig) {
    if (k === 'r') p.push(REGN[r]);
    else if (k === 's') p.push(REGN[s]);
    else if (k === 'm') p.push('[' + REGN[s] + ']');
    else if (k === 'a') p.push(String(a & 255));
    else if (k === 'i') p.push(String(a));
  }
  return m + (p.length ? ' ' + p.join(', ') : '');
};

/* ---------------------------------------------------------------------
 *  定義レジストリ
 * ------------------------------------------------------------------- */
const DEFS = {};
function def(id, level, title, body, extra) { DEFS[id] = Object.assign({ id, level, title, body }, extra || {}); return id; }

def('C-VAR', 'c', '変数宣言 → レジスタ割り当て', '`unsigned int x = n;` は 16bit の符号なし整数（0〜65535）。宣言順に a, b, c, … のレジスタへ割り当てる。掛け算・割り算・比較などで作業用レジスタを使う分だけ、変数の上限は減る（8 − 作業用）。');
def('C-ARR', 'c', '配列 → RAM', '`unsigned int a[n] = {…};` は RAM（64 語）に置く。先頭から順に番地を割り当てる。a[i] は RAM[先頭 + i]。添字の範囲外は検査しない（C と同じく未定義）。');
def('C-ARITH', 'c', '符号なし 16bit の算術', '+ − * << の結果は 2^16 = 65536 で割った余り（C11 N1570 6.2.5p9）。>> と / は切り捨て。この CPU では x / 0 = 65535、x % 0 = x と定める（C では未定義動作 6.5.5p5）。');
def('C-ASG', 'c', '代入 x = 式', '右辺を計算して x に入れる。式は 定数 / 変数 / a[i] / 変数 演算子 変数・定数（+ − * / % >> <<）。');
def('C-STORE', 'c', '配列への代入 a[i] = 値', 'RAM[先頭 + i] ← 値（変数か定数）。');
def('C-WHILE', 'c', 'while (条件) S / for (初期化; 条件; 更新) S', '条件を評価し、真（0 以外）なら S を実行して先頭へ。偽なら抜ける（C11 6.8.5.1）。for は「初期化; while (条件) { S; 更新; }」と同じ（6.8.5.3、continue は未対応）。');
def('C-IF', 'c', 'if (条件) S1 else S2', '条件が真なら S1、偽なら S2（C11 6.8.4.1）。');
def('C-COND', 'c', '条件式', 'x, !x, x == 0, x != 0, x OP y, x OP 定数（OP は == != < <= > >=）。比較は符号なしの大小。');
def('C-BREAK', 'c', 'break;', '一番内側のループから抜ける（C11 6.8.6.3）。');
def('C-CALL', 'c', '関数呼び出し f();', '関数 f の本体を実行して戻る。この CPU は戻り番地レジスタ LR が 1 本だけなので、関数の中から別の関数は呼べない（葉関数のみ）。引数と戻り値は大域変数で受け渡す。');
def('C-RET', 'c', 'return;', 'main の中では停止。関数の中では呼び出し元へ戻る。');
def('C-END', 'c', 'main の終わり', 'main の閉じ括弧に達したら停止。');
def('C-FEND', 'c', '関数の終わり', '関数の閉じ括弧に達したら呼び出し元へ戻る。');

def('T-LDI', 't', 'T-LDI  ⟦x = k⟧', 'LDI x, k        ; k ≤ 511\n（k > 511 は LDI x, k>>8 ; ADD x,x ×8 ; LDI t, k&255 ; ADD x, t）');
def('T-MOV', 't', 'T-MOV  ⟦x = y⟧', 'MOV x, y');
def('T-ADD', 't', 'T-ADD  ⟦x = y + z⟧', 'MOV x, y\nADD x, z        ; 定数 k ≤ 3 なら INC × k、それ以外は LDI t, k; ADD x, t');
def('T-SUB', 't', 'T-SUB  ⟦x = y − z⟧', 'MOV x, y\nSUB x, z\n（x が z と同じなら作業用 t で計算して MOV x, t）');
def('T-SHR', 't', 'T-SHR  ⟦x = y >> k⟧', 'MOV x, y\nSHR x を k 回');
def('T-SHL', 't', 'T-SHL  ⟦x = y << k⟧', 'MOV x, y\nADD x, x を k 回   ; 2 倍 = 自分自身を足す');
def('T-MUL', 't', 'T-MUL  ⟦x = y * z⟧（シフトと加算）', 'MOV A, y ; MOV B, z ; SUB P, P\nL: JZ B, E          ; B が 0 になるまで\n   SHR B            ; B の最下位ビット → C\n   JNC S\n   ADD P, A         ; ビットが 1 なら A を足す\nS: ADD A, A         ; A を 2 倍\n   JMP L\nE: MOV x, P');
def('T-DIV', 't', 'T-DIV  ⟦x = y / z⟧ ⟦x = y % z⟧（筆算の割り算）', 'MOV N, y ; SUB R, R ; LDI K, 16\nL: N を左シフトし、はみ出たビットを R に入れる（R も左シフト）\n   R ≥ z なら R −= z、N の最下位を 1（商のビット）\n   K を減らして 16 回\n→ 商 = N、余り = R');
def('T-LOAD', 't', 'T-LOAD  ⟦x = a[i]⟧', 'LDI t, 先頭(a)\nADD t, i\nLD  x, [t]');
def('T-STORE', 't', 'T-STORE  ⟦a[i] = y⟧', 'LDI t, 先頭(a)\nADD t, i\nST  y, [t]');
def('T-WHILE', 't', 'T-WHILE  ⟦while (c) S⟧', 'L: ⟦c が偽なら E へ⟧\n   ⟦S⟧\n   JMP L\nE:');
def('T-IF', 't', 'T-IF  ⟦if (c) S⟧', '   ⟦c が偽なら E へ⟧\n   ⟦S⟧\nE:');
def('T-IFELSE', 't', 'T-IFELSE  ⟦if (c) S1 else S2⟧', '   ⟦c が偽なら F へ⟧\n   ⟦S1⟧\n   JMP E\nF: ⟦S2⟧\nE:');
def('T-BREAK', 't', 'T-BREAK  ⟦break⟧', 'JMP (一番内側のループの出口)');
def('T-CALL', 't', 'T-CALL  ⟦f();⟧', 'CALL f           ; LR ← 次の番地');
def('T-FRET', 't', 'T-FRET  関数の return / 末尾', 'RET              ; PC ← LR');
def('T-RET', 't', 'T-RET  main の return', 'HALT');
def('T-END', 't', 'T-END  main の末尾', 'HALT');
def('T-NZ', 't', 'T-NZ  ⟦x が偽なら L へ⟧', 'JZ x, L');
def('T-Z', 't', 'T-Z  ⟦x == 0 が偽なら L へ⟧', 'JNZ x, L');
def('T-LT', 't', 'T-LT  ⟦x < y が偽なら L へ⟧', 'MOV t, x\nSUB t, y        ; C = 1 ⇔ x < y（借り）\nJNC L');
def('T-GE', 't', 'T-GE  ⟦x >= y が偽なら L へ⟧', 'MOV t, x\nSUB t, y\nJC L');
def('T-GT', 't', 'T-GT  ⟦x > y が偽なら L へ⟧', 'MOV t, y\nSUB t, x        ; C = 1 ⇔ y < x\nJNC L');
def('T-LE', 't', 'T-LE  ⟦x <= y が偽なら L へ⟧', 'MOV t, y\nSUB t, x\nJC L');
def('T-EQ', 't', 'T-EQ  ⟦x == y が偽なら L へ⟧', 'MOV t, x\nSUB t, y        ; 等しければ t = 0\nJNZ t, L');
def('T-NE', 't', 'T-NE  ⟦x != y が偽なら L へ⟧', 'MOV t, x\nSUB t, y\nJZ t, L');
def('T-CMPK', 't', 'T-CMPK  ⟦x OP k⟧（定数との比較）', 'LDI t, k（>= と < は k−1）\nSUB t, x        ; C = 1 ⇔ t < x\nJC / JNC / JZ / JNZ L');

const A_TXT = {
  HALT: '停止。', INC: 'r ← r + 1 (mod 65536)。C は変えない。', DEC: 'r ← r − 1 (mod 65536)。C は変えない。',
  JZ: 'r = 0 ならラベル L へ。', JNZ: 'r ≠ 0 なら L へ。', JMP: '無条件に L へ。', JC: 'C = 1 なら L へ。', JNC: 'C = 0 なら L へ。',
  ADD: 'r ← r + s。65536 以上になったら C = 1、ならなければ C = 0。', SUB: 'r ← r − s。r < s なら C = 1（借り）。',
  MOV: 'r ← s。', SHR: 'r ← r >> 1。はみ出た最下位ビットを C へ。', LDI: 'r ← k（0〜511 の定数）。',
  LD: 'r ← RAM[s の値 mod 64]（間接アドレス）。', ST: 'RAM[s の値 mod 64] ← r。', CALL: 'LR ← 次の番地、L へ跳ぶ（戻り番地は 1 つだけ）。', RET: 'LR の番地へ戻る。',
};
const A_SYN = { HALT: 'HALT', INC: 'INC r', DEC: 'DEC r', JZ: 'JZ r, L', JNZ: 'JNZ r, L', JMP: 'JMP L', JC: 'JC L', JNC: 'JNC L', ADD: 'ADD r, s', SUB: 'SUB r, s', MOV: 'MOV r, s', SHR: 'SHR r', LDI: 'LDI r, k', LD: 'LD r, [s]', ST: 'ST r, [s]', CALL: 'CALL L', RET: 'RET' };
for (const k in A_TXT) def('A-' + k, 'asm', A_SYN[k], A_TXT[k]);
def('A-REG', 'asm', '.reg r, n', '疑似命令。実行前にレジスタ r を n にする（ローダーが設定）。');
def('A-RAM', 'asm', '.ram 番地, 値, 値, …', '疑似命令。実行前に RAM の番地から順に値を置く（ローダーが設定）。');
def('A-LABEL', 'asm', 'ラベル L:', 'L は次に置かれた命令のアドレスを表す。');

ISA.forEach(e => def('M-' + bin(e.op, 4), 'mc', 'オペコード ' + bin(e.op, 4) + ' = ' + e.name, '書式 ' + e.fmt + '\n' + e.rtl, { isa: e }));
def('M-FMT', 'mc', '命令語の書式 (16bit)', 'レジスタ演算: oooo rrr sss ······\n分岐・LDI:    oooo rrr aaaaaaaaa（分岐先は下 8 ビット = 0〜255）\nレジスタ番号 000=a … 111=h。PC 8bit、LR 8bit、フラグ C 1bit、RAM 64 語 × 16bit。');

def('G-NOT', 'circ', 'NOT', 'y = ¬a');
def('G-AND', 'circ', 'AND', 'y = a·b·…（全部 1 のとき 1）');
def('G-OR', 'circ', 'OR', 'y = a + b + …（どれか 1 なら 1）');
def('G-XOR', 'circ', 'XOR', 'y = a ⊕ b（異なれば 1）');
def('G-NOR', 'circ', 'NOR', 'y = ¬(a + b + …)');
def('G-DFF', 'circ', 'D フリップフロップ', 'クロックの立ち上がりで Q ← D。それ以外の時刻は Q を保持する。');
def('G-ROM', 'circ', 'ROM 256×16', 'I = M[PC]。行デコーダで 1 行を選び、その行の 16bit を出力する組合せ回路。');
def('G-RAM', 'circ', 'RAM 64×16', '読み出し: MD = RAM[W mod 64]（組合せ）。書き込み: isST = 1 のときクロック↑で RAM[W mod 64] ← X。中身は 1024 個の記憶素子（ここではまとめて 1 部品として扱う）。');
def('G-CONST', 'circ', '定数', '常に 0 または 1。');
def('G-CLK', 'circ', 'クロック', '1 周期 = 1 命令（単一サイクル CPU）。周期の終わりの立ち上がりで全 DFF と RAM が同時に更新される。');
def('G-PROP', 'circ', '組合せ回路の伝搬', 'DFF/ROM/RAM の出力から始まり、各ゲートは入力が確定してから 1 段遅れて出力が確定する。');

/* ---------------------------------------------------------------------
 *  C コンパイラ（部分集合）
 * ------------------------------------------------------------------- */
const C_KW = new Set(['unsigned', 'char', 'int', 'void', 'while', 'if', 'else', 'return', 'register', 'uint16_t', 'uint8_t', 'signed', 'short', 'long', 'for', 'do', 'break', 'continue', 'static', 'const']);
const OPS3 = ['>>=', '<<='];
const OPS2 = ['++', '--', '!=', '==', '+=', '-=', '*=', '/=', '%=', '>=', '<=', '>>', '<<', '&&', '||'];
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
  const vars = [], arrays = [], byName = {}, funcs = {}, calls = [];
  let loopDepth = 0, curFn = null, ramTop = 0;

  function parseNum() {
    const t = next();
    if (t.t !== 'num') throw new CError('数値が必要です', t.s);
    const v = /^0x/i.test(t.v) ? parseInt(t.v.slice(2), 16) : /^0b/i.test(t.v) ? parseInt(t.v.slice(2), 2) : parseInt(t.v, 10);
    if (isNaN(v)) throw new CError('数値として読めません: ' + t.v, t.s);
    if (v > MASK) throw new CError('16bit なので 0〜65535 です', t.s);
    return { v, t };
  }
  const TYPEW = ['unsigned', 'char', 'int', 'register', 'uint16_t', 'uint8_t', 'signed', 'short', 'long', 'static', 'const'];
  const isTypeStart = () => peek().t === 'kw' && TYPEW.includes(peek().v);
  function parseType() {
    const st = peek().s, words = [];
    while (isTypeStart()) words.push(next().v);
    const w = words.filter(x => !['register', 'static', 'const'].includes(x)).join(' ');
    if (!['unsigned', 'unsigned int', 'uint16_t', 'unsigned short', 'unsigned short int'].includes(w))
      throw new CError('16bit CPU なので型は unsigned int（または uint16_t）にしてください（「' + w + '」）', st);
  }
  function parseDeclList() {
    for (;;) {
      const id = next();
      if (id.t !== 'id') throw new CError('変数名が必要です', id.s);
      if (byName[id.v] || funcs[id.v]) throw new CError(id.v + ' は宣言済みです', id.s);
      if (isv('[')) {
        next();
        let len = null;
        if (peek().t === 'num') len = parseNum().v;
        const rb = expect(']');
        const init = [];
        if (isv('=')) {
          next(); expect('{');
          while (!isv('}')) { init.push(parseNum().v); if (isv(',')) next(); else break; }
          expect('}');
        }
        if (len == null) len = init.length;
        if (!len) throw new CError('配列の大きさが必要です', id.s);
        if (init.length > len) throw new CError('初期値が配列より多いです', id.s);
        if (ramTop + len > RAMN) throw new CError('RAM は ' + RAMN + ' 語までです（いま ' + (ramTop + len) + ' 語）', id.s);
        const a = { name: id.v, kind: 'arr', base: ramTop, len, init: init.concat(new Array(len - init.length).fill(0)), s: id.s, e: rb.e };
        ramTop += len; arrays.push(a); byName[id.v] = a;
      } else {
        let init = 0, e = id.e;
        if (isv('=')) { next(); const n = parseNum(); init = n.v; e = n.t.e; }
        const v = { name: id.v, kind: 'var', init, s: id.s, e };
        vars.push(v); byName[id.v] = v;
      }
      if (isv(',')) { next(); continue; }
      expect(';'); break;
    }
  }
  function ref(kind) {
    const t = next();
    if (t.t !== 'id') throw new CError('変数名が必要です（「' + t.v + '」）', t.s);
    const v = byName[t.v];
    if (!v) throw new CError(t.v + ' は宣言されていません', t.s);
    if (kind && v.kind !== kind) throw new CError(t.v + (v.kind === 'arr' ? ' は配列です（a[i] の形で使ってください）' : ' は配列ではありません'), t.s);
    return v;
  }
  function operand(allowIdx) {
    if (peek().t === 'num') return { t: 'num', v: parseNum().v };
    const s0 = peek().s;
    if (peek(1).v === '[') {
      const a = ref('arr'); next();
      const i = peek().t === 'num' ? { t: 'num', v: parseNum().v } : { t: 'var', v: ref('var') };
      expect(']');
      if (!allowIdx) throw new CError('配列の要素は「x = a[i];」で変数に入れてから使ってください', s0);
      if (i.t === 'num' && i.v >= a.len) throw new CError('添字 ' + i.v + ' は配列 ' + a.name + '[' + a.len + '] の外です', s0);
      return { t: 'idx', a, i };
    }
    return { t: 'var', v: ref('var') };
  }
  function parseCond() {
    const s0 = peek().s;
    if (peek().t === 'num') { const n = parseNum(); if (n.v === 0) throw new CError('条件 0 は常に偽なので使えません', n.t.s); return { k: 'true' }; }
    if (isv('!')) { next(); return { k: 'z', a: ref('var') }; }
    if (peek(1).v === '[') throw new CError('条件に配列の要素は書けません。いったん変数に入れてください', s0);
    const a = ref('var');
    const rel = ['==', '!=', '<', '>', '<=', '>='];
    if (!rel.includes(peek().v)) return { k: 'nz', a };
    const op = next().v;
    const K = { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' }[op];
    if (peek().t === 'num') {
      const n = parseNum();
      if (n.v === 0) {
        if (op === '==' || op === '<=') return { k: 'z', a };
        if (op === '!=' || op === '>') return { k: 'nz', a };
        if (op === '>=') return { k: 'true' };
        throw new CError('符号なしなので x < 0 は常に偽です', n.t.s);
      }
      const lim = (K === 'ge' || K === 'lt') ? 512 : 511;
      if (n.v > lim) throw new CError('比較する定数は ' + lim + ' 以下にしてください（大きい数は変数に入れて比べる）', n.t.s);
      return { k: K, a, b: { t: 'num', v: n.v } };
    }
    if (peek(1).v === '[') throw new CError('条件に配列の要素は書けません', peek().s);
    return { k: K, a, b: { t: 'var', v: ref('var') } };
  }
  const BIN = ['+', '-', '*', '/', '%', '>>', '<<'];
  function simple() {
    const t = peek();
    if (t.v === '++' || t.v === '--') { next(); const v = ref('var'); return { k: 'asg', dst: { t: 'var', v }, expr: { t: 'bin', op: t.v[0], a: { t: 'var', v }, b: { t: 'num', v: 1 } } }; }
    if (t.t === 'id' && peek(1).v === '(') {
      const id = next(); next(); expect(')');
      if (curFn !== 'main') throw new CError('関数の中から関数は呼べません（戻り番地レジスタ LR が 1 本だけ）', id.s);
      const n = { k: 'call', name: id.v, s: id.s };
      calls.push(n); return n;
    }
    let dst;
    if (peek(1).v === '[') dst = operand(true);
    else dst = { t: 'var', v: ref('var') };
    const op = next();
    if (dst.t === 'idx') {
      if (op.v !== '=') throw new CError('配列の要素には「a[i] = 値;」だけ書けます', op.s);
      return { k: 'asg', dst, expr: operand(false) };
    }
    const v = dst.v;
    if (op.v === '++' || op.v === '--') return { k: 'asg', dst, expr: { t: 'bin', op: op.v[0], a: { t: 'var', v }, b: { t: 'num', v: 1 } } };
    if (['+=', '-=', '*=', '/=', '%=', '>>=', '<<='].includes(op.v)) {
      const b = operand(false), o = op.v.slice(0, -1);
      if ((o === '>>' || o === '<<') && (b.t !== 'num' || b.v > 15)) throw new CError('シフト量は 0〜15 の定数にしてください', op.s);
      return { k: 'asg', dst, expr: { t: 'bin', op: o, a: { t: 'var', v }, b } };
    }
    if (op.v === '=') {
      const a = operand(true);
      if (BIN.includes(peek().v)) {
        if (a.t === 'idx') throw new CError('配列の要素は「x = a[i];」で一度変数に入れてから計算してください', op.s);
        const o = next().v, b = operand(false);
        if ((o === '>>' || o === '<<') && (b.t !== 'num' || b.v > 15)) throw new CError('シフト量は 0〜15 の定数にしてください', op.s);
        if (BIN.includes(peek().v)) throw new CError('式は演算子 1 つまでです（例: t = a * b; x = t + c;）', peek().s);
        return { k: 'asg', dst, expr: { t: 'bin', op: o, a, b } };
      }
      return { k: 'asg', dst, expr: a };
    }
    throw new CError('使える文: x = 式; x += y; x++; a[i] = y; f(); while; for; if; break; return;', op.s);
  }
  function parseStmt() {
    const t = peek();
    if (t.v === '{') return parseBlock();
    if (t.v === ';') { next(); return { k: 'empty', s: t.s, e: t.e }; }
    if (t.v === 'while') {
      next(); expect('(');
      const c = parseCond(); const rp = expect(')');
      loopDepth++; const body = parseStmt(); loopDepth--;
      return { k: 'while', c, body, s: t.s, e: body.e, head: [t.s, rp.e], close: body.k === 'block' ? body.close : [body.s, body.e] };
    }
    if (t.v === 'for') {
      next(); expect('(');
      let init = null, step = null, c = { k: 'true' };
      if (!isv(';')) { const s0 = peek().s; init = simple(); init.s = s0; init.e = peek().e; }
      expect(';');
      if (!isv(';')) c = parseCond();
      expect(';');
      if (!isv(')')) { const s0 = peek().s; step = simple(); step.s = s0; step.e = toks[p - 1].e; }
      const rp = expect(')');
      loopDepth++; const body = parseStmt(); loopDepth--;
      const close = body.k === 'block' ? body.close : [body.s, body.e];
      const inner = { k: 'block', body: [body].concat(step ? [step] : []), s: body.s, e: body.e, close };
      const w = { k: 'while', c, body: inner, s: t.s, e: body.e, head: [t.s, rp.e], close, isFor: true };
      return { k: 'block', body: (init ? [init] : []).concat([w]), s: t.s, e: body.e, close, synthetic: true };
    }
    if (t.v === 'if') {
      next(); expect('(');
      const c = parseCond(); const rp = expect(')');
      const th = parseStmt();
      let el = null, elseKw = null;
      if (isv('else')) { const ek = next(); elseKw = [ek.s, ek.e]; el = parseStmt(); }
      return { k: 'if', c, then: th, else: el, s: t.s, e: (el || th).e, head: [t.s, rp.e], elseKw };
    }
    if (t.v === 'break') { next(); const sc = expect(';'); if (!loopDepth) throw new CError('break はループの中でだけ使えます', t.s); return { k: 'brk', s: t.s, e: sc.e }; }
    if (t.v === 'return') { next(); if (!isv(';')) parseNum(); const sc = expect(';'); return { k: 'ret', s: t.s, e: sc.e, inMain: curFn === 'main' }; }
    if (t.v === 'do' || t.v === 'continue') throw new CError(t.v + ' は未対応です', t.s);
    if (t.t === 'id' || t.v === '++' || t.v === '--') { const n = simple(); const sc = expect(';'); n.s = t.s; n.e = sc.e; return n; }
    throw new CError('ここに「' + t.v + '」は書けません', t.s);
  }
  function parseBlock() {
    const lb = expect('{');
    const body = [];
    while (isTypeStart()) { parseType(); parseDeclList(); }
    while (!isv('}')) {
      if (peek().t === 'eof') throw new CError('「}」が足りません', lb.s);
      if (isTypeStart()) throw new CError('宣言はブロックの先頭に書いてください', peek().s);
      body.push(parseStmt());
    }
    const rb = next();
    return { k: 'block', body, s: lb.s, e: rb.e, close: [rb.s, rb.e] };
  }
  while (peek().t !== 'eof') {
    if (isTypeStart()) { parseType(); parseDeclList(); continue; }
    const rt = next();
    if (!(rt.v === 'void' || rt.v === 'int')) throw new CError('宣言か関数定義（void f(void) { … }）が必要です', rt.s);
    const nm = next();
    if (nm.t !== 'id') throw new CError('関数名が必要です', nm.s);
    if (funcs[nm.v] || byName[nm.v]) throw new CError(nm.v + ' は定義済みです', nm.s);
    expect('('); if (isv('void')) next(); expect(')');
    curFn = nm.v;
    const body = parseBlock();
    funcs[nm.v] = { k: nm.v === 'main' ? 'main' : 'func', name: nm.v, body, s: rt.s, e: body.e, close: body.close, head: [rt.s, nm.e] };
    curFn = null;
  }
  if (!funcs.main) throw new CError('main 関数がありません', src.length);
  for (const c of calls) { if (!funcs[c.name] || c.name === 'main') throw new CError('関数 ' + c.name + ' が見つかりません', c.s); c.fn = funcs[c.name]; }
  return { k: 'prog', main: funcs.main, funcs, vars, arrays, ramTop };
}

function cCompile(src) {
  const prog = cParse(src);
  const ast = prog.main;
  const fnList = Object.values(prog.funcs).filter(f => f.k === 'func');
  const big = k => k > 511;
  const needOf = n => {
    if (n.k === 'asg') {
      const d = n.dst, e = n.expr;
      if (d.t === 'idx') return 1 + (e.t === 'num' ? 1 : 0);
      if (e.t === 'num') return big(e.v) ? 1 : 0;
      if (e.t === 'idx') return 1;
      if (e.t === 'bin') {
        if (e.op === '*' || e.op === '/' || e.op === '%') return 3;
        if (e.op === '+' || e.op === '-') return (e.b.t === 'num' && e.b.v > 3) || e.a.t === 'num' || (e.b.t === 'var' && e.b.v === d.v && !(e.a.t === 'var' && e.a.v === d.v)) ? 1 : 0;
      }
      return 0;
    }
    if ((n.k === 'while' || n.k === 'if') && n.c) return ['true', 'nz', 'z'].includes(n.c.k) ? 0 : 1;
    return 0;
  };
  const walk = (n, f) => { if (!n) return; f(n); if (n.k === 'block') n.body.forEach(c => walk(c, f)); if (n.k === 'while') walk(n.body, f); if (n.k === 'if') { walk(n.then, f); walk(n.else, f); } };
  let need = 0;
  for (const fn of Object.values(prog.funcs)) walk(fn.body, n => {
    need = Math.max(need, needOf(n));
    if (n.k === 'asg' && n.expr.t === 'bin' && ['*', '/', '%'].includes(n.expr.op)) for (const o of [n.expr.a, n.expr.b]) if (o.t === 'num' && big(o.v)) throw new CError('掛け算・割り算の定数は 511 以下にしてください', n.s);
  });
  const nv = prog.vars.length;
  if (nv + need > NREG) throw new CError('レジスタが足りません: 変数 ' + nv + ' 個 + 作業用 ' + need + ' 本 > 8 本。変数を減らすか配列にまとめてください', prog.vars[Math.max(0, Math.min(nv - 1, NREG - need))].s);
  prog.vars.forEach((v, i) => v.reg = i);
  const TR = [7, 6, 5].slice(0, need);
  const R = r => REGN[r], T1 = () => R(TR[0]), T2 = () => R(TR[1]), T3 = () => R(TR[2]);
  const lines = [];
  let uid = 0, gid = 0;
  const snip = n => src.slice(n.s, n.e).replace(/\s+/g, ' ').slice(0, 40);
  function emit(node, role, rule, list, com) {
    node.n = node.n || {};
    const ins = list.filter(x => Array.isArray(x));
    node.n[role] = ins.length;
    const g = gid++;
    let i = 0;
    for (const x of list) {
      if (!Array.isArray(x)) { lines.push({ kind: 'label', name: x.label }); continue; }
      lines.push({ kind: 'instr', op: x[0], args: x.slice(1), node, role, rule, idx: i, cnt: ins.length, g, com: i === 0 ? com : '' });
      i++;
    }
  }
  const lab = name => lines.push({ kind: 'label', name });
  const rep = (k, f) => { const o = []; for (let i = 0; i < k; i++) o.push(f()); return o; };
  const loadK = (X, k) => {
    if (k <= 511) return [['LDI', X, k]];
    const o = [['LDI', X, k >> 8]].concat(rep(8, () => ['ADD', X, X]));
    if (k & 255) o.push(['LDI', T1(), k & 255], ['ADD', X, T1()]);
    return o;
  };
  const loadOp = (X, o) => o.t === 'num' ? loadK(X, o.v) : (R(o.v.reg) === X ? [] : [['MOV', X, R(o.v.reg)]]);
  const addr = (Tn, a, i) => i.t === 'num' ? [['LDI', Tn, a.base + i.v]] : (a.base === 0 ? [['MOV', Tn, R(i.v.reg)]] : [['LDI', Tn, a.base], ['ADD', Tn, R(i.v.reg)]]);

  function genAsg(n) {
    const d = n.dst, e = n.expr;
    let list = [], rule;
    if (d.t === 'idx') {
      list = addr(T1(), d.a, d.i);
      if (e.t === 'num') list = list.concat([['LDI', T2(), e.v], ['ST', T2(), '[' + T1() + ']']]);
      else list.push(['ST', R(e.v.reg), '[' + T1() + ']']);
      return emit(n, 'asg', 'T-STORE', list, snip(n));
    }
    const x = d.v.reg, X = R(x);
    if (e.t === 'num') { list = loadK(X, e.v); rule = 'T-LDI'; }
    else if (e.t === 'var') { list = loadOp(X, e); rule = 'T-MOV'; }
    else if (e.t === 'idx') { list = addr(T1(), e.a, e.i).concat([['LD', X, '[' + T1() + ']']]); rule = 'T-LOAD'; }
    else {
      let { op, a, b } = e;
      if ((op === '+' || op === '*') && a.t === 'num' && b.t === 'var') { const t = a; a = b; b = t; }
      const id = uid++;
      if (op === '+' || op === '-') {
        const OP = op === '+' ? 'ADD' : 'SUB', ID = op === '+' ? 'INC' : 'DEC';
        rule = op === '+' ? 'T-ADD' : 'T-SUB';
        if (b.t === 'var' && b.v.reg === x && !(a.t === 'var' && a.v.reg === x)) {
          if (op === '+') list = a.t === 'var' ? [['ADD', X, R(a.v.reg)]] : loadK(T1(), a.v).concat([['ADD', X, T1()]]);
          else list = loadOp(T1(), a).concat([['SUB', T1(), X], ['MOV', X, T1()]]);
        } else {
          list = loadOp(X, a);
          if (b.t === 'var') list.push([OP, X, R(b.v.reg)]);
          else if (b.v <= 3) list = list.concat(rep(b.v, () => [ID, X]));
          else list = list.concat(loadK(T1(), b.v), [[OP, X, T1()]]);
        }
      } else if (op === '>>' || op === '<<') {
        list = loadOp(X, a).concat(rep(b.v, () => op === '>>' ? ['SHR', X] : ['ADD', X, X]));
        rule = op === '>>' ? 'T-SHR' : 'T-SHL';
      } else if (op === '*') {
        const A = T1(), B = T2(), P = T3(), L = 'mul' + id + '_L', S = 'mul' + id + '_S', E = 'mul' + id + '_E';
        list = loadOp(A, a).concat(loadOp(B, b), [['SUB', P, P], { label: L }, ['JZ', B, E], ['SHR', B], ['JNC', S], ['ADD', P, A], { label: S }, ['ADD', A, A], ['JMP', L], { label: E }, ['MOV', X, P]]);
        rule = 'T-MUL';
      } else {
        const N = T1(), Rr = T2(), K = T3(), q = 'div' + id + '_';
        let Z;
        list = loadOp(N, a).concat([['SUB', Rr, Rr], ['LDI', K, 16]]);
        if (b.t === 'var') Z = R(b.v.reg); else { Z = X; list = list.concat(loadK(X, b.v)); }
        list = list.concat([{ label: q + 'L' }, ['ADD', N, N], ['JNC', q + 's0'], ['ADD', Rr, Rr], ['JC', q + 'f1'], ['INC', Rr], ['JMP', q + 'cmp'],
          { label: q + 'f1' }, ['INC', Rr], ['JMP', q + 'force'], { label: q + 's0' }, ['ADD', Rr, Rr], ['JC', q + 'force'],
          { label: q + 'cmp' }, ['SUB', Rr, Z], ['JNC', q + 'one'], ['ADD', Rr, Z], ['JMP', q + 'nx'],
          { label: q + 'force' }, ['SUB', Rr, Z], { label: q + 'one' }, ['INC', N], { label: q + 'nx' }, ['DEC', K], ['JNZ', K, q + 'L'],
          ['MOV', X, op === '/' ? N : Rr]]);
        rule = 'T-DIV';
      }
    }
    emit(n, 'asg', rule, list, snip(n));
  }
  function genCond(node, c, L, com) {
    const A = c.a ? R(c.a.reg) : null;
    let list = [], rule;
    if (c.k === 'true') list = [];
    else if (c.k === 'nz') { list = [['JZ', A, L]]; rule = 'T-NZ'; }
    else if (c.k === 'z') { list = [['JNZ', A, L]]; rule = 'T-Z'; }
    else if (c.b.t === 'var') {
      const B = R(c.b.v.reg), t = T1(), sw = c.k === 'gt' || c.k === 'le';
      list = [['MOV', t, sw ? B : A], ['SUB', t, sw ? A : B]];
      list.push({ lt: ['JNC', L], ge: ['JC', L], gt: ['JNC', L], le: ['JC', L], eq: ['JNZ', t, L], ne: ['JZ', t, L] }[c.k]);
      rule = { lt: 'T-LT', ge: 'T-GE', gt: 'T-GT', le: 'T-LE', eq: 'T-EQ', ne: 'T-NE' }[c.k];
    } else {
      const k = c.b.v, t = T1();
      rule = 'T-CMPK';
      list = {
        eq: [['LDI', t, k], ['SUB', t, A], ['JNZ', t, L]], ne: [['LDI', t, k], ['SUB', t, A], ['JZ', t, L]],
        gt: [['LDI', t, k], ['SUB', t, A], ['JNC', L]], le: [['LDI', t, k], ['SUB', t, A], ['JC', L]],
        ge: [['LDI', t, k - 1], ['SUB', t, A], ['JNC', L]], lt: [['LDI', t, k - 1], ['SUB', t, A], ['JC', L]],
      }[c.k];
    }
    emit(node, 'cond', rule, list, com);
  }
  const loops = [];
  let fnNow = null;
  function gen(n) {
    switch (n.k) {
      case 'block': n.body.forEach(gen); break;
      case 'empty': break;
      case 'asg': genAsg(n); break;
      case 'call': emit(n, 'call', 'T-CALL', [['CALL', n.name]], n.name + '();'); break;
      case 'while': {
        const id = uid++, L = (n.isFor ? 'for' : 'while') + id, E = 'end' + (n.isFor ? 'f' : 'w') + id;
        lab(L);
        genCond(n, n.c, E, src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' ').slice(0, 40));
        loops.push(E); gen(n.body); loops.pop();
        emit(n, 'back', 'T-WHILE', [['JMP', L]], '} → ' + L + ' へ戻る');
        lab(E); break;
      }
      case 'if': {
        const id = uid++, hd = src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' ');
        if (n.else) {
          const F = 'else' + id, E = 'endif' + id;
          genCond(n, n.c, F, hd); gen(n.then);
          emit(n, 'skip', 'T-IFELSE', [['JMP', E]], 'else を飛ばす');
          lab(F); gen(n.else); lab(E);
        } else { const E = 'endif' + id; genCond(n, n.c, E, hd); gen(n.then); lab(E); }
        break;
      }
      case 'brk': emit(n, 'brk', 'T-BREAK', [['JMP', loops[loops.length - 1]]], 'break'); break;
      case 'ret': if (fnNow.k === 'main') emit(n, 'halt', 'T-RET', [['HALT']], 'return;'); else emit(n, 'ret', 'T-FRET', [['RET']], 'return;'); break;
    }
  }
  fnNow = ast; gen(ast.body); emit(ast, 'halt', 'T-END', [['HALT']], 'main の終わり');
  for (const fn of fnList) { fnNow = fn; lab(fn.name); gen(fn.body); emit(fn, 'ret', 'T-FRET', [['RET']], fn.name + ' の終わり'); }
  ast.prog = prog; ast.vars = prog.vars; ast.arrays = prog.arrays; ast.temps = TR; ast.funcs = prog.funcs;

  const out = ['; main.c から自動生成（翻訳規則 T-*）'], meta = [null];
  for (const v of prog.vars) { out.push(('        .reg  ' + R(v.reg) + ', ' + v.init).padEnd(34) + '; unsigned int ' + v.name + ' = ' + v.init + ';'); meta.push(null); }
  for (const a of prog.arrays) { out.push(('        .ram  ' + a.base + ', ' + a.init.join(', ')).padEnd(34) + '; ' + a.name + '[' + a.len + '] は RAM ' + a.base + '〜' + (a.base + a.len - 1)); meta.push(null); }
  if (TR.length) { out.push('        ; ' + TR.map(R).join(', ') + ' は作業用（比較・掛け算・割り算・番地計算）'); meta.push(null); }
  let pend = [];
  for (const l of lines) {
    if (l.kind === 'label') { pend.push(l.name); continue; }
    while (pend.length > 1) { out.push(pend.shift() + ':'); meta.push(null); }
    const lb = pend.length ? pend.shift() + ':' : '';
    const body = l.op.padEnd(6) + l.args.join(', ');
    const t = lb.length >= 8 ? (lb + ' ' + body).padEnd(34) : (lb.padEnd(8) + body).padEnd(34);
    out.push(t + (l.idx === 0 ? '; ' + (l.com || '') + '  [' + l.rule + ']' : '; 〃'));
    meta.push({ node: l.node, role: l.role, rule: l.rule, idx: l.idx, cnt: l.cnt, g: l.g });
  }
  while (pend.length) { out.push(pend.shift() + ':'); meta.push(null); }
  return { ast, prog, asm: out.join('\n') + '\n', meta };
}

/* ---------------------------------------------------------------------
 *  アセンブラ
 * ------------------------------------------------------------------- */
function assemble(text) {
  const lines = text.split('\n');
  const errors = [], labels = {}, instrs = [];
  const init = new Array(NREG).fill(0), ram = new Array(RAMN).fill(0);
  const lineAddr = new Array(lines.length).fill(-1);
  const regOf = (s, ln) => { const i = REGN.indexOf((s || '').replace(/[\[\]\s]/g, '').toLowerCase()); if (i < 0) errors.push({ line: ln, msg: 'レジスタは a〜h のどれかです（「' + (s || '') + '」）' }); return Math.max(i, 0); };
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
      const v = parseInt(m[2]); if (isNaN(v) || v < 0 || v > MASK) errors.push({ line: ln, msg: '初期値は 0〜65535 です' });
      init[regOf(m[1], ln)] = v & MASK; return;
    }
    if ((m = s.match(/^\.ram\s+(\d+)\s*,(.*)$/))) {
      let a = parseInt(m[1]);
      for (const x of m[2].split(',')) { const v = parseInt(x); if (isNaN(v) || v < 0 || v > MASK || a >= RAMN) { errors.push({ line: ln, msg: '.ram の値か番地が範囲外です（番地 0〜63、値 0〜65535）' }); break; } ram[a++] = v; }
      return;
    }
    if (s[0] === '.') { errors.push({ line: ln, msg: '知らない疑似命令です: ' + s.split(/\s/)[0] }); return; }
    m = s.match(/^([A-Za-z]+)\s*(.*)$/);
    if (!m) { errors.push({ line: ln, msg: '読めません: ' + s }); return; }
    const mn = m[1].toUpperCase();
    if (!MN[mn]) { errors.push({ line: ln, msg: '知らない命令です: ' + mn + '（' + Object.keys(MN).join(' ') + '）' }); return; }
    const args = m[2] ? m[2].split(',').map(x => x.trim()).filter(x => x) : [];
    const [op, sig, rfix] = MN[mn];
    if (args.length !== sig.length) errors.push({ line: ln, msg: mn + ' のオペランドは ' + sig.length + ' 個です（' + A_SYN[mn] + '）' });
    const it = { addr: instrs.length, op: mn, opc: op, r: rfix || 0, s: 0, imm: 0, target: null, targetText: null, line: ln };
    [...sig].forEach((k, i) => {
      const x = args[i];
      if (k === 'r') it.r = regOf(x, ln);
      else if (k === 's' || k === 'm') it.s = regOf(x, ln);
      else if (k === 'i') { const v = parseInt(x); if (isNaN(v) || v < 0 || v > 511) errors.push({ line: ln, msg: 'LDI の定数は 0〜511 です' }); it.imm = v & 511; }
      else it.targetText = x;
    });
    lineAddr[ln] = instrs.length;
    instrs.push(it);
  });
  let implicitHalt = false;
  const last = instrs[instrs.length - 1];
  if (!last || !(['HALT', 'JMP', 'RET'].includes(last.op))) { instrs.push({ addr: instrs.length, op: 'HALT', opc: 0, r: 0, s: 0, line: -1, implicit: true }); implicitHalt = true; }
  if (instrs.length > MEM) errors.push({ line: 0, msg: '命令が ' + instrs.length + ' 個あります。命令メモリは ' + MEM + ' 語までです' });
  for (const it of instrs) {
    if (it.targetText == null) continue;
    const t = it.targetText;
    if (labels[t] !== undefined) it.target = labels[t];
    else if (/^\d+$/.test(t)) it.target = parseInt(t);
    else { errors.push({ line: it.line, msg: 'ラベル ' + t + ' が見つかりません' }); it.target = 0; }
    if (it.target >= instrs.length) errors.push({ line: it.line, msg: '分岐先 ' + t + ' (=' + it.target + ') がプログラムの外です' });
  }
  const words = instrs.map(it => encode(it.opc, it.r, it.s, it.op === 'LDI' ? it.imm : (it.target || 0)));
  return { words, instrs, labels, init, ram, lineAddr, errors, implicitHalt, lines };
}

/* ---------------------------------------------------------------------
 *  レベル 1 : C インタプリタ
 * ------------------------------------------------------------------- */
class CInterp {
  constructor(ast) {
    this.ast = ast;
    this.env = {}; this.arr = {};
    ast.vars.forEach(v => this.env[v.name] = v.init);
    ast.arrays.forEach(a => this.arr[a.name] = a.init.slice());
    this.halted = false;
    this.gen = this.run();
    this.cur = this.gen.next().value;
  }
  val(o) {
    if (o.t === 'num') return o.v;
    if (o.t === 'var') return this.env[o.v.name];
    const i = this.val(o.i), x = this.arr[o.a.name][i]; return x !== undefined ? x : 0;
  }
  evalExpr(e) {
    if (e.t !== 'bin') return this.val(e) & MASK;
    const a = this.val(e.a), b = this.val(e.b);
    switch (e.op) {
      case '+': return (a + b) & MASK; case '-': return (a - b) & MASK;
      case '*': return (Math.imul(a, b) & MASK) >>> 0;
      case '/': return b === 0 ? MASK : Math.floor(a / b);
      case '%': return b === 0 ? a : a % b;
      case '>>': return a >>> b; case '<<': return (a << b) & MASK;
    }
  }
  test(c) {
    const a = c.a ? this.env[c.a.name] : 0, b = c.b ? this.val(c.b) : 0;
    switch (c.k) { case 'true': return true; case 'nz': return a !== 0; case 'z': return a === 0; case 'lt': return a < b; case 'gt': return a > b; case 'le': return a <= b; case 'ge': return a >= b; case 'eq': return a === b; case 'ne': return a !== b; }
  }
  *ev(node, role, def, stack) { if (node.n && node.n[role] > 0) yield { node, role, def, stack, cnt: node.n[role] }; }
  assign(n) {
    const v = this.evalExpr(n.expr);
    if (n.dst.t === 'var') this.env[n.dst.v.name] = v;
    else { const i = this.val(n.dst.i); if (i < n.dst.a.len) this.arr[n.dst.a.name][i] = v; }
  }
  // 戻り値: undefined | 'brk' | 'halt' | 'fret'
  *exec(n, stack) {
    switch (n.k) {
      case 'block': for (const c of n.body) { const r = yield* this.exec(c, stack); if (r) return r; } return;
      case 'empty': return;
      case 'asg': yield* this.ev(n, 'asg', n.dst.t === 'idx' ? 'C-STORE' : 'C-ASG', stack); this.assign(n); return;
      case 'call': {
        yield* this.ev(n, 'call', 'C-CALL', stack);
        const st = stack.concat([n.fn]);
        const r = yield* this.exec(n.fn.body, st);
        if (r === 'halt') return r;
        if (r !== 'fret') yield* this.ev(n.fn, 'ret', 'C-FEND', st);
        return;
      }
      case 'while': {
        const st = stack.concat([n]);
        for (;;) {
          yield* this.ev(n, 'cond', 'C-WHILE', st);
          if (!this.test(n.c)) return;
          const r = yield* this.exec(n.body, st);
          if (r === 'brk') return;
          if (r) return r;
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
      case 'ret':
        if (n.inMain) { yield* this.ev(n, 'halt', 'C-RET', stack); return 'halt'; }
        yield* this.ev(n, 'ret', 'C-RET', stack); return 'fret';
    }
  }
  *run() {
    const top = [this.ast];
    const r = yield* this.exec(this.ast.body, top);
    if (r !== 'halt') yield* this.ev(this.ast, 'halt', 'C-END', top);
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
  reset() { this.R = this.a.init.slice(); this.ram = this.a.ram.slice(); this.C = 0; this.LR = 0; this.pc = 0; this.halted = false; this.count = new Array(this.a.instrs.length).fill(0); }
  cur() { return this.a.instrs[this.pc]; }
  tgt(it) { return (this.a.labels[it.targetText] ?? it.target) & 255; }
  step() {
    if (this.halted) return;
    const it = this.a.instrs[this.pc];
    if (!it) { this.halted = true; return; }
    this.count[this.pc]++;
    const R = this.R, r = it.r, s = it.s;
    let next = (this.pc + 1) & 255;
    switch (it.op) {
      case 'INC': R[r] = (R[r] + 1) & MASK; break;
      case 'DEC': R[r] = (R[r] - 1) & MASK; break;
      case 'ADD': { const t = R[r] + R[s]; this.C = t > MASK ? 1 : 0; R[r] = t & MASK; break; }
      case 'SUB': this.C = R[r] < R[s] ? 1 : 0; R[r] = (R[r] - R[s]) & MASK; break;
      case 'MOV': R[r] = R[s]; break;
      case 'SHR': this.C = R[r] & 1; R[r] >>>= 1; break;
      case 'LDI': R[r] = it.imm; break;
      case 'LD': R[r] = this.ram[R[s] & 63]; break;
      case 'ST': this.ram[R[s] & 63] = R[r]; break;
      case 'JZ': if (R[r] === 0) next = this.tgt(it); break;
      case 'JNZ': if (R[r] !== 0) next = this.tgt(it); break;
      case 'JC': if (this.C) next = this.tgt(it); break;
      case 'JNC': if (!this.C) next = this.tgt(it); break;
      case 'JMP': next = this.tgt(it); break;
      case 'CALL': this.LR = next; next = this.tgt(it); break;
      case 'RET': next = this.LR; break;
      case 'HALT': this.halted = true; next = this.pc; break;
    }
    this.pc = next;
  }
}

/* ---------------------------------------------------------------------
 *  レベル 3 : 機械語インタプリタ
 * ------------------------------------------------------------------- */
class McInterp {
  constructor(words, init, ram) { this.words = words; this.init = init; this.ram0 = ram; this.reset(); }
  reset() { this.R = this.init.slice(); this.ram = this.ram0.slice(); this.C = 0; this.LR = 0; this.pc = 0; this.halted = false; this.err = null; this.trace = []; }
  fetch() { return this.pc < this.words.length ? this.words[this.pc] : 0; }
  step() {
    if (this.halted) return;
    const w = this.fetch(), { op, r, s, a } = decode(w), R = this.R;
    const pc0 = this.pc, before = R[r], c0 = this.C;
    let npc = (this.pc + 1) & 255, mem = null;
    switch (op) {
      case 0: this.halted = true; npc = this.pc; break;
      case 1: R[r] = (R[r] + 1) & MASK; break;
      case 2: R[r] = (R[r] - 1) & MASK; break;
      case 3: if (R[r] === 0) npc = a & 255; break;
      case 4: npc = a & 255; break;
      case 5: { const t = R[r] + R[s]; this.C = t >>> 16; R[r] = t & MASK; break; }
      case 6: { const t = R[r] - R[s]; this.C = t < 0 ? 1 : 0; R[r] = t & MASK; break; }
      case 7: R[r] = R[s]; break;
      case 8: this.C = R[r] & 1; R[r] = R[r] >>> 1; break;
      case 9: if ((r & 1) ? !this.C : this.C) npc = a & 255; break;
      case 10: if (R[r] !== 0) npc = a & 255; break;
      case 11: R[r] = a; break;
      case 12: mem = R[s] & 63; R[r] = this.ram[mem]; break;
      case 13: mem = R[s] & 63; this.ram[mem] = R[r]; break;
      case 14: this.LR = npc; npc = a & 255; break;
      case 15: npc = this.LR; break;
    }
    this.pc = npc;
    this.trace.push({ pc: pc0, w, r, before, after: R[r], c0, c1: this.C, npc, mem });
    if (this.trace.length > 200) this.trace.shift();
  }
}

/* ---------------------------------------------------------------------
 *  レベル 4 : ゲートレベル回路（単一サイクル CPU）
 * ------------------------------------------------------------------- */
const BLOCKS = [
  { id: 'pc', name: 'PC・LR・フラグ', desc: 'プログラムカウンタ PC (8bit)、戻り番地 LR (8bit)、停止フラグ HALTED、桁上げフラグ C' },
  { id: 'rom', name: 'ROM（命令メモリ）', desc: '256 語 × 16bit。プログラム内蔵方式: 命令はデータと同じ 2 進数として格納' },
  { id: 'dec', name: '命令デコーダ', desc: 'オペコード 4bit → one-hot の制御信号 16 本' },
  { id: 'rsel', name: 'r 選択', desc: 'r 3bit → SR0..SR7（書き込み先・X 側）' },
  { id: 'ssel', name: 's 選択', desc: 's 3bit → SS0..SS7（W 側）' },
  { id: 'rmux', name: '読み出し X', desc: 'X = R[r]（8 入力 MUX × 16bit）' },
  { id: 'smux', name: '読み出し W', desc: 'W = R[s]（8 入力 MUX × 16bit）' },
  { id: 'zero', name: 'ゼロ検出', desc: 'Z = ¬(X15+…+X0)' },
  { id: 'ram', name: 'RAM', desc: '64 語 × 16bit。番地 = W の下 6 ビット。LD で読み、ST で書く' },
  { id: 'alu', name: 'ALU', desc: 'Σ = X + B + cin。結果 Y = Σ / W (MOV) / X>>1 (SHR) / 即値 (LDI) / RAM (LD)' },
  { id: 'regs', name: 'レジスタファイル', desc: 'a〜h の 8×16bit DFF と書き込み選択' },
  { id: 'pcinc', name: 'PC+1', desc: '8bit 半加算器チェーン' },
  { id: 'br', name: '分岐・フラグ制御', desc: 'BR = JMP + CALL + JZ·Z + JNZ·¬Z + JC·C + JNC·¬C / HOLD = HALT / C の次の値' },
  { id: 'pcmux', name: '次 PC 選択', desc: 'NPC = HOLD ? PC : RET ? LR : BR ? a : PC+1' },
];

function buildCircuit() {
  const nets = [], byName = {}, gates = [];
  const net = name => { if (byName[name] !== undefined) return byName[name]; const id = nets.length; nets.push({ id, name, driver: -1 }); byName[name] = id; return id; };
  const G = (type, insN, outN, block, role) => {
    const ins = insN.map(n => typeof n === 'number' ? n : net(n));
    const out = net(outN);
    const base = type.replace(/\d+$/, '');
    const g = { id: gates.length, type, base, ins, out, block, role, def: 'G-' + base };
    nets[out].driver = g.id; gates.push(g);
    return out;
  };
  const dffs = [];
  const DFF = (d, q, block, role) => { G('DFF', [d], q, block, role); dffs.push(byName[q]); };
  const OPN = ['HALT', 'INC', 'DEC', 'JZ', 'JMP', 'ADD', 'SUB', 'MOV', 'SHR', 'JCC', 'JNZ', 'LDI', 'LD', 'ST', 'CALL', 'RET'];
  const nm = x => x[0] === 'n' ? '¬' + x.slice(1) : x;

  G('CONST1', [], 'ONE', 'pcinc', '定数 1');
  const romOuts = []; for (let i = 0; i < IW; i++) romOuts.push(net('I' + i));
  const rom = { id: gates.length, type: 'ROM', base: 'ROM', ins: [...Array(PCW).keys()].map(i => net('PC' + i)), out: romOuts[0], outs: romOuts, block: 'rom', role: 'I15..I0 = ROM[PC]', def: 'G-ROM' };
  romOuts.forEach(o => nets[o].driver = rom.id); gates.push(rom);
  for (let i = 12; i < 16; i++) G('NOT', ['I' + i], 'nI' + i, 'dec', 'nI' + i + ' = ¬I' + i);
  OPN.forEach((n, op) => {
    const b = bin(op, 4), ins = [15, 14, 13, 12].map((bit, k) => (b[k] === '1' ? 'I' : 'nI') + bit);
    G('AND4', ins, 'is' + n, 'dec', 'is' + n + ' = ' + ins.map(nm).join('·') + '   (' + b + ')');
  });
  const sel = (blk, pre, hi) => {
    for (let i = hi - 2; i <= hi; i++) G('NOT', ['I' + i], 'nI' + i, blk, 'nI' + i + ' = ¬I' + i);
    for (let k = 0; k < 8; k++) {
      const b = bin(k, 3), ins = [hi, hi - 1, hi - 2].map((bit, j) => (b[j] === '1' ? 'I' : 'nI') + bit);
      G('AND3', ins, pre + k, blk, pre + k + ' = ' + ins.map(nm).join('·') + '   (' + REGN[k] + ')');
    }
  };
  sel('rsel', 'SR', 11); sel('ssel', 'SS', 8);
  for (let i = 0; i < W; i++) {
    const tx = REGN.map((r, k) => G('AND2', ['SR' + k, 'R' + r + i], 'x' + r + i, 'rmux', 'x' + r + i + ' = SR' + k + '·R' + r + i));
    G('OR8', tx, 'X' + i, 'rmux', 'X' + i + ' = Σ_k SRk·Rk' + i);
    const tw = REGN.map((r, k) => G('AND2', ['SS' + k, 'R' + r + i], 'w' + r + i, 'smux', 'w' + r + i + ' = SS' + k + '·R' + r + i));
    G('OR8', tw, 'W' + i, 'smux', 'W' + i + ' = Σ_k SSk·Rk' + i);
  }
  G('NOR16', [...Array(W).keys()].map(i => 'X' + i), 'Z', 'zero', 'Z = ¬(X0+X1+…+X15)');
  const mdOuts = []; for (let i = 0; i < W; i++) mdOuts.push(net('MD' + i));
  const ram = { id: gates.length, type: 'RAM', base: 'RAM', ins: [...Array(ABITS).keys()].map(i => net('W' + i)), out: mdOuts[0], outs: mdOuts, block: 'ram', role: 'MD = RAM[W mod 64]（ST のときクロック↑で RAM[W] ← X）', def: 'G-RAM' };
  mdOuts.forEach(o => nets[o].driver = ram.id); gates.push(ram);
  for (let i = 0; i < W; i++) {
    G('NOT', ['W' + i], 'nW' + i, 'alu', 'nW' + i + ' = ¬W' + i);
    G('AND2', ['isADD', 'W' + i], 'bA' + i, 'alu', 'B' + i + ' の ADD 側: isADD·W' + i);
    G('AND2', ['isSUB', 'nW' + i], 'bS' + i, 'alu', 'B' + i + ' の SUB 側: isSUB·¬W' + i);
    G(i === 0 ? 'OR4' : 'OR3', i === 0 ? ['bA0', 'bS0', 'isDEC', 'isINC'] : ['bA' + i, 'bS' + i, 'isDEC'], 'B' + i, 'alu', 'B' + i + ' = isADD·W' + i + ' + isSUB·¬W' + i + ' + isDEC' + (i === 0 ? ' + isINC' : ''));
    const c = i === 0 ? 'isSUB' : 'c' + i;
    G('XOR2', ['X' + i, 'B' + i], 'p' + i, 'alu', 'FA' + i + ': p' + i + ' = X' + i + ' ⊕ B' + i);
    G('XOR2', ['p' + i, c], 'u' + i, 'alu', 'FA' + i + ': Σ' + i + ' = p' + i + ' ⊕ ' + (i ? 'c' + i : 'cin'));
    G('AND2', ['X' + i, 'B' + i], 'g' + i, 'alu', 'FA' + i + ': g' + i + ' = X' + i + '·B' + i);
    G('AND2', ['p' + i, c], 'h' + i, 'alu', 'FA' + i + ': h' + i + ' = p' + i + '·' + (i ? 'c' + i : 'cin'));
    G('OR2', ['g' + i, 'h' + i], 'c' + (i + 1), 'alu', 'FA' + i + ': c' + (i + 1) + ' = g' + i + ' + h' + i);
  }
  G('OR4', ['isMOV', 'isSHR', 'isLDI', 'isLD'], 'nonA', 'alu', 'nonA = MOV + SHR + LDI + LD（加算器の結果を使わない）');
  G('NOT', ['nonA'], 'useS', 'alu', 'useS = ¬nonA');
  for (let i = 0; i < W; i++) {
    const t = [];
    t.push(G('AND2', ['useS', 'u' + i], 'ys' + i, 'alu', 'Y' + i + ' の Σ 側'));
    t.push(G('AND2', ['isMOV', 'W' + i], 'ym' + i, 'alu', 'Y' + i + ' の MOV 側'));
    if (i < W - 1) t.push(G('AND2', ['isSHR', 'X' + (i + 1)], 'yh' + i, 'alu', 'Y' + i + ' の SHR 側: X' + (i + 1)));
    if (i < 9) t.push(G('AND2', ['isLDI', 'I' + i], 'yi' + i, 'alu', 'Y' + i + ' の LDI 側: I' + i));
    t.push(G('AND2', ['isLD', 'MD' + i], 'yl' + i, 'alu', 'Y' + i + ' の LD 側: MD' + i));
    G('OR' + t.length, t, 'Y' + i, 'alu', 'Y' + i + ' = 結果の選択');
  }
  G('OR8', ['isINC', 'isDEC', 'isADD', 'isSUB', 'isMOV', 'isSHR', 'isLDI', 'isLD'], 'WE', 'regs', 'WE = レジスタに書く命令');
  REGN.forEach((r, k) => {
    G('AND2', ['WE', 'SR' + k], 'WE' + r, 'regs', 'WE' + r + ' = WE·SR' + k);
    G('NOT', ['WE' + r], 'nWE' + r, 'regs', 'nWE' + r + ' = ¬WE' + r);
    for (let i = 0; i < W; i++) {
      G('AND2', ['WE' + r, 'Y' + i], 'wy' + r + i, 'regs', 'D' + r + i + ' 書込側');
      G('AND2', ['nWE' + r, 'R' + r + i], 'wk' + r + i, 'regs', 'D' + r + i + ' 保持側');
      G('OR2', ['wy' + r + i, 'wk' + r + i], 'D' + r + i, 'regs', 'D' + r + i + ' = WE' + r + ' ? Y' + i + ' : R' + r + i);
    }
  });
  REGN.forEach(r => { for (let i = 0; i < W; i++) DFF('D' + r + i, 'R' + r + i, 'regs', 'R' + r + i + ' ← D' + r + i + '（クロック↑）'); });
  for (let i = 0; i < PCW; i++) {
    const k = i === 0 ? 'ONE' : 'k' + i;
    G('XOR2', ['PC' + i, k], 'P' + i, 'pcinc', 'P' + i + ' = PC' + i + ' ⊕ k' + i);
    if (i < PCW - 1) G('AND2', ['PC' + i, k], 'k' + (i + 1), 'pcinc', 'k' + (i + 1) + ' = PC' + i + '·k' + i);
  }
  G('NOT', ['Z'], 'nZ', 'br', 'nZ = ¬Z');
  G('NOT', ['CF'], 'nCF', 'br', 'nCF = ¬C');
  G('NOT', ['I9'], 'nI9', 'br', 'nI9 = ¬I9（JC と JNC の区別）');
  G('AND2', ['isJZ', 'Z'], 'tJZ', 'br', 'tJZ = isJZ·Z');
  G('AND2', ['isJNZ', 'nZ'], 'tJNZ', 'br', 'tJNZ = isJNZ·¬Z');
  G('AND3', ['isJCC', 'nI9', 'CF'], 'tJC', 'br', 'tJC = isJCC·¬I9·C');
  G('AND3', ['isJCC', 'I9', 'nCF'], 'tJNC', 'br', 'tJNC = isJCC·I9·¬C');
  G('OR6', ['isJMP', 'isCALL', 'tJZ', 'tJNZ', 'tJC', 'tJNC'], 'BR', 'br', 'BR = JMP + CALL + tJZ + tJNZ + tJC + tJNC');
  G('NOT', ['BR'], 'nBR', 'br', 'nBR = ¬BR');
  G('NOT', ['isHALT'], 'nHOLD', 'br', 'nHOLD = ¬HOLD（HOLD = isHALT）');
  G('NOT', ['isRET'], 'nRET', 'br', 'nRET = ¬isRET');
  G('NOT', ['isCALL'], 'nCALL', 'br', 'nCALL = ¬isCALL');
  G('NOT', ['c16'], 'nc16', 'br', 'nc16 = ¬c16（引き算の借り）');
  G('AND2', ['isADD', 'c16'], 'fA', 'br', 'fA = isADD·c16');
  G('AND2', ['isSUB', 'nc16'], 'fS', 'br', 'fS = isSUB·¬c16（X < W）');
  G('AND2', ['isSHR', 'X0'], 'fH', 'br', 'fH = isSHR·X0');
  G('OR3', ['isADD', 'isSUB', 'isSHR'], 'fW', 'br', 'fW = C を書き換える命令');
  G('NOT', ['fW'], 'nfW', 'br', 'nfW = ¬fW');
  G('AND2', ['nfW', 'CF'], 'fK', 'br', 'fK = ¬fW·C（保持）');
  G('OR4', ['fA', 'fS', 'fH', 'fK'], 'C_D', 'br', 'C_D = C の次の値');
  for (let i = 0; i < PCW; i++) {
    G('AND2', ['BR', 'I' + i], 'ba' + i, 'pcmux', 'BR·a' + i);
    G('AND2', ['nBR', 'P' + i], 'bp' + i, 'pcmux', '¬BR·P' + i);
    G('OR2', ['ba' + i, 'bp' + i], 'M' + i, 'pcmux', 'M' + i + ' = BR ? a' + i + ' : P' + i);
    G('AND2', ['isRET', 'LR' + i], 'rl' + i, 'pcmux', 'RET·LR' + i);
    G('AND2', ['nRET', 'M' + i], 'rm' + i, 'pcmux', '¬RET·M' + i);
    G('OR2', ['rl' + i, 'rm' + i], 'N' + i, 'pcmux', 'N' + i + ' = RET ? LR' + i + ' : M' + i);
    G('AND2', ['isHALT', 'PC' + i], 'hp' + i, 'pcmux', 'HOLD·PC' + i);
    G('AND2', ['nHOLD', 'N' + i], 'hm' + i, 'pcmux', '¬HOLD·N' + i);
    G('OR2', ['hp' + i, 'hm' + i], 'NPC' + i, 'pcmux', 'NPC' + i + ' = HOLD ? PC' + i + ' : N' + i);
    G('AND2', ['isCALL', 'P' + i], 'lc' + i, 'pc', 'CALL·P' + i);
    G('AND2', ['nCALL', 'LR' + i], 'lk' + i, 'pc', '¬CALL·LR' + i);
    G('OR2', ['lc' + i, 'lk' + i], 'LR_D' + i, 'pc', 'LR_D' + i + ' = CALL ? P' + i + ' : LR' + i);
  }
  for (let i = 0; i < PCW; i++) DFF('NPC' + i, 'PC' + i, 'pc', 'PC' + i + ' ← NPC' + i + '（クロック↑）');
  for (let i = 0; i < PCW; i++) DFF('LR_D' + i, 'LR' + i, 'pc', 'LR' + i + ' ← LR_D' + i + '（クロック↑）');
  G('OR2', ['HALTED', 'isHALT'], 'HALT_D', 'pc', 'HALT_D = HALTED + isHALT');
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
    const dd = (g.type === 'ROM' || g.type === 'RAM') ? d + 2 : g.base === 'CONST' ? 0 : d + 1;
    (g.outs || [g.out]).forEach(o => depth[o] = dd);
  }
  let maxDepth = 0; for (let i = 0; i < nets.length; i++) maxDepth = Math.max(maxDepth, depth[i]);
  return { nets, byName, gates, order, depth, maxDepth, dffs };
}

class Circuit {
  constructor(words, init, ram) {
    this.C = Circuit.netlist || (Circuit.netlist = buildCircuit());
    this.words = words; this.init = init; this.ram0 = ram;
    this.reset();
  }
  reset() {
    const C = this.C;
    this.q = new Uint8Array(C.nets.length);
    REGN.forEach((r, k) => { for (let i = 0; i < W; i++) this.q[C.byName['R' + r + i]] = (this.init[k] >> i) & 1; });
    this.ram = Uint16Array.from(this.ram0);
    this.cycles = 0; this.lastWrite = -1;
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
        case 'AND': y = 1; for (let k = 0; k < I.length; k++) y &= v[I[k]]; break;
        case 'OR': y = 0; for (let k = 0; k < I.length; k++) y |= v[I[k]]; break;
        case 'XOR': y = v[I[0]] ^ v[I[1]]; break;
        case 'NOR': y = 0; for (let k = 0; k < I.length; k++) y |= v[I[k]]; y ^= 1; break;
        case 'ROM': { let a = 0; I.forEach((n, k) => a |= v[n] << k); const w = a < this.words.length ? this.words[a] : 0; g.outs.forEach((o, k) => v[o] = (w >> k) & 1); continue; }
        case 'RAM': { let a = 0; I.forEach((n, k) => a |= v[n] << k); const w = this.ram[a]; g.outs.forEach((o, k) => v[o] = (w >> k) & 1); continue; }
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
    this.lastWrite = -1;
    if (v[C.byName.isST]) { const a = this.bus('W', ABITS, v); this.ram[a] = this.bus('X', W, v); this.lastWrite = a; }
    this.q = nq; this.cycles++; this.prev = v; this.v = this.settle();
  }
  val(name) { return this.v[this.C.byName[name]]; }
  bus(prefix, n, src) { const s = src || this.v; let x = 0; for (let i = 0; i < n; i++) x |= s[this.C.byName[prefix + i]] << i; return x >>> 0; }
  pc() { return this.bus('PC', PCW, this.q); }
  lr() { return this.bus('LR', PCW, this.q); }
  flagC() { return this.q[this.C.byName.CF]; }
  halted() { return !!this.q[this.C.byName.HALTED]; }
  regs() { return REGN.map(r => this.bus('R' + r, W, this.q)); }
}

/* ---------------------------------------------------------------------
 *  レベル 5 : チューリングマシン
 * ------------------------------------------------------------------- */
const SIGMA = ['^', '*', ':', '&', '%', '0', '1', 'x', 'y', 'p', 'q', ']', '#', 'T', 'S', 'B', '!', '$', '_'];
const SYMI = {}; SIGMA.forEach((s, i) => SYMI[s] = i);
const PHASE = {
  fetch: { name: '命令の取り出し', cpu: 'PC が指す命令を読む' },
  decode: { name: '解読', cpu: '命令デコーダ' },
  operand: { name: 'オペランド指定', cpu: 'r / s 選択と読み出し MUX' },
  mem: { name: 'メモリ番地', cpu: 'RAM の番地 = W の下 6 ビット' },
  alu: { name: '演算・転送', cpu: 'ALU と結果の選択' },
  test: { name: '条件判定', cpu: 'ゼロ検出・分岐制御' },
  flag: { name: 'フラグ', cpu: '桁上げフラグ C' },
  clean: { name: '後片付け', cpu: '（TM 特有: 印を消す）' },
  adv: { name: 'PC ← PC+1', cpu: 'PC+1 と次 PC 選択' },
  jump: { name: 'PC ← a', cpu: '次 PC 選択 (BR=1)' },
  call: { name: '関数呼び出し', cpu: 'LR と次 PC 選択' },
  halt: { name: '停止', cpu: 'HALTED' },
};
const TM_CODE = [
  { id: 'fetch', ph: 'fetch', text: 'loop:  左へ進んで PC の印（* か %）を探す', why: 'CPU の「PC が指す命令を取り出す」。TM には番地で直接読む仕組みが無いので、実行中の命令の直前の区切りに印を置き、それを探しに行く。% は「PC と戻り番地 LR が同じ区切り」の印。' },
  { id: 'dec1', ph: 'decode', text: '  op ← 印の右の 4 ビットを読む（解読 1）', why: '4 ビットを 1 つずつ読み、読んだ値ごとに別の状態へ進む（状態の二分木）。4 段読み終えた時点で、どの状態にいるかが op そのもの。' },
  { id: 'markT', ph: 'operand', text: '  r ← 次の 3 ビット; レジスタ r の区切り # を T（ST なら S）に書き換える', why: 'r は 8 通りなので有限状態で覚えられる。レジスタ領域で # を r 個飛ばし、r+1 個目に印を付ける。以後は「印を探す」だけでよく、r を覚え続けなくて済む。' },
  { id: 'markS', ph: 'operand', text: '  （2 オペランド）s ← sss; レジスタ s の区切りを S に（T と同じなら B）', why: 'ADD/SUB/MOV は 2 本のレジスタを使う。2 本目を印 S で指す。r = s なら同じ区切りに 2 役が重なるので B（Both）。' },
  { id: 'mem', ph: 'mem', text: '  （LD/ST）レジスタ s の下 6 ビットを状態に読み、RAM のその番地の区切りに印を付ける', why: '間接アドレス: 番地はレジスタの「値」。RAM は 64 語なので値の下 6 ビット（0〜63）を状態に読み込める。] から区切りを 8 + 番地 個数えれば、その RAM 語に着く（レジスタ 8 本の後ろに RAM が並んでいる）。LD は RAM 側を S（読み元）、ST は T（書き先）にして、後は MOV と同じ手順で写す。' },
  { id: 'dec2', ph: 'decode', text: '  印に戻り op をもう一度読む（解読 2）', why: '印を付けている間は op を状態に持っていない（持つと状態数が何倍にもなる）。命令を読み直して、今度は実行する処理へ振り分ける。' },
  { id: 'inc', ph: 'alu', text: '  INC: T の右端（最下位）から 1→0 を書きつつ左へ、0 を 1 にしたら終わり', why: '2 進数の +1 は「下から続く 1 を全部 0 にし、最初の 0 を 1 にする」。桁上げが続く間は同じ状態に留まる = 状態が桁上げ 1 ビットを覚えている。' },
  { id: 'dec', ph: 'alu', text: '  DEC: T の右端から 0→1 を書きつつ左へ、1 を 0 にしたら終わり', why: '−1 は「下から続く 0 を全部 1 にし、最初の 1 を 0 にする」（借りの伝搬）。' },
  { id: 'shr', ph: 'alu', text: '  SHR: T の左端から右へ、1 つ前のビットを書きながら進む。はみ出たビットを C へ', why: '右シフト = 各ビットを 1 つ右へずらす。状態が「直前に読んだビット」を 1 つだけ覚えて運ぶ。' },
  { id: 'ldi', ph: 'alu', text: '  LDI: T を 0 にし、命令の下 9 ビットを 1 桁ずつ T の下 9 桁へ写す', why: '定数は命令の中にある。命令側の処理済みビットを x/y、境目（r の最下位）を p/q で印にして、「印の無い一番右」を 1 桁ずつ T へ運ぶ。境目 p/q に当たったら 9 桁終わり。' },
  { id: 'jz', ph: 'test', text: '  JZ/JNZ: T のレジスタに 1 があるか調べる', why: '0 かどうか = ビットを左から見て 1 に出会うか。出会った瞬間に判定が決まる（CPU の NOR16 と同じ判定）。' },
  { id: 'jc', ph: 'test', text: '  JC/JNC: ! の右の C を読む', why: 'フラグ C はテープ末尾の 1 マス。読んだ値で分岐するかが決まる。' },
  { id: 'addS', ph: 'alu', text: '  ADD/SUB/MOV: S の「未処理の最下位ビット」b を読み、x/y の印を付ける', why: '2 つの数を下の桁から 1 桁ずつ処理する筆算。処理済みは 0→x, 1→y に書き換え、次は「印の無い一番右」を探す。桁の位置をテープ自身が覚えている。' },
  { id: 'addT', ph: 'alu', text: '      b と桁上げ c を状態に持って T へ行き、未処理の最下位ビットに a+b+c（a−b−c / b）を書く', why: '状態が覚えるのは b と c の 2 ビット（4 通り）だけ。T の同じ桁に着いたら和（差）のビットを書いて印を付け、新しい c を持って S へ戻る。16 回で 16 ビット全部が終わる。' },
  { id: 'flag', ph: 'flag', text: '      全部済んだら最後の桁上げ（借り）を C に書く', why: 'S に未処理ビットが無い = 16 桁終わった。状態が持っている c がそのまま桁上げフラグ。' },
  { id: 'bpath', ph: 'alu', text: '  r = s（B）: ADD は左シフト、SUB は 0 クリア、MOV は何もしない', why: '同じレジスタ同士だと印が衝突するので別手順。x + x = 2x（左シフト）、x − x = 0。' },
  { id: 'clean', ph: 'clean', text: '  後片付け: x→0, y→1, T/S/B→#（LDI は命令側の x/y/p/q も）', why: 'TM 特有の作業。印はテープ上の作業メモなので、次の命令の前に元へ戻す。CPU には相当する部品が無い。' },
  { id: 'adv', ph: 'adv', text: '  PC ← PC+1: 印を区切りに戻し、次の区切りに PC の印を付ける → loop', why: 'PC+1 = 印を 1 命令ぶん右へ動かすこと。番地を数えなくてよい。' },
  { id: 'jread', ph: 'jump', text: '  分岐: 印に戻り、命令の分岐先（下 8 ビット）を状態に読み込む', why: '分岐先は 0〜255 なので 256 通りの状態で覚えられる（二分木で 1 ビットずつ）。' },
  { id: 'jgol', ph: 'jump', text: '      分岐先を覚えたまま左端 ^ へ（途中の PC の印は外す）', why: '絶対番地なので、先頭から数え直すために左端へ戻る。' },
  { id: 'jcnt', ph: 'jump', text: '      区切りを数えて a 番目の命令に PC の印を付ける → loop', why: '区切りを越えるごとに覚えている数を 1 減らす（CNT_v → CNT_v−1）。0 になった区切りが分岐先。' },
  { id: 'call', ph: 'call', text: '  CALL: 古い戻り番地の印 & を消し、次の区切りに & を付けてから分岐', why: '戻り番地 LR も PC と同じく「区切りの印」で表す。CALL の次の命令の区切りに & を置けば、それが LR = PC+1。' },
  { id: 'ret', ph: 'call', text: '  RET: PC の印を外し、& の区切りを PC にする（& は残す = LR は変わらない）', why: 'PC ← LR。& のある区切りに PC の印を重ねる（% になる）。' },
  { id: 'halt', ph: 'halt', text: 'HALT: 停止状態に入る', why: 'op = 0000 を読んだら停止状態へ。停止状態には遷移が無いので機械が止まる。' },
];

function buildTM() {
  const rules = [], states = [], info = {};
  const S = (q, line, desc) => { if (!info[q]) { const L = TM_CODE.find(x => x.id === line); if (!L) throw new Error('行 ' + line); info[q] = { q, line, phase: L.ph, desc, idx: states.length }; states.push(q); } return q; };
  const seen = new Set();
  const T = (q, syms, q2, w, d, note) => {
    for (const s of [].concat(syms)) {
      const key = q + '|' + s;
      if (seen.has(key)) throw new Error('δ 重複 ' + key);
      seen.add(key);
      const ww = typeof w === 'function' ? w(s) : (w == null ? s : w);
      rules.push({ id: rules.length, q, s, q2, w: ww, d, note: note || '' });
    }
  };
  const uniq = a => a.filter((v, i) => a.indexOf(v) === i);
  const BITS = ['0', '1'], MB = ['x', 'y'], AB = ['0', '1', 'x', 'y'];
  const SEP = [':', '*', '&', '%'], PCM = ['*', '%'], PLAIN = [':', '&'];
  const PROG = uniq(BITS.concat(SEP, ['x', 'y', 'p', 'q']));
  const REGA = ['0', '1', 'x', 'y', '#', 'T', 'S', 'B'];
  const ALLNB = SIGMA.filter(s => !['^', '$', '_'].includes(s));
  const notPC = ALLNB.filter(s => !PCM.includes(s));
  const unPC = s => (s === '*' ? ':' : s === '%' ? '&' : s);
  const addPC = s => (s === ':' ? '*' : s === '&' ? '%' : s);
  const mk = b => (b === '0' ? 'x' : 'y');
  const back = (q, line, desc, nxt, note) => { S(q, line, desc); T(q, notPC, q, null, 'L', '印を探して左へ'); T(q, PCM, nxt, null, 'R', note || '命令の先頭'); };

  S('F', 'fetch', '開始: PC の印を探して左へ');
  T('F', notPC, 'F', null, 'L', '印を探して左へ');
  T('F', PCM, 'D', null, 'R', '印を見つけた → 命令の先頭へ');
  S('HALT', 'halt', '停止（HALT 命令）'); S('HALT_ERR', 'halt', '異常停止');

  const tree = (pre, line, what, leaf) => {
    for (let k = 0; k < 4; k++) for (let v = 0; v < (1 << k); v++) {
      const p = k ? bin(v, k) : '', q = pre + p;
      S(q, line, what + ': ' + (k ? '「' + p + '」まで読んだ、' : '') + 'bit' + (15 - k) + ' を読む');
      for (const b of BITS) {
        if (k < 3) T(q, b, pre + p + b, null, 'R', 'op の ' + (k + 1) + ' ビット目 = ' + b);
        else { const op = parseInt(p + b, 2), r = leaf(op); T(q, b, r[0], null, r[1], 'op = ' + p + b + ' → ' + r[2]); }
      }
    }
  };
  tree('D', 'dec1', '解読 1', op => {
    switch (op) {
      case 0: return ['HALT', 'R', 'HALT: 停止'];
      case 1: case 2: case 3: case 8: case 10: case 11: return ['MR1_', 'R', ISA[op].name + '（オペランド 1 個）→ r を読む'];
      case 5: case 6: case 7: return ['MR2_', 'R', ISA[op].name + '（オペランド 2 個）→ r を読む'];
      case 12: return ['MRL_', 'R', 'LD → r を読む'];
      case 13: return ['MRW_', 'R', 'ST → r を読む'];
      case 4: return ['JB', 'L', 'JMP → 分岐先を読む'];
      case 9: return ['JCC1', 'R', 'JC/JNC → 条件ビットを読む'];
      case 14: return ['CL_GL', 'L', 'CALL → 古い戻り番地の印を消しに行く'];
      case 15: return ['RT_UN', 'L', 'RET → PC の印を外しに行く'];
    }
  });
  T('D', ']', 'HALT_ERR', null, 'R', 'PC がプログラムの外');
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
  for (const c of ['1', '2', 'L', 'W']) {
    reg3('MR' + c + '_', 'markT', 'r', r => 'GT' + c + '_' + r);
    const mark = c === 'W' ? 'S' : 'T';
    const nxt = { 1: 'BKE', 2: 'BKS', L: 'BKIL', W: 'BKIW' }[c];
    for (let k = 0; k < 8; k++) {
      const q = 'GT' + c + '_' + k;
      S(q, 'markT', 'レジスタ領域へ。区切り # をあと ' + k + ' 個飛ばして、その次を ' + mark + ' にする');
      T(q, PROG.concat([']']), q, null, 'R', '右へ（# を探す）');
      if (k === 0) T(q, '#', nxt, mark, 'L', '目的のレジスタの区切り → ' + mark + ' を書く（番号を覚える役目をテープに渡す）');
      else T(q, '#', 'GT' + c + '_' + (k - 1), null, 'R', '# を 1 つ飛ばした（あと ' + (k - 1) + ' 個）');
    }
  }
  back('BKS', 'markS', 's を読むため PC の印まで戻る', 'SK7');
  for (let k = 7; k >= 1; k--) { S('SK' + k, 'markS', 'op と r を読み飛ばす（あと ' + k + ' ビット）'); T('SK' + k, BITS, k === 1 ? 'MS_' : 'SK' + (k - 1), null, 'R', '読み飛ばす'); }
  reg3('MS_', 'markS', 's', r => 'GS_' + r);
  for (let k = 0; k < 8; k++) {
    const q = 'GS_' + k;
    S(q, 'markS', '区切りをあと ' + k + ' 個飛ばして、その次を S（T なら B）にする');
    T(q, PROG.concat([']']), q, null, 'R', '右へ');
    if (k === 0) { T(q, '#', 'BKE', 'S', 'L', '2 本目のレジスタ → S を書く'); T(q, 'T', 'BKE', 'B', 'L', 'r と s が同じレジスタ → B（Both）を書く'); }
    else T(q, ['#', 'T'], 'GS_' + (k - 1), null, 'R', '区切りを 1 つ飛ばした');
  }
  for (const c of ['L', 'W']) {
    const nm = c === 'L' ? 'LD' : 'ST';
    back('BKI' + c, 'mem', nm + ': s を読むため PC の印まで戻る', 'IK' + c + '7');
    for (let k = 7; k >= 1; k--) { S('IK' + c + k, 'mem', nm + ': op と r を読み飛ばす（あと ' + k + '）'); T('IK' + c + k, BITS, k === 1 ? 'IS' + c + '_' : 'IK' + c + (k - 1), null, 'R', '読み飛ばす'); }
    reg3('IS' + c + '_', 'mem', nm + ' の s', r => 'IG' + c + '_' + r);
    for (let k = 0; k < 8; k++) {
      const q = 'IG' + c + '_' + k;
      S(q, 'mem', nm + ': 番地を持つレジスタ s へ（区切りをあと ' + k + ' 個）');
      T(q, PROG.concat([']']), q, null, 'R', '右へ');
      if (k === 0) T(q, ['#', 'T', 'S'], 'IV' + c + '10', null, 'R', 'レジスタ s に入った → 上位 10 ビットを飛ばす');
      else T(q, ['#', 'T', 'S'], 'IG' + c + '_' + (k - 1), null, 'R', '区切りを 1 つ飛ばした');
    }
    for (let k = 10; k >= 1; k--) { S('IV' + c + k, 'mem', nm + ': s の上位ビットを飛ばす（あと ' + k + '）'); T('IV' + c + k, BITS, k === 1 ? 'RV' + c + '_0_0' : 'IV' + c + (k - 1), null, 'R', '番地は下 6 ビットだけ使う'); }
    for (let k = 0; k < 6; k++) for (let v = 0; v < (1 << k); v++) {
      const q = 'RV' + c + '_' + k + '_' + v;
      S(q, 'mem', nm + ': 番地の下 6 ビットを読む（' + k + ' ビット: ' + (k ? bin(v, k) : '—') + '）');
      for (const b of BITS) {
        const v2 = v * 2 + (+b);
        if (k === 5) T(q, b, 'GM' + c + '_' + v2, null, 'L', '番地 = ' + bin(v2, 6) + ' = ' + v2 + ' を状態に記憶');
        else T(q, b, 'RV' + c + '_' + (k + 1) + '_' + v2, null, 'R', '番地の ' + (k + 1) + ' ビット目 = ' + b);
      }
    }
    for (let v = 0; v < 64; v++) {
      const q = 'GM' + c + '_' + v;
      S(q, 'mem', nm + ': 番地 ' + v + ' を覚えたまま ] へ戻る');
      T(q, REGA, q, null, 'L', '] へ');
      T(q, ']', 'CM' + c + '_' + (8 + v), null, 'R', '] → 区切りを 8 + ' + v + ' 個数える');
    }
    for (let k = 0; k < 72; k++) {
      const q = 'CM' + c + '_' + k;
      S(q, 'mem', nm + ': 区切りをあと ' + k + ' 個' + (k > 8 ? '（RAM ' + (k - 8) + ' 番地の手前）' : ''));
      T(q, BITS, q, null, 'R', '右へ');
      if (k === 0) T(q, '#', 'BKE', c === 'L' ? 'S' : 'T', 'L', 'RAM のこの番地 → ' + (c === 'L' ? 'S（読み元）' : 'T（書き先）') + ' を書く');
      else T(q, ['#', 'T', 'S'], 'CM' + c + '_' + (k - 1), null, 'R', '区切りを 1 つ数えた');
    }
  }
  back('BKE', 'dec2', '解読 2 のため PC の印まで戻る', 'E', '命令の先頭 → op を読み直す');
  tree('E', 'dec2', '解読 2', op => {
    const m = { 1: ['IN_FT', 'INC 実行へ'], 2: ['DE_FT', 'DEC 実行へ'], 3: ['JZ_FT', 'JZ 判定へ'], 10: ['JN_FT', 'JNZ 判定へ'], 8: ['SH_FT', 'SHR 実行へ'], 11: ['LI_FT', 'LDI 実行へ'],
      5: ['AD_ST', 'ADD 実行へ'], 6: ['SU_ST', 'SUB 実行へ'], 7: ['MV_ST', 'MOV 実行へ'], 12: ['MV_ST', 'LD = RAM から MOV'], 13: ['MV_ST', 'ST = RAM へ MOV'] }[op];
    return m ? [m[0], 'R', m[1]] : ['HALT_ERR', 'R', '（ここには来ない）'];
  });
  const findT = (q, line, desc, nxt) => { S(q, line, desc); T(q, PROG.concat([']', '#', 'S', '!']), q, null, 'R', 'T を探して右へ'); T(q, 'T', nxt, null, 'R', 'T を見つけた → レジスタの中へ'); };
  findT('IN_FT', 'inc', 'INC: T を探す', 'IN_END');
  S('IN_END', 'inc', 'INC: レジスタの右端（最下位ビット）へ');
  T('IN_END', BITS, 'IN_END', null, 'R', '右端を探す'); T('IN_END', ['#', '!'], 'IN_C', null, 'L', '右端の次 → 最下位ビットへ戻る');
  S('IN_C', 'inc', 'INC: 桁上げ 1 を持って左へ');
  T('IN_C', '1', 'IN_C', '0', 'L', '1 + 1 = 10 → 0 を書いて桁上げ続行');
  T('IN_C', '0', 'UNM', '1', 'L', '0 + 1 = 1 → 桁上げ終わり');
  T('IN_C', 'T', 'ADV_L', '#', 'L', '最上位を越えた（65536 で一周）→ T を # に戻す');
  findT('DE_FT', 'dec', 'DEC: T を探す', 'DE_END');
  S('DE_END', 'dec', 'DEC: レジスタの右端へ');
  T('DE_END', BITS, 'DE_END', null, 'R', '右端を探す'); T('DE_END', ['#', '!'], 'DE_B', null, 'L', '最下位ビットへ戻る');
  S('DE_B', 'dec', 'DEC: 借り 1 を持って左へ');
  T('DE_B', '0', 'DE_B', '1', 'L', '0 − 1 → 1 を書いて借り続行');
  T('DE_B', '1', 'UNM', '0', 'L', '1 − 1 = 0 → 借り終わり');
  T('DE_B', 'T', 'ADV_L', '#', 'L', '最上位を越えた（0 − 1 = 65535）→ T を # に戻す');
  S('UNM', 'clean', '印 T まで左へ戻って # に戻す（その後 PC+1）');
  T('UNM', BITS.concat(['#', '!']), 'UNM', null, 'L', 'T を探して左へ');
  T('UNM', 'T', 'ADV_L', '#', 'L', 'T → # に戻した');
  S('UNMJ', 'clean', '印 T を # に戻す（その後 分岐）');
  T('UNMJ', BITS.concat(['#', '!']), 'UNMJ', null, 'L', 'T を探して左へ');
  T('UNMJ', 'T', 'JB', '#', 'L', 'T → # に戻した → 分岐先を読みに行く');
  findT('SH_FT', 'shr', 'SHR: T を探す', 'SH_H0');
  for (const h of BITS) {
    S('SH_H' + h, 'shr', 'SHR: 直前のビット ' + h + ' を持って右へ');
    for (const x of BITS) T('SH_H' + h, x, 'SH_H' + x, h, 'R', 'ここに ' + h + ' を書き、元の ' + x + ' を次へ運ぶ');
    T('SH_H' + h, '#', 'SH_F' + h, null, 'R', '右端を越えた: はみ出たビット = ' + h + ' → C へ');
    T('SH_H' + h, '!', 'SH_W' + h, null, 'R', '右端を越えた: はみ出たビット = ' + h + ' → C へ');
    S('SH_F' + h, 'flag', 'C（! の右）へ行く（はみ出たビット ' + h + '）');
    T('SH_F' + h, BITS.concat(['#']), 'SH_F' + h, null, 'R', '! を探して右へ');
    T('SH_F' + h, '!', 'SH_W' + h, null, 'R', 'C のマスへ');
    S('SH_W' + h, 'flag', 'C に ' + h + ' を書く');
    T('SH_W' + h, BITS, 'UNM', h, 'L', 'C ← ' + h);
  }
  findT('JZ_FT', 'jz', 'JZ: T を探す', 'JZ_SC');
  S('JZ_SC', 'jz', 'JZ: 1 があるか調べる');
  T('JZ_SC', '0', 'JZ_SC', null, 'R', 'まだ全部 0');
  T('JZ_SC', '1', 'UNM', null, 'L', '1 があった → 0 でない → 分岐しない');
  T('JZ_SC', ['#', '!'], 'UNMJ', null, 'L', '最後まで 0 → 分岐する');
  findT('JN_FT', 'jz', 'JNZ: T を探す', 'JN_SC');
  S('JN_SC', 'jz', 'JNZ: 1 があるか調べる');
  T('JN_SC', '0', 'JN_SC', null, 'R', 'まだ全部 0');
  T('JN_SC', '1', 'UNMJ', null, 'L', '1 があった → 分岐する');
  T('JN_SC', ['#', '!'], 'UNM', null, 'L', '最後まで 0 → 分岐しない');
  S('JCC1', 'jc', 'JC/JNC: r 欄の 1 ビット目を飛ばす'); S('JCC2', 'jc', 'JC/JNC: r 欄の 2 ビット目を飛ばす'); S('JCC3', 'jc', 'JC/JNC: 条件ビット c を読む');
  T('JCC1', BITS, 'JCC2', null, 'R', '飛ばす'); T('JCC2', BITS, 'JCC3', null, 'R', '飛ばす');
  T('JCC3', '0', 'JC_F', null, 'R', 'c = 0 → JC'); T('JCC3', '1', 'JNC_F', null, 'R', 'c = 1 → JNC');
  for (const [p, on1] of [['JC', true], ['JNC', false]]) {
    S(p + '_F', 'jc', p + ': ! を探して右へ');
    T(p + '_F', ALLNB.filter(s => s !== '!'), p + '_F', null, 'R', '! を探して右へ');
    T(p + '_F', '!', p + '_R', null, 'R', 'C のマスへ');
    S(p + '_R', 'jc', p + ': C を読む');
    T(p + '_R', '1', on1 ? 'JB' : 'ADV_L', null, 'L', 'C = 1 → ' + (on1 ? '分岐する' : '分岐しない'));
    T(p + '_R', '0', on1 ? 'ADV_L' : 'JB', null, 'L', 'C = 0 → ' + (on1 ? '分岐しない' : '分岐する'));
  }
  // LDI
  findT('LI_FT', 'ldi', 'LDI: T を探す', 'LI_CLR');
  S('LI_CLR', 'ldi', 'LDI: T のレジスタを 0 にする');
  T('LI_CLR', BITS, 'LI_CLR', '0', 'R', '0 を書く');
  T('LI_CLR', ['#', '!'], 'LI_BK', null, 'L', '0 にした → 命令へ戻る');
  back('LI_BK', 'ldi', 'LDI: PC の印へ戻る（1 回目）', 'LI_K6');
  for (let k = 6; k >= 1; k--) { S('LI_K' + k, 'ldi', 'LDI: op と r の上 2 ビットを飛ばす（あと ' + k + '）'); T('LI_K' + k, BITS, k === 1 ? 'LI_M' : 'LI_K' + (k - 1), null, 'R', '飛ばす'); }
  S('LI_M', 'ldi', 'LDI: r の最下位を境目の印 p/q にする');
  T('LI_M', '0', 'LI_E', 'p', 'R', '境目に印 p（元は 0）'); T('LI_M', '1', 'LI_E', 'q', 'R', '境目に印 q（元は 1）');
  S('LI_E', 'ldi', 'LDI: 命令の右端へ');
  T('LI_E', AB.concat(['p', 'q']), 'LI_E', null, 'R', '右端を探す');
  T('LI_E', SEP.concat([']']), 'LI_SR', null, 'L', '右端 → 左へ見ていく');
  S('LI_SR', 'ldi', 'LDI: 命令の未処理の一番右のビットを探す');
  T('LI_SR', MB, 'LI_SR', null, 'L', '処理済みなので飛ばす');
  for (const b of BITS) T('LI_SR', b, 'LI_T' + b, mk(b), 'R', '定数の次の桁は ' + b + ' → 印を付け T へ運ぶ');
  T('LI_SR', 'p', 'LI_CL', '0', 'R', '境目に着いた = 9 桁写し終えた → 境目を元の 0 に戻して後片付け');
  T('LI_SR', 'q', 'LI_CL', '1', 'R', '境目に着いた = 9 桁写し終えた → 境目を元の 1 に戻して後片付け');
  for (const b of BITS) {
    S('LI_T' + b, 'ldi', 'LDI: ビット ' + b + ' を持って T へ');
    T('LI_T' + b, PROG.concat([']', '#', 'S', '!']), 'LI_T' + b, null, 'R', 'T を探して右へ');
    T('LI_T' + b, 'T', 'LI_TE' + b, null, 'R', 'T → レジスタの中へ');
    S('LI_TE' + b, 'ldi', 'LDI: T の右端へ（ビット ' + b + '）');
    T('LI_TE' + b, AB, 'LI_TE' + b, null, 'R', '右端を探す');
    T('LI_TE' + b, ['#', '!'], 'LI_TR' + b, null, 'L', '右端 → 左へ');
    S('LI_TR' + b, 'ldi', 'LDI: T の未処理の一番右に ' + b + ' を書く');
    T('LI_TR' + b, MB, 'LI_TR' + b, null, 'L', '処理済みなので飛ばす');
    T('LI_TR' + b, BITS, 'LI_BK2', mk(b), 'L', b + ' を書いて印を付けた → 命令へ戻る');
  }
  back('LI_BK2', 'ldi', 'LDI: PC の印へ戻る', 'LI_E', '命令の先頭 → 右端へ');
  S('LI_CL', 'clean', 'LDI: 命令の印を消しながら右端へ');
  T('LI_CL', 'x', 'LI_CL', '0', 'R', 'x → 0'); T('LI_CL', 'y', 'LI_CL', '1', 'R', 'y → 1');
  T('LI_CL', BITS, 'LI_CL', null, 'R', 'そのまま');
  T('LI_CL', SEP, 'LI_GR', null, 'R', '命令の終わり → レジスタ領域へ');
  T('LI_CL', ']', 'CLN_R', null, 'R', 'レジスタ領域 → 印を消しながら右へ');
  S('LI_GR', 'clean', 'LDI: ] へ向かう');
  T('LI_GR', BITS.concat(SEP), 'LI_GR', null, 'R', '] へ');
  T('LI_GR', ']', 'CLN_R', null, 'R', 'レジスタ領域 → 印を消しながら右へ');
  // ADD / SUB / MOV（LD・ST もここ）
  for (const P of ['AD', 'SU', 'MV']) {
    const nm = { AD: 'ADD', SU: 'SUB', MV: 'MOV/LD/ST' }[P];
    const C = P === 'MV' ? [''] : ['0', '1'];
    const cw = c => (P === 'MV' ? '' : '（' + (P === 'AD' ? '桁上げ' : '借り') + ' ' + c + '）');
    S(P + '_ST', 'addS', nm + ': 最初の印（T / S / B）を探す');
    T(P + '_ST', PROG.concat([']', '#']), P + '_ST', null, 'R', '印を探して右へ');
    T(P + '_ST', ['T', 'S'], P + '_GL' + C[0], null, 'L', 'T と S は別の語 → 筆算を始める');
    T(P + '_ST', 'B', P === 'AD' ? 'AB_END' : P === 'SU' ? 'SB_Z' : 'CLN_L', null, P === 'MV' ? 'L' : 'R', 'r = s（B）→ ' + (P === 'AD' ? '左シフト' : P === 'SU' ? '0 にする' : '何もしない'));
    for (const c of C) {
      S(P + '_GL' + c, 'addS', nm + ': レジスタ領域の左端 ] へ' + cw(c));
      T(P + '_GL' + c, REGA, P + '_GL' + c, null, 'L', '] へ');
      T(P + '_GL' + c, ']', P + '_FS' + c, null, 'R', '左端 → S を探す');
      S(P + '_FS' + c, 'addS', nm + ': S を探す' + cw(c));
      T(P + '_FS' + c, AB.concat(['#', 'T']), P + '_FS' + c, null, 'R', 'S を探して右へ');
      T(P + '_FS' + c, 'S', P + '_FE' + c, null, 'R', 'S → 語の中へ');
      S(P + '_FE' + c, 'addS', nm + ': S の語の右端へ' + cw(c));
      T(P + '_FE' + c, AB, P + '_FE' + c, null, 'R', '右端を探す');
      T(P + '_FE' + c, ['#', 'T', '!'], P + '_SR' + c, null, 'L', '右端 → 左へ見ていく');
      S(P + '_SR' + c, 'addS', nm + ': S の未処理（印の無い）一番右のビットを探す' + cw(c));
      T(P + '_SR' + c, MB, P + '_SR' + c, null, 'L', '処理済み（x/y）なので飛ばす');
      for (const b of BITS) T(P + '_SR' + c, b, P + '_G2' + b + c, mk(b), 'L', 'S の次の桁は ' + b + ' → 印 ' + mk(b) + ' を付け、b = ' + b + ' を持って T へ');
      if (P === 'MV') T(P + '_SR' + c, 'S', 'CLN_L', null, 'L', '16 桁すべて済んだ → 後片付け');
      else T(P + '_SR' + c, 'S', 'FL' + c, null, 'R', '16 桁すべて済んだ → 最後の' + (P === 'AD' ? '桁上げ' : '借り') + ' ' + c + ' を C へ');
      for (const b of BITS) {
        const k = b + c, bc = '（b=' + b + (P === 'MV' ? '' : ', c=' + c) + '）';
        S(P + '_G2' + k, 'addT', nm + ': ] へ戻る' + bc);
        T(P + '_G2' + k, REGA, P + '_G2' + k, null, 'L', '] へ');
        T(P + '_G2' + k, ']', P + '_FT' + k, null, 'R', '左端 → T を探す');
        S(P + '_FT' + k, 'addT', nm + ': T を探す' + bc);
        T(P + '_FT' + k, AB.concat(['#', 'S']), P + '_FT' + k, null, 'R', 'T を探して右へ');
        T(P + '_FT' + k, 'T', P + '_TE' + k, null, 'R', 'T → 語の中へ');
        S(P + '_TE' + k, 'addT', nm + ': T の語の右端へ' + bc);
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
  S('CLN_L', 'clean', '後片付け: レジスタ領域の左端 ] へ');
  T('CLN_L', REGA.concat(['!']), 'CLN_L', null, 'L', '] へ');
  T('CLN_L', ']', 'CLN_R', null, 'R', '左端 → 印を消しながら右へ');
  S('CLN_R', 'clean', '後片付け: x→0, y→1, T/S/B→# にしながら右へ');
  T('CLN_R', 'x', 'CLN_R', '0', 'R', '印を消す x → 0'); T('CLN_R', 'y', 'CLN_R', '1', 'R', '印を消す y → 1');
  T('CLN_R', ['T', 'S', 'B'], 'CLN_R', '#', 'R', '区切りの印を # に戻す');
  T('CLN_R', BITS.concat(['#']), 'CLN_R', null, 'R', 'そのまま');
  T('CLN_R', '!', 'ADV_L', null, 'L', 'レジスタ領域の終わり → PC+1 へ');
  S('ADV_L', 'adv', 'PC+1: PC の印まで左へ戻る');
  T('ADV_L', notPC, 'ADV_L', null, 'L', '印を探して左へ');
  T('ADV_L', PCM, 'ADV_R', unPC, 'R', 'PC の印を外す');
  S('ADV_R', 'adv', 'PC+1: 次の区切りに印を付ける');
  T('ADV_R', BITS, 'ADV_R', null, 'R', '今の命令を越える');
  T('ADV_R', PLAIN, 'D', addPC, 'R', '次の命令に PC の印 → 解読へ');
  T('ADV_R', ']', 'HALT_ERR', null, 'R', 'プログラムの外へ出た');
  back('JB', 'jread', '分岐: PC の印まで戻る', 'JS8', '命令の先頭へ');
  for (let k = 8; k >= 1; k--) { S('JS' + k, 'jread', '分岐: op・r・a の最上位を読み飛ばす（あと ' + k + '）'); T('JS' + k, BITS, k === 1 ? 'RD_0_0' : 'JS' + (k - 1), null, 'R', '読み飛ばす'); }
  for (let k = 0; k < 8; k++) for (let v = 0; v < (1 << k); v++) {
    const q = 'RD_' + k + '_' + v;
    S(q, 'jread', '分岐先を読む: ' + k + ' ビット読んだ（' + (k ? bin(v, k) : '—') + '）');
    for (const b of BITS) {
      const v2 = v * 2 + (+b);
      if (k === 7) T(q, b, 'GOL_' + v2, null, 'L', '分岐先 = ' + bin(v2, 8) + ' = ' + v2 + ' を状態に記憶');
      else T(q, b, 'RD_' + (k + 1) + '_' + v2, null, 'R', '分岐先の ' + (k + 1) + ' ビット目 = ' + b);
    }
  }
  for (let v = 0; v < 256; v++) {
    const g = 'GOL_' + v, c = 'CNT_' + v;
    S(g, 'jgol', '分岐先 ' + v + ' を覚えたまま左端 ^ へ（途中の PC の印は外す）');
    T(g, BITS.concat(PLAIN), g, null, 'L', '左端へ');
    T(g, PCM, g, unPC, 'L', '古い PC の印を外す');
    T(g, '^', c, null, 'R', '左端 → 命令を数え始める');
    S(c, 'jcnt', 'あと ' + v + ' 命令ぶん区切りを数える');
    T(c, BITS, c, null, 'R', '命令を越える');
    if (v === 0) T(c, PLAIN, 'D', addPC, 'R', 'ここが分岐先 → PC の印を付け解読へ');
    else T(c, PLAIN, 'CNT_' + (v - 1), null, 'R', '区切りを 1 つ数えた（あと ' + (v - 1) + '）');
    T(c, ']', 'HALT_ERR', null, 'R', '分岐先がプログラムの外');
  }
  S('CL_GL', 'call', 'CALL: 左端 ^ へ（古い & を消すため）');
  T('CL_GL', PROG, 'CL_GL', null, 'L', '左端へ');
  T('CL_GL', '^', 'CL_SW', null, 'R', '左端 → 右へ & を探して消す');
  S('CL_SW', 'call', 'CALL: 古い戻り番地の印を消しながら ] まで');
  T('CL_SW', '&', 'CL_SW', ':', 'R', '古い戻り番地 & → : に戻す');
  T('CL_SW', '%', 'CL_SW', '*', 'R', 'PC と LR が重なっていた % → * に戻す');
  T('CL_SW', BITS.concat([':', '*']), 'CL_SW', null, 'R', 'そのまま');
  T('CL_SW', ']', 'CL_BK', null, 'L', '] → PC の印へ戻る');
  S('CL_BK', 'call', 'CALL: PC の印 * へ戻る');
  T('CL_BK', BITS.concat([':']), 'CL_BK', null, 'L', '* を探して左へ');
  T('CL_BK', '*', 'CL_NX', null, 'R', 'CALL 命令の先頭');
  S('CL_NX', 'call', 'CALL: 次の命令の区切りへ（そこが戻り番地）');
  T('CL_NX', BITS, 'CL_NX', null, 'R', 'CALL 命令を越える');
  T('CL_NX', ':', 'JB', '&', 'L', '戻り番地 = PC+1 の区切りに & を付けた → 分岐先へ');
  T('CL_NX', ']', 'HALT_ERR', null, 'R', 'CALL の次に命令が無い');
  S('RT_UN', 'ret', 'RET: PC の印を外す');
  T('RT_UN', BITS.concat(PLAIN), 'RT_UN', null, 'L', '印を探して左へ');
  T('RT_UN', PCM, 'RT_GL', unPC, 'L', 'PC の印を外した');
  S('RT_GL', 'ret', 'RET: 左端 ^ へ');
  T('RT_GL', BITS.concat(PLAIN), 'RT_GL', null, 'L', '左端へ');
  T('RT_GL', '^', 'RT_FL', null, 'R', '左端 → & を探す');
  S('RT_FL', 'ret', 'RET: 戻り番地の印 & を探す');
  T('RT_FL', BITS.concat([':']), 'RT_FL', null, 'R', '& を探して右へ');
  T('RT_FL', '&', 'D', '%', 'R', '& の区切りを PC にした（% = PC と LR）→ 解読へ');
  T('RT_FL', ']', 'HALT_ERR', null, 'R', '戻り番地が無い');

  const NS = SIGMA.length, qi = {};
  states.forEach((q, i) => qi[q] = i);
  const table = new Int32Array(states.length * NS).fill(-1);
  const rq2 = new Int32Array(rules.length), rw = new Uint8Array(rules.length), rd = new Int8Array(rules.length);
  for (const r of rules) {
    if (qi[r.q2] === undefined) throw new Error('未定義の状態 ' + r.q2 + '（' + r.q + '）');
    table[qi[r.q] * NS + SYMI[r.s]] = r.id;
    rq2[r.id] = qi[r.q2]; rw[r.id] = SYMI[r.w]; rd[r.id] = r.d === 'R' ? 1 : -1;
  }
  for (const r of rules) def('TM-' + r.id, 'tm', 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')', r.note + '\n状態 ' + r.q + ': ' + info[r.q].desc, { rule: r });
  return { rules, states, info, qi, table, rq2, rw, rd, NS, D: qi.D, F: qi.F, HALT: qi.HALT, HERR: qi.HALT_ERR };
}

def('TM-DEF', 'tm', 'チューリングマシン M = (Q, Σ, δ, q0, F)',
  'Q: 状態の集合 / Σ = {^ * : & % 0 1 x y p q ] # T S B ! $ _} / δ: Q×Σ → Q×Σ×{L,R} / q0 = F / 停止状態 = {HALT, HALT_ERR}。\n各ステップでヘッド下の記号 s と状態 q から δ(q, s) = (q′, s′, D) を引き、s′ を書いて D に動き q′ に移る。δ に無い組は停止。');
def('TM-TAPE', 'tm', 'テープの書式',
  '^ [区切り 命令0] [区切り 命令1] … ] #a #b … #h #RAM0 … #RAM63 ! C $\n命令は機械語と同じ 16bit。区切りは : / * (PC) / & (LR) / % (PC と LR)。レジスタと RAM の各語は 16bit（左が最上位）。C は桁上げフラグ 1 マス。\n作業中だけ現れる記号: T / S / B（操作する語の印）、x / y（処理済みの 0 / 1）、p / q（LDI の境目）。');
def('TMD-1', 'tmd', '有限状態で覚えるもの', '状態は有限個なので「上限が決まっている小さな値」だけを覚える:\n・op（16 通り）… 解読の二分木の葉\n・レジスタ番号 r, s（8 通り）\n・分岐先（256 通り）、RAM の番地（64 通り）\n・桁上げ / 借り / 運んでいるビット（2 通り）\nレジスタや RAM の値（65536 通り）は状態に入れずテープに置く。');
def('TMD-2', 'tmd', 'テープ上の印 = ポインタ', 'CPU は配線でレジスタを選ぶが、TM には配線が無い。区切り # を T / S / B に書き換え「この語を使う」という目印をテープに置く。以後は印を探すだけでよいので、番号を状態に持ち続けなくて済む。RAM の語もレジスタと同じ形で並んでいるので、LD/ST は「印の付け方」が違うだけで MOV と同じ手順になる。');
def('TMD-3', 'tmd', '処理済みの印 = 桁の位置', '筆算でいまどの桁かを覚えるのに、処理したビットを 0→x, 1→y と書き換える。「印の無い一番右」が次の桁。位置をテープ自身が覚えるので、状態は桁上げ 1 ビットだけ持てばよい。LDI では命令側にも印を付け、境目を p/q で示す。');
def('TMD-4', 'tmd', '2 回の解読', '1 回目の解読で「オペランドの種類」だけ見て印を付け、PC の印に戻って op を読み直してから実行へ振り分ける。CPU の「解読 → オペランド読み出し → 実行」に対応する。');
def('TMD-5', 'tmd', '番地 = 数えること', 'PC・LR・分岐先・RAM の番地は、CPU では 2 進数のレジスタだが、TM では「何番目の区切りか」で表す。分岐は番地を状態に読み込んで区切りを数え、間接アドレスはレジスタの値（下 6 ビット）を状態に読み込んで区切りを数える。');
def('TMD-6', 'tmd', '戻り番地の印', 'CALL は次の命令の区切りに & を付けるだけで LR = PC+1 を表せる。RET はその区切りに PC の印を重ねる（%）。戻り番地は 1 つなので、関数の中から関数は呼べない（CPU 側の LR も 1 本）。');
def('TMD-7', 'tmd', '時間の代償（と TM の省略）', '回路は 1 クロックで 16 ビットを並列に処理するが、TM はヘッドが 1 マスずつ往復する。ADD は 16 桁 × (S ↔ T の往復)、命令の取り出しや RAM の番地探しはテープ長に比例する。計算できるものは同じ（チューリング完全）で、速さだけが違う。重いプログラムでは TM 層を省略し、残りの 4 層で突き合わせる。');

class TM {
  constructor(words, init, ram) {
    this.M = TM.machine || (TM.machine = buildTM());
    this.words = words; this.init = init; this.ram0 = ram;
    this.reset();
  }
  static makeTape(words, init, ram) {
    const t = ['^'];
    words.forEach((w, i) => { t.push(i === 0 ? '%' : ':'); for (const b of bin(w, IW)) t.push(b); });
    t.push(']');
    init.concat(ram).forEach(v => { t.push('#'); for (const b of bin(v, W)) t.push(b); });
    t.push('!', '0', '$', '_', '_', '_');
    return Uint8Array.from(t.map(s => SYMI[s]));
  }
  reset() {
    this.tape = TM.makeTape(this.words, this.init, this.ram0);
    this.head = 1; this.qi = this.M.F; this.steps = 0; this.lastId = -1; this.halted = false; this.err = null;
    this.hist = []; this.ruleCount = new Uint32Array(this.M.rules.length);
    this.progEnd = this.tape.indexOf(SYMI[']']);
    this.wordStart = []; for (let k = 0; k < NREG + RAMN; k++) this.wordStart.push(this.progEnd + 2 + k * (W + 1));
    this.regStart = this.wordStart.slice(0, NREG);
    this.ramStart = this.wordStart.slice(NREG);
    this.flagPos = this.progEnd + 1 + (NREG + RAMN) * (W + 1) + 1;
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
    this.tape[this.head] = M.rw[id]; this.head += M.rd[id]; this.qi = M.rq2[id];
    this.steps++; this.lastId = id; this.ruleCount[id]++;
    this.hist.push(id, this.steps); if (this.hist.length > 128) this.hist.splice(0, 2);
    if (this.qi === M.HALT || this.qi === M.HERR) { this.halted = true; if (this.qi === M.HERR) this.err = M.rules[id].note; }
    return (this.qi === M.D && prev !== M.F) || this.halted;
  }
  run(n) {
    const M = this.M, tb = M.table, NS = M.NS, rq2 = M.rq2, rw = M.rw, rd = M.rd, tape = this.tape, cnt = this.ruleCount;
    let q = this.qi, h = this.head, last = this.lastId, k = 0;
    const tail = Math.max(0, n - 64);
    for (; k < n; k++) {
      const id = tb[q * NS + tape[h]];
      if (id < 0) { this.err = 'δ(' + M.states[q] + ', ' + SIGMA[tape[h]] + ') が未定義'; q = M.HERR; this.halted = true; break; }
      tape[h] = rw[id]; h += rd[id]; const p = q; q = rq2[id]; cnt[id]++; last = id;
      if (k >= tail) this.hist.push(id, this.steps + k + 1);
      if (q === M.HALT || q === M.HERR) { k++; this.halted = true; if (q === M.HERR) this.err = M.rules[id].note; break; }
      if (q === M.D && p !== M.F) { k++; break; }
    }
    if (this.hist.length > 128) this.hist.splice(0, this.hist.length - 128);
    this.qi = q; this.head = h; this.lastId = last; this.steps += k;
    return k;
  }
  word(k) { const s = this.wordStart[k]; let v = 0; for (let i = 0; i < W; i++) { const c = this.tape[s + i]; v = v * 2 + (c === SYMI['1'] || c === SYMI.y ? 1 : 0); } return v; }
  regs() { const o = []; for (let k = 0; k < NREG; k++) o.push(this.word(k)); return o; }
  ram() { const o = []; for (let k = 0; k < RAMN; k++) o.push(this.word(NREG + k)); return o; }
  flagC() { return this.tape[this.flagPos] === SYMI['1'] ? 1 : 0; }
  sepIndex(set) {
    let n = -1;
    for (let i = 1; i < this.progEnd; i++) { const c = SIGMA[this.tape[i]]; if (c === ':' || c === '*' || c === '&' || c === '%') { n++; if (set.includes(c)) return n; } }
    return -1;
  }
  pc() { return this.sepIndex(['*', '%']); }
  lr() { return this.sepIndex(['&', '%']); }
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
      if (n > 2e7) break;
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
      res.c = { src: source, ast: comp.ast, meta: comp.meta, temps: comp.ast.temps };
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
  if (res.c) as.instrs.forEach(it => { it.meta = it.line >= 0 ? res.c.meta[it.line] : null; });
  res.words = as.words; res.init = as.init; res.ram = as.ram; res.ok = true;
  return res;
}

class Sim {
  constructor(prog, opts) { this.prog = prog; this.useTM = !(opts && opts.useTM === false); this.listeners = []; this.reset(); }
  setTM(on) { this.useTM = !!on; this.reset(); }
  reset() {
    const P = this.prog;
    this.cI = P.c ? new CInterp(P.c.ast) : null;
    this.aI = new AsmInterp(P.asm);
    this.mI = new McInterp(P.words, P.init, P.ram);
    this.ck = new Circuit(P.words, P.init, P.ram);
    this.tm = new TM(P.words, P.init, P.ram);
    this.instr = 0; this.p = 0;
    this.segN = this.useTM ? this.tm.lookahead() : 0; this.segDone = 0;
    this.halted = false; this.cSync = true; this.cSteps = 0;
    this.check = this.verify();
    this.lastCommit = null;
    this.listeners.forEach(f => f('reset', this));
  }
  on(f) { this.listeners.push(f); }
  advance(dp) {
    if (this.halted) return 0;
    let commits = 0, guard = 0;
    this.p += dp;
    while (!this.halted && guard++ < 100000) {
      if (this.useTM) {
        const target = Math.min(this.segN, Math.floor(this.p * this.segN));
        if (this.segDone < target && !this.tm.halted) this.segDone += this.tm.run(target - this.segDone);
      }
      if (this.p >= 1) { this.p -= 1; this.commit(); commits++; } else break;
    }
    return commits;
  }
  microStep() {
    if (this.halted) return;
    if (!this.useTM) return this.stepInstr();
    if (this.segDone < this.segN) { this.tm.step(); this.segDone++; }
    this.p = this.segDone / this.segN;
    if (this.segDone >= this.segN) { this.p = 0; this.commit(); }
  }
  stepInstr() { if (!this.halted) { this.p = 1; this.advance(0); this.p = 0; } }
  runToEnd(maxInstr) { let n = 0; while (!this.halted && n++ < (maxInstr || 1e6)) { this.p = 1; this.advance(0); } this.p = 0; return n; }
  commit() {
    if (this.useTM && this.segDone < this.segN && !this.tm.halted) this.segDone += this.tm.run(this.segN - this.segDone);
    const before = { pc: this.mI.pc, word: this.mI.fetch(), asm: this.aI.cur(), c: this.cI ? this.cI.cur : null, entry: this.cSync };
    this.ck.clock();
    this.mI.step();
    this.aI.step();
    this.halted = this.mI.halted;
    // C の動作は「同じ命令列のまとまり（グループ）」を抜けたときに 1 つ進む
    const m = before.asm && before.asm.meta, cur = this.aI.cur(), m2 = cur && cur.meta;
    const done = !this.cI || !m || this.halted || !m2 || m2.g !== m.g || m2.idx === 0;
    this.cSync = done;
    if (this.cI && m && done) { this.cI.step(); this.cSteps++; }
    this.instr++;
    this.lastCommit = before;
    this.check = this.verify(before);
    this.segN = this.useTM ? this.tm.lookahead() : 0; this.segDone = 0;
    if (this.halted) this.p = 0;
    if (this.cI && m && done) this.listeners.forEach(f => f('c', this));
    this.listeners.forEach(f => f('instr', this));
  }
  verify(before) {
    const T = this.useTM;
    const R = { asm: this.aI.R, mc: this.mI.R, circ: this.ck.regs() };
    const M = { asm: this.aI.ram, mc: this.mI.ram, circ: Array.from(this.ck.ram) };
    const Cf = { asm: this.aI.C, mc: this.mI.C, circ: this.ck.flagC() };
    const LR = { asm: this.aI.LR, mc: this.mI.LR, circ: this.ck.lr() };
    const PCs = { asm: this.aI.pc, mc: this.mI.pc, circ: this.ck.pc() };
    const H = { asm: this.aI.halted, mc: this.mI.halted, circ: this.ck.halted() };
    if (T) { R.tm = this.tm.regs(); M.tm = this.tm.ram(); Cf.tm = this.tm.flagC(); LR.tm = this.tm.lr(); PCs.tm = this.tm.halted ? this.mI.pc : this.tm.pc(); H.tm = this.tm.halted; }
    if (this.cI && this.cSync) { R.c = this.cI.regs(); H.c = this.cI.halted; }
    const ref = R.mc, bad = [];
    for (const k in R) for (let i = 0; i < NREG; i++) {
      if (k === 'c' && !this.prog.c.ast.vars.some(v => v.reg === i)) continue;
      if (R[k][i] !== ref[i]) bad.push(k + ' のレジスタ ' + REGN[i] + ' = ' + R[k][i] + '（機械語では ' + ref[i] + '）');
    }
    for (const k in M) for (let i = 0; i < RAMN; i++) if (M[k][i] !== M.mc[i]) { bad.push(k + ' の RAM[' + i + '] = ' + M[k][i] + '（機械語では ' + M.mc[i] + '）'); break; }
    if (this.cI && this.cSync) for (const a of this.prog.c.ast.arrays) for (let i = 0; i < a.len; i++) if (this.cI.arr[a.name][i] !== M.mc[a.base + i]) { bad.push('C の ' + a.name + '[' + i + '] = ' + this.cI.arr[a.name][i] + '（RAM では ' + M.mc[a.base + i] + '）'); break; }
    for (const k in Cf) if (Cf[k] !== Cf.mc) bad.push(k + ' のフラグ C = ' + Cf[k] + '（機械語では ' + Cf.mc + '）');
    for (const k in LR) if (LR[k] !== LR.mc) bad.push(k + ' の LR = ' + LR[k] + '（機械語では ' + LR.mc + '）');
    for (const k in PCs) if (PCs[k] !== PCs.mc) bad.push(k + ' の PC = ' + PCs[k] + '（機械語では ' + PCs.mc + '）');
    for (const k in H) if (H[k] !== H.mc) bad.push(k + ' の停止状態が違う');
    if (this.cI && before && before.entry && before.asm && before.asm.meta && before.c) {
      const m = before.asm.meta;
      if (m.node !== before.c.node || m.role !== before.c.role) bad.push('C の動作（' + before.c.role + '）と命令の出どころ（' + m.role + '）が違う');
    }
    if (T && this.tm.err && !this.mI.err) bad.push('TM: ' + this.tm.err);
    const layers = (this.cI ? 1 : 0) + 3 + (T ? 1 : 0);
    return { ok: bad.length === 0, bad, R, PCs, H, Cf, LR, cSync: this.cSync, layers };
  }
}

const api = { W, MASK, PCW, MEM, IW, NREG, RAMN, REGN, OPC, MN, ISA, DEFS, BLOCKS, PHASE, SIGMA, SYMI, TM_CODE, A_SYN,
  bin, encode, decode, disasm, mnOf, cTokenize, cParse, cCompile, CError, lineCol, assemble,
  CInterp, AsmInterp, McInterp, Circuit, TM, buildProgram, Sim, buildCircuit, buildTM };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.CPU5 = api;
})(typeof window !== 'undefined' ? window : globalThis);
