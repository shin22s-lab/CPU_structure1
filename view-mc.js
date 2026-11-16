/* 機械語パネル: 16 進ダンプ風の一覧 + オペコード表 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;

class McPanel {
  constructor(body, app) {
    this.app = app;
    this.bar = U.el('div', 'bar'); body.appendChild(this.bar);
    const split = U.el('div', 'split'); body.appendChild(split);
    this.list = U.el('div', 'mc'); split.appendChild(this.list);
    this.side = U.el('div', 'side'); split.appendChild(this.side);
    this.lod = 'overview';
    this.list.addEventListener('mousemove', e => {
      const tr = e.target.closest('tr[data-a]');
      if (!tr) return U.hideTip(this);
      const a = +tr.dataset.a, P = this.prog;
      const w = a < P.words.length ? P.words[a] : 0;
      const f = CPU.decode(w);
      const d = U.def('M-' + CPU.bin(f.op, 4));
      U.showTip(e.clientX, e.clientY, { level: 'mc', id: d.id, title: '@' + a + '  ' + CPU.bin(w, 16) + '  =  ' + CPU.disasm(w), body: d.body + '\n\n' + U.def('M-FMT').body, value: 'op=' + CPU.bin(f.op, 4) + '  r=' + CPU.bin(f.r, 3) + '  s=' + CPU.bin(f.s, 3) + '  a=' + CPU.bin(f.a, 6) + ' (' + f.a + ')' + (a >= P.words.length ? '\n（プログラムの外: 0 で埋まっている）' : '') }, this);
    });
    this.list.addEventListener('mouseleave', () => U.hideTip(this));
  }
  load(prog) { this.prog = prog; this.built = false; }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.built = false; this.update(); }
  build() {
    const P = this.prog, n = this.lod === 'full' ? CPU.MEM : P.words.length;
    const detail = this.lod !== 'overview';
    let h = '<table><thead><tr><th>番地</th><th>oooo rrr sss aaaaaa</th><th>16進</th><th>逆アセンブル</th>' + (detail ? '<th>RTL（定義）</th>' : '') + (this.lod === 'full' ? '<th>回数</th>' : '') + '</tr></thead><tbody>';
    for (let a = 0; a < n; a++) {
      const w = a < P.words.length ? P.words[a] : 0, e = a >= P.words.length, isa = CPU.ISA[CPU.decode(w).op];
      h += '<tr data-a="' + a + '" class="' + (e ? 'empty' : '') + '"><td class="addr">' + String(a).padStart(2, '0') + '</td><td class="bits">' + (e ? '<span class="faint">0000000000000000</span>' : U.fieldBits(w)) +
        '</td><td class="hex">' + U.hex(w) + '</td><td>' + (e ? '' : U.esc(CPU.disasm(w))) + '</td>' + (detail ? '<td class="dim">' + (e ? '' : U.esc(isa.rtl)) + '</td>' : '') + (this.lod === 'full' ? '<td class="cnt">0</td>' : '') + '</tr>';
    }
    this.list.innerHTML = h + '</tbody></table>';
    this.rows = [...this.list.querySelectorAll('tbody tr')];
    this.built = true; this.curRow = -1;
  }
  explain(m, f) {
    const R = m.R, r = CPU.REGN[f.r], s = CPU.REGN[f.s], b = v => CPU.bin(v, 8), pc1 = '\nPC ← ' + CPU.bin(m.pc, 6) + ' + 1 = ' + CPU.bin(m.pc + 1, 6);
    const x = R[f.r], y = R[f.s], to = '\nPC ← aaaaaa = ' + CPU.bin(f.a, 6), nx = '\nPC ← PC + 1';
    switch (f.op) {
      case 0: return 'halted ← 1';
      case 1: return 'R[' + r + '] = ' + b(x) + ' → ' + b(x + 1) + pc1;
      case 2: return 'R[' + r + '] = ' + b(x) + ' → ' + b(x - 1) + pc1;
      case 3: return 'R[' + r + '] = ' + b(x) + (x === 0 ? ' = 0' + to : ' ≠ 0' + nx);
      case 4: return to.slice(1);
      case 5: return '  ' + b(x) + '\n+ ' + b(y) + '\n= ' + CPU.bin(x + y, 9) + '  → R[' + r + '] = ' + b(x + y) + ', C = ' + ((x + y) >> 8) + pc1;
      case 6: return '  ' + b(x) + '\n− ' + b(y) + '\n= ' + b(x - y) + '  C = ' + (x < y ? 1 : 0) + (x < y ? '（借り）' : '') + pc1;
      case 7: return 'R[' + r + '] ← R[' + s + '] = ' + b(y) + pc1;
      case 8: return b(x) + ' >> 1 = ' + b(x >> 1) + ',  C = ' + (x & 1) + pc1;
      case 9: return 'C = ' + m.C + (m.C ? to : nx);
      case 10: return 'C = ' + m.C + (!m.C ? to : nx);
      case 11: return 'R[' + r + '] = ' + b(x) + (x !== 0 ? ' ≠ 0' + to : ' = 0' + nx);
      default: return '未定義 → 異常停止';
    }
  }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok) { this.list.innerHTML = ''; this.bar.innerHTML = ''; this.side.innerHTML = ''; return; }
    if (!this.built) this.build();
    const m = sim.mI;
    if (this.curRow >= 0 && this.rows[this.curRow]) this.rows[this.curRow].classList.remove('cur');
    this.curRow = m.pc;
    const row = this.rows[m.pc];
    if (row) { row.classList.add('cur'); const L = this.list; if (row.offsetTop < L.scrollTop + 24 || row.offsetTop > L.scrollTop + L.clientHeight - 30) L.scrollTop = row.offsetTop - L.clientHeight / 2; }
    if (this.lod === 'full') { const cnt = sim.aI.count; this.rows.forEach((r, a) => { if (a < cnt.length) r.lastChild.textContent = cnt[a]; }); }
    const w = m.fetch(), f = CPU.decode(w);
    this.bar.innerHTML = '<span>PC <b class="mono">' + CPU.bin(m.pc, 6) + '</b> = ' + m.pc + '</span><span>IR <b class="mono">' + U.fieldBits(w) + '</b></span><span class="mono">' + CPU.REGN.map((x, i) => x + '=' + U.hex(m.R[i], 2)).join(' ') + ' C=' + m.C + '</span>';
    if (this.lod === 'overview') return;
    const isa = CPU.ISA[f.op], uses = k => isa.args.includes(k);
    let tr = '';
    if (this.lod === 'full') tr = '<h4>実行トレース（新しい順）</h4><div class="box mono" style="font-size:11.5px;white-space:pre">' + m.trace.slice(-40).reverse().map(t => '@' + String(t.pc).padStart(2, '0') + ' ' + U.esc(CPU.disasm(t.w)).padEnd(12) + (t.before !== t.after ? ' ' + t.before + '→' + t.after : '') + (t.c0 !== t.c1 ? ' C' + t.c1 : '') + '  ⇒' + t.npc).join('\n') + '</div>';
    this.side.innerHTML =
      '<h4>オペコード表（定義）</h4><div class="box"><table class="isa">' + CPU.ISA.slice(0, 12).map(e => '<tr class="' + (e.op === f.op ? 'on' : '') + '" data-def="M-' + CPU.bin(e.op, 4) + '"><td class="k-op">' + CPU.bin(e.op, 4) + '</td><td>' + e.name + '</td><td class="dim">' + U.esc(e.rtl) + '</td></tr>').join('') + '<tr><td class="k-op">11xx</td><td>未定義</td><td class="dim">異常停止</td></tr></table></div>' +
      '<h4>解読 → 実行</h4><div class="box"><div class="kv"><span>op</span><span class="k-op">' + CPU.bin(f.op, 4) + ' = ' + isa.name + '</span>' +
      '<span>r</span><span class="k-rr">' + CPU.bin(f.r, 3) + (uses('r') ? ' = ' + CPU.REGN[f.r] : '（使わない）') + '</span><span>s</span><span class="k-ss">' + CPU.bin(f.s, 3) + (uses('s') ? ' = ' + CPU.REGN[f.s] : '（使わない）') + '</span>' +
      '<span>aaaaaa</span><span class="k-ad">' + CPU.bin(f.a, 6) + (uses('a') ? ' = ' + f.a : '（使わない）') + '</span></div><pre class="def">' + U.esc(m.halted ? '停止' : this.explain(m, f)) + '</pre></div>' +
      '<h4>レジスタとフラグ</h4><div class="box"><div class="regs-bin">' + CPU.REGN.map((x, i) => '<span class="' + ((uses('r') && i === f.r) || (uses('s') && i === f.s) ? 'on' : 'dim') + '">R[' + CPU.bin(i, 3) + '] ' + x + '</span><span>' + U.bits(m.R[i], 8) + '</span><span>0x' + U.hex(m.R[i], 2) + '</span>').join('') +
      '<span>C</span><span>' + U.bits(m.C, 1) + '</span><span></span></div></div>' + tr;
    this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const m = sim.mI, w = m.fetch(), f = CPU.decode(w);
    if (m.halted) return { level: 'mc', title: '停止', body: '' };
    const d = U.def('M-' + CPU.bin(f.op, 4));
    return { level: 'mc', id: d.id, title: d.title + '   (@' + m.pc + ' = ' + CPU.bin(w, 16) + ')', body: this.explain(m, f).replace(/\n/g, '  ') };
  }
}
window.McPanel = McPanel;
})();
