// node cpu/test.js [--tm-all] — 全サンプルを同期実行し、毎命令の一致と最終結果を確かめる
const CPU = require('./engine.js');
const PROGRAMS = require('./programs.js');
const TMALL = process.argv.includes('--tm-all');
let fail = 0;
const t0 = Date.now();
function runAll(prog, label, useTM) {
  const sim = new CPU.Sim(prog, { useTM });
  let n = 0;
  if (!sim.check.ok) { console.log('✗ 初期状態', label, sim.check.bad); fail++; }
  while (!sim.halted && n < 500000) {
    sim.stepInstr(); n++;
    if (!sim.check.ok) { console.log('✗', label, '命令', n, sim.check.bad); fail++; break; }
  }
  return { sim, n };
}
for (const P of PROGRAMS) {
  const prog = CPU.buildProgram(P.src, 'c');
  if (!prog.ok) { console.log('✗', P.name, prog.errors); fail++; continue; }
  const useTM = TMALL || P.tm !== false;
  const t1 = Date.now();
  const { sim, n } = runAll(prog, P.name, useTM);
  const regs = sim.mI.R, vars = prog.c.ast.vars;
  const want = Object.entries(P.expect).every(([name, v]) => regs[vars.find(x => x.name === name).reg] === v);
  if (!want) { console.log('✗ 結果', P.name, vars.map(v => v.name + '=' + regs[v.reg]).join(' '), P.expect); fail++; }
  const arr = prog.c.ast.arrays.map(a => a.name + '=[' + sim.mI.ram.slice(a.base, a.base + a.len).join(',') + ']').join(' ');
  console.log((want && sim.check.ok ? '✓' : '✗'), P.name.padEnd(32), '命令', String(n).padStart(6), useTM ? ' TM ' + String(sim.tm.steps).padStart(10) + ' 歩' : ' TM 省略        ', ' 語数', String(prog.words.length).padStart(3), String(Date.now() - t1).padStart(6) + 'ms', '→',
    vars.map(v => v.name + '=' + regs[v.reg]).join(' '), arr);
}
// アセンブリ直接（全命令）
const asm = `        .reg a, 60000
        .reg b, 10000
        .reg h, 3
        .ram 5, 777
        ADD a, b        ; 70000 → 4464, C=1
        JNC bad
        MOV c, a
        ADD c, c        ; 8928
        SUB d, d
        SUB d, h        ; 65533, C=1
        JNC bad
        SHR h           ; 1, C=1
        JNC bad
        LDI e, 5
        LD f, [e]       ; 777
        LDI g, 300
        ST g, [h]       ; RAM[1] = 300
        CALL sub
        SUB h, h
        JNZ h, bad
        JC bad
        DEC h
        INC h
        JZ h, ok
bad:    HALT
ok:     INC g
        HALT
sub:    INC b
        RET
`;
const pa = CPU.buildProgram(asm, 'asm');
if (!pa.ok) { console.log(pa.errors); fail++; }
else {
  const { sim } = runAll(pa, 'asm', true);
  const ok = sim.check.ok && sim.mI.R[6] === 301 && sim.mI.R[2] === 8928 && sim.mI.R[5] === 777 && sim.mI.ram[1] === 300 && sim.mI.R[1] === 10001;
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', 'アセンブリ直接（全命令・TM 込み）', sim.mI.R.join(','), 'RAM1=' + sim.mI.ram[1], 'C=' + sim.mI.C, 'TM', sim.tm.steps, '歩');
}
// ランダムなアセンブリ（TM 込み）
let rnd = 12345; const R = n => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
let rf = 0;
for (let k = 0; k < 120; k++) {
  const L = 6 + R(12); let s = '';
  for (let i = 0; i < 8; i++) s += '.reg ' + CPU.REGN[i] + ', ' + (R(4) ? R(65536) : R(3)) + '\n';
  s += '.ram 0, ' + [...Array(8)].map(() => R(65536)).join(',') + '\n';
  const ops = ['INC', 'DEC', 'ADD', 'SUB', 'MOV', 'SHR', 'JZ', 'JNZ', 'JC', 'JNC', 'LDI', 'LD', 'ST'];
  for (let i = 0; i < L; i++) {
    const op = ops[R(ops.length)], r = CPU.REGN[R(8)], q = CPU.REGN[R(8)], t = i + 1 + R(L - i);
    s += ({ INC: 'INC ' + r, DEC: 'DEC ' + r, ADD: 'ADD ' + r + ',' + q, SUB: 'SUB ' + r + ',' + q, MOV: 'MOV ' + r + ',' + q, SHR: 'SHR ' + r, JZ: 'JZ ' + r + ',' + t, JNZ: 'JNZ ' + r + ',' + t, JC: 'JC ' + t, JNC: 'JNC ' + t, LDI: 'LDI ' + r + ',' + R(512), LD: 'LD ' + r + ',[' + q + ']', ST: 'ST ' + r + ',[' + q + ']' })[op] + '\n';
  }
  s += 'HALT\n';
  const p = CPU.buildProgram(s, 'asm');
  if (!p.ok) { console.log(p.errors); rf++; continue; }
  const sim = new CPU.Sim(p); let n = 0;
  while (!sim.halted && n++ < 100) { sim.stepInstr(); if (!sim.check.ok) { rf++; console.log('✗ random', k, sim.check.bad, '\n' + s); break; } }
  if (rf > 2) break;
}
if (rf) fail++;
console.log(rf ? '✗' : '✓', 'ランダムなアセンブリ 120 本（TM 込み）で一致');
// ランダムな C の掛け算・割り算（C の意味 = 展開したループ）
let cf = 0;
for (let k = 0; k < 40; k++) {
  const a = R(65536), b = k % 5 ? R(65536) >> R(16) : 0;
  const src = 'unsigned int a = ' + a + ', b = ' + b + ', p, q, r;\nvoid main(void) { p = a * b; q = a / b; r = a % b; }\n';
  const p = CPU.buildProgram(src, 'c');
  const sim = new CPU.Sim(p, { useTM: false }); sim.runToEnd();
  const R2 = sim.mI.R;
  const ok = sim.check.ok && R2[2] === (Math.imul(a, b) & 65535) >>> 0 && R2[3] === (b ? Math.floor(a / b) : 65535) && R2[4] === (b ? a % b : a);
  if (!ok) { cf++; console.log('✗ muldiv', a, b, R2, sim.check.bad); }
}
if (cf) fail++;
console.log(cf ? '✗' : '✓', 'C の * / % 40 通り（0 で割るときも含む）');
const pm = CPU.buildProgram(PROGRAMS.find(p => p.id === 'fall').src, 'c'); const s3 = new CPU.Sim(pm); let g = 0;
while (!s3.halted && g++ < 5e6) { s3.microStep(); if (!s3.check.ok) { console.log('✗ micro', s3.check.bad); fail++; break; } }
console.log(s3.check.ok ? '✓' : '✗', 'TM 1 ステップずつ（自由落下）', s3.tm.steps, '歩');
for (const bad of ['unsigned int a; void main(void){ a = b; }', 'int a; void main(void){}', 'unsigned int a; void f(void){ g(); } void g(void){} void main(void){ f(); }', 'unsigned int a; void main(void){ break; }', 'unsigned int a,b,c,d,e,f,g; void main(void){ a = b * c; }']) {
  const r = CPU.buildProgram(bad, 'c'); console.log(r.ok ? '✗ 通ってしまった' : '✓ エラー', r.errors.map(e => e.line + 1 + ':' + e.col + ' ' + e.msg).join(' / '));
  if (r.ok) fail++;
}
const M = CPU.buildTM(); const C = CPU.buildCircuit();
console.log('TM: 状態', M.states.length, '個 / 遷移', M.rules.length, '本 ／ 回路: ゲート', C.gates.length, '個 / ネット', C.nets.length, '本 / 最大深さ', C.maxDepth, '／', (Date.now() - t0) + 'ms');
const show = process.argv.find(a => PROGRAMS.some(p => p.id === a));
if (show) console.log(CPU.cCompile(PROGRAMS.find(p => p.id === show).src).asm);
process.exit(fail ? 1 : 0);
