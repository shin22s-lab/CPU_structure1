// node cpu/test.js — 全サンプルを 5 層で同期実行し、毎命令の一致と最終結果を確かめる
const CPU = require('./engine.js');
const PROGRAMS = require('./programs.js');
let fail = 0;
for (const P of PROGRAMS) {
  const prog = CPU.buildProgram(P.src, 'c');
  if (!prog.ok) { console.log('✗', P.name, prog.errors); fail++; continue; }
  const sim = new CPU.Sim(prog);
  let n = 0;
  if (!sim.check.ok) { console.log('✗ 初期状態', P.name, sim.check.bad); fail++; }
  while (!sim.halted && n < 5000) {
    sim.stepInstr(); n++;
    if (!sim.check.ok) { console.log('✗', P.name, '命令', n, sim.check.bad); fail++; break; }
  }
  const regs = sim.mI.R;
  const want = Object.entries(P.expect).every(([name, v]) => regs[prog.c.ast.vars.find(x => x.name === name).reg] === v);
  if (!want) { console.log('✗ 結果', P.name, regs, P.expect); fail++; }
  console.log((want && sim.check.ok ? '✓' : '✗'), P.name.padEnd(24), '命令', String(n).padStart(4), '回路クロック', String(sim.ck.cycles).padStart(4),
    'TM ステップ', String(sim.tm.steps).padStart(7), '語数', prog.words.length, '→', CPU.REGN.map((r, i) => r + '=' + regs[i]).join(' '));
}
// アセンブリ直接入力
const asm = `        .reg a, 1
loop:   JZ a, done
        DEC a
        INC b
        JMP loop
done:   HALT
`;
const pa = CPU.buildProgram(asm, 'asm');
const s2 = new CPU.Sim(pa); let k = 0; while (!s2.halted && k++ < 100) { s2.stepInstr(); if (!s2.check.ok) { console.log('✗ asm', s2.check.bad); fail++; break; } }
console.log(s2.check.ok && s2.mI.R[1] === 1 ? '✓' : '✗', 'アセンブリ直接', s2.mI.R);
// マイクロステップ経由でも一致すること
const pm = CPU.buildProgram(PROGRAMS[1].src, 'c'); const s3 = new CPU.Sim(pm); let g = 0;
while (!s3.halted && g++ < 1e6) { s3.microStep(); if (!s3.check.ok) { console.log('✗ micro', s3.check.bad); fail++; break; } }
console.log(s3.check.ok && s3.mI.R[2] === 6 ? '✓' : '✗', 'TM 1 ステップずつ（掛け算）', s3.tm.steps, 'steps');
// エラー表示
for (const bad of ['unsigned char a; void main(void){ a += 2; }', 'int a; void main(void){}', 'unsigned char a; void main(void){ while (a == 0) a++; }']) {
  const r = CPU.buildProgram(bad, 'c'); console.log(r.ok ? '✗ 通ってしまった' : '✓ エラー', r.errors.map(e => e.line + 1 + ':' + e.col + ' ' + e.msg).join(' / '));
}
const M = CPU.buildTM(); const C = CPU.buildCircuit();
console.log('TM: 状態', M.states.length, '個 / 遷移', M.rules.length, '本 ／ 回路: ゲート', C.gates.length, '個 / 配線', C.nets.length, '本 / 最大深さ', C.maxDepth);
console.log(PROGRAMS[1] && CPU.cCompile(PROGRAMS[1].src).asm);
process.exit(fail ? 1 : 0);
