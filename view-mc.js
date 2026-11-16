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
      const { op, r, a: ad } = CPU.decode(w);
      const d = U.def('M-' + CPU.bin(op, 3));
      U.showTip(e.clientX, e.clientY, { level: 'mc', id: d.id, title: '@' + a + '  ' + CPU.bin(w, 10) + '  =  ' + CPU.disasm(w), body: d.body + '\n\n' + U.def('M-FMT').body, value: 'op=' + CPU.bin(op, 3) + '  rr=' + CPU.bin(r, 2) + '  aaaaa=' + CPU.bin(ad, 5) + ' (' + ad + ')' + (a >= P.words.length ? '\n（プログラムの外: 0 で埋まっている）' : '') }, this);
    });
    this.list.addEventListener('mouseleave', () => U.hideTip(this));
  }
  load(prog) { this.prog = prog; this.built = false; }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.built = false; this.update(); }
  build() {
    const P = this.prog, n = this.lod === 'full' ? CPU.MEM : P.words.length;
    const detail = this.lod !== 'overview';
    let h = '<table><thead><tr><th>番地</th><th>op rr aaaaa</th><th>16進</th><th>逆アセンブル</th>' + (detail ? '<th>RTL（定義）</th>' : '') + (this.lod === 'full' ? '<th>回数</th>' : '') + '</tr></thead><tbody>';
    for (let a = 0; a < n; a++) {
      const w = a < P.words.length ? P.words[a] : 0;
      const e = a >= P.words.length;
      const isa = CPU.ISA[CPU.decode(w).op];
      h += '<tr data-a="' + a + '" class="' + (e ? 'empty' : '') + '"><td class="addr">' + String(a).padStart(2, '0') + '</td><td class="bits">' + (e ? '<span class="faint">0000000000</span>' : U.fieldBits(w)) +
        '</td><td class="hex">' + U.hex(w) + '</td><td>' + (e ? '' : U.esc(CPU.disasm(w))) + '</td>' + (detail ? '<td class="dim">' + (e ? '' : U.esc(isa.rtl)) + '</td>' : '') + (this.lod === 'full' ? '<td class="cnt">0</td>' : '') + '</tr>';
    }
    this.list.innerHTML = h + '</tbody></table>';
    this.rows = [...this.list.querySelectorAll('tbody tr')];
    this.built = true;
    this.curRow = -1;
  }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok) { this.list.innerHTML = ''; this.bar.innerHTML = ''; this.side.innerHTML = ''; return; }
    if (!this.built) this.build();
    const m = sim.mI;
    if (this.curRow >= 0 && this.rows[this.curRow]) this.rows[this.curRow].classList.remove('cur');
    this.curRow = m.pc; if (this.rows[m.pc]) { this.rows[m.pc].classList.add('cur'); const r = this.rows[m.pc]; const L = this.list; if (r.offsetTop < L.scrollTop + 20 || r.offsetTop > L.scrollTop + L.clientHeight - 30) L.scrollTop = r.offsetTop - L.clientHeight / 2; }
    if (this.lod === 'full') { const cnt = sim.aI.count; this.rows.forEach((r, a) => { if (a < cnt.length) r.lastChild.textContent = cnt[a]; }); }
    const w = m.fetch(), { op, r, a } = CPU.decode(w);
    this.bar.innerHTML = '<span>PC <b class="mono">' + CPU.bin(m.pc, 5) + '</b> = ' + m.pc + '</span><span>IR <b class="mono">' + U.fieldBits(w) + '</b></span><span class="mono">' + CPU.REGN.map((x, i) => x + '=' + U.hex(m.R[i], 2)).join(' ') + '</span>';
    if (this.lod === 'overview') return;
    const isa = CPU.ISA[op];
    const R = m.R;
    let ex = '';
    if (m.halted) ex = '停止';
    else if (op === 1) ex = 'R[' + CPU.REGN[r] + '] = ' + CPU.bin(R[r], 8) + ' → ' + CPU.bin((R[r] + 1) & 255, 8) + '\nPC ← ' + CPU.bin(m.pc, 5) + ' + 1 = ' + CPU.bin(m.pc + 1, 5);
    else if (op === 2) ex = 'R[' + CPU.REGN[r] + '] = ' + CPU.bin(R[r], 8) + ' → ' + CPU.bin((R[r] - 1) & 255, 8) + '\nPC ← ' + CPU.bin(m.pc, 5) + ' + 1 = ' + CPU.bin(m.pc + 1, 5);
    else if (op === 3) ex = 'R[' + CPU.REGN[r] + '] = ' + CPU.bin(R[r], 8) + (R[r] === 0 ? ' = 0\nPC ← aaaaa = ' + CPU.bin(a, 5) : ' ≠ 0\nPC ← PC + 1 = ' + CPU.bin(m.pc + 1, 5));
    else if (op === 4) ex = 'PC ← aaaaa = ' + CPU.bin(a, 5);
    else if (op === 0) ex = 'halted ← 1';
    let tr = '';
    if (this.lod === 'full') {
      tr = '<h4>実行トレース（新しい順）</h4><div class="box mono" style="font-size:11.5px">' + m.trace.slice(-40).reverse().map(t => '@' + String(t.pc).padStart(2, '0') + ' ' + U.esc(CPU.disasm(t.w)).padEnd(10) + (CPU.decode(t.w).op <= 2 && CPU.decode(t.w).op > 0 ? '  ' + t.before + '→' + t.after : '') + '  ⇒ PC ' + t.npc).join('<br>') + '</div>';
    }
    this.side.innerHTML =
      '<h4>オペコード表（定義）</h4><div class="box"><table class="isa">' + CPU.ISA.map(e => '<tr class="' + (e.op === op ? 'on' : '') + '" data-def="M-' + CPU.bin(e.op, 3) + '"><td class="k-op">' + CPU.bin(e.op, 3) + '</td><td>' + e.name + '</td><td class="dim">' + U.esc(e.rtl) + '</td></tr>').join('') + '</table></div>' +
      '<h4>解読 → 実行</h4><div class="box"><div class="kv"><span>op</span><span class="k-op">' + CPU.bin(op, 3) + ' = ' + isa.name + '</span><span>rr</span><span class="k-rr">' + CPU.bin(r, 2) + ' = ' + CPU.REGN[r] + '</span><span>aaaaa</span><span class="k-ad">' + CPU.bin(a, 5) + ' = ' + a + '</span></div><pre class="def">' + U.esc(ex) + '</pre></div>' +
      '<h4>レジスタ</h4><div class="box"><div class="regs-bin">' + CPU.REGN.map((x, i) => '<span class="' + (i === r && op >= 1 && op <= 3 ? 'on' : 'dim') + '">R[' + CPU.bin(i, 2) + '] ' + x + '</span><span>' + U.bits(R[i], 8) + '</span><span>0x' + U.hex(R[i], 2) + '</span>').join('') + '</div></div>' + tr;
    this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const m = sim.mI, w = m.fetch(), { op } = CPU.decode(w);
    if (m.halted) return { level: 'mc', title: '停止', body: '' };
    const d = U.def('M-' + CPU.bin(op, 3));
    return { level: 'mc', id: d.id, title: d.title + '   (@' + m.pc + ' = ' + CPU.bin(w, 10) + ')', body: CPU.ISA[op].rtl };
  }
}
window.McPanel = McPanel;
})();
