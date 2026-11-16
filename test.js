// node cpu/test.js — 全サンプルを 5 層で同期実行し、毎命令の一致と最終結果を確かめる
const CPU = require('./engine.js');
const PROGRAMS = require('./programs.js');
let fail = 0;
const t0 = Date.now();
function runAll(prog, label) {
  const sim = new CPU.Sim(prog);
  let n = 0;
  if (!sim.check.ok) { console.log('✗ 初期状態', label, sim.check.bad); fail++; }
  while (!sim.halted && n < 200000) {
    sim.stepInstr(); n++;
    if (!sim.check.ok) { console.log('✗', label, '命令', n, sim.check.bad); fail++; break; }
  }
  return { sim, n };
}
for (const P of PROGRAMS) {
  const prog = CPU.buildProgram(P.src, 'c');
  if (!prog.ok) { console.log('✗', P.name, prog.errors); fail++; continue; }
  const { sim, n } = runAll(prog, P.name);
  const regs = sim.mI.R;
  const want = Object.entries(P.expect).every(([name, v]) => regs[prog.c.ast.vars.find(x => x.name === name).reg] === v);
  if (!want) { console.log('✗ 結果', P.name, regs, P.expect); fail++; }
  console.log((want && sim.check.ok ? '✓' : '✗'), P.name.padEnd(30), '命令', String(n).padStart(5), ' TM', String(sim.tm.steps).padStart(9), '歩  語数', String(prog.words.length).padStart(2), '→',
    prog.c.ast.vars.map(v => v.name + '=' + regs[v.reg]).join(' '));
}
// アセンブリ直接（全命令・r=s の場合を含む）
const asm = `        .reg a, 200
        .reg b, 100
        .reg h, 3
        ADD a, b        ; 300 → 44, C=1
        JNC bad
        MOV c, a
        ADD c, c        ; 88
        SUB d, d        ; 0
        SUB d, h        ; 253, C=1
        JNC bad
        SHR h           ; 1, C=1
        JNC bad
        MOV e, e
        SUB h, h
        JNZ h, bad
        JC bad          ; SUB h,h は C=0
        DEC h           ; 255
        INC h           ; 0
        JZ h, ok
bad:    HALT
ok:     INC g
        HALT
`;
const pa = CPU.buildProgram(asm, 'asm');
if (!pa.ok) { console.log(pa.errors); fail++; }
else {
  const { sim } = runAll(pa, 'asm');
  const ok = sim.check.ok && sim.mI.R[6] === 1 && sim.mI.R[2] === 88 && sim.mI.R[3] === 253;
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', 'アセンブリ直接（全命令）', sim.mI.R.join(','), 'C=' + sim.mI.C);
}
// ランダムなアセンブリで回路・TM・機械語を突き合わせる
let rnd = 12345; const R = n => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
let rf = 0;
for (let k = 0; k < 150; k++) {
  const L = 6 + R(10); let s = '';
  for (let i = 0; i < 8; i++) s += '.reg ' + CPU.REGN[i] + ', ' + R(256) + '\n';
  const ops = ['INC', 'DEC', 'ADD', 'SUB', 'MOV', 'SHR', 'JZ', 'JNZ', 'JC', 'JNC'];
  for (let i = 0; i < L; i++) {
    const op = ops[R(ops.length)], r = CPU.REGN[R(8)], q = CPU.REGN[R(8)], t = i + 1 + R(L - i);
    s += ({ INC: 'INC ' + r, DEC: 'DEC ' + r, ADD: 'ADD ' + r + ',' + q, SUB: 'SUB ' + r + ',' + q, MOV: 'MOV ' + r + ',' + q, SHR: 'SHR ' + r, JZ: 'JZ ' + r + ',' + t, JNZ: 'JNZ ' + r + ',' + t, JC: 'JC ' + t, JNC: 'JNC ' + t })[op] + '\n';
  }
  s += 'HALT\n';
  const p = CPU.buildProgram(s, 'asm');
  if (!p.ok) { console.log(p.errors); rf++; continue; }
  const sim = new CPU.Sim(p); let n = 0;
  while (!sim.halted && n++ < 100) { sim.stepInstr(); if (!sim.check.ok) { rf++; console.log('✗ random', k, sim.check.bad, '\n' + s); break; } }
}
if (rf) fail++;
console.log(rf ? '✗' : '✓', 'ランダムなアセンブリ 150 本（前向き分岐のみ）で 4 層一致');
// TM を 1 ステップずつ（run と step の一致）
const pm = CPU.buildProgram(PROGRAMS[2].src, 'c'); const s3 = new CPU.Sim(pm); let g = 0;
while (!s3.halted && g++ < 2e6) { s3.microStep(); if (!s3.check.ok) { console.log('✗ micro', s3.check.bad); fail++; break; } }
console.log(s3.check.ok ? '✓' : '✗', 'TM 1 ステップずつ（2 進の掛け算）', s3.tm.steps, '歩');
for (const bad of ['unsigned char a; void main(void){ a += 300; }', 'int a; void main(void){}', 'unsigned char a,b; void main(void){ if (a < 3) a++; }', 'unsigned char a; void main(void){ break; }']) {
  const r = CPU.buildProgram(bad, 'c'); console.log(r.ok ? '✗ 通ってしまった' : '✓ エラー', r.errors.map(e => e.line + 1 + ':' + e.col + ' ' + e.msg).join(' / '));
  if (r.ok) fail++;
}
const M = CPU.buildTM(); const C = CPU.buildCircuit();
console.log('TM: 状態', M.states.length, '個 / 遷移', M.rules.length, '本 ／ 回路: ゲート', C.gates.length, '個 / ネット', C.nets.length, '本 / 最大深さ', C.maxDepth, '／', (Date.now() - t0) + 'ms');
if (process.argv[2]) console.log(CPU.cCompile(PROGRAMS.find(p => p.id === process.argv[2]).src).asm);
process.exit(fail ? 1 : 0);
