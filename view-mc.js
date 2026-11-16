/* 機械語パネル: 16 進ダンプ風の一覧 + オペコード表 + RAM */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;

class McPanel {
  constructor(body, app) {
    this.app = app;
    this.bar = U.el('div', 'bar'); body.appendChild(this.bar);
    const split = U.el('div', 'split'); body.appendChild(split);
    const left = U.el('div'); left.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0';
    split.appendChild(left);
    this.list = U.el('div', 'mc'); left.appendChild(this.list);
    this.ramEl = U.el('div', 'ramdump'); left.appendChild(this.ramEl);
    this.side = U.el('div', 'side'); split.appendChild(this.side);
    this.lod = 'overview';
    this.list.addEventListener('mousemove', e => {
      const tr = e.target.closest('tr[data-a]');
      if (!tr) return U.hideTip(this);
      const a = +tr.dataset.a, P = this.prog, w = a < P.words.length ? P.words[a] : 0, f = CPU.decode(w), d = U.def('M-' + CPU.bin(f.op, 4));
      U.showTip(e.clientX, e.clientY, { level: 'mc', id: d.id, title: '@' + a + '  ' + U.fmtBits(w) + '  =  ' + CPU.disasm(w), body: d.body + '\n\n' + U.def('M-FMT').body, value: a >= P.words.length ? '（プログラムの外: 0 で埋まっている）' : '' }, this);
    });
    this.list.addEventListener('mouseleave', () => U.hideTip(this));
  }
  load(prog) { this.prog = prog; this.built = false; }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.ramEl.hidden = l === 'overview'; this.built = false; this.update(); }
  build() {
    const P = this.prog, n = this.lod === 'full' ? Math.min(CPU.MEM, Math.max(64, P.words.length + 8)) : P.words.length;
    const detail = this.lod !== 'overview';
    let h = '<table><thead><tr><th>番地</th><th>命令語（2 進）</th><th>16進</th><th>逆アセンブル</th>' + (detail ? '<th>RTL（定義）</th>' : '') + (this.lod === 'full' ? '<th>回数</th>' : '') + '</tr></thead><tbody>';
    for (let a = 0; a < n; a++) {
      const w = a < P.words.length ? P.words[a] : 0, e = a >= P.words.length, isa = CPU.ISA[CPU.decode(w).op];
      h += '<tr data-a="' + a + '" class="' + (e ? 'empty' : '') + '"><td class="addr">' + String(a).padStart(3, '0') + '</td><td class="bits">' + (e ? '<span class="faint">0000000000000000</span>' : U.fieldBits(w)) +
        '</td><td class="hex">' + U.hex(w) + '</td><td>' + (e ? '' : U.esc(CPU.disasm(w))) + '</td>' + (detail ? '<td class="dim">' + (e ? '' : U.esc(isa.rtl)) + '</td>' : '') + (this.lod === 'full' ? '<td class="cnt">0</td>' : '') + '</tr>';
    }
    this.list.innerHTML = h + '</tbody></table>';
    this.rows = [...this.list.querySelectorAll('tbody tr')];
    this.built = true; this.curRow = -1;
  }
  explain(m, f) {
    const R = m.R, r = CPU.REGN[f.r], s = CPU.REGN[f.s], b = v => CPU.bin(v, 16), M = 65535, a8 = f.a & 255;
    const pc1 = '\nPC ← PC + 1 = ' + ((m.pc + 1) & 255), x = R[f.r], y = R[f.s], to = '\nPC ← ' + a8, nx = '\nPC ← PC + 1';
    switch (f.op) {
      case 0: return 'halted ← 1';
      case 1: return 'R[' + r + '] = ' + b(x) + '\n     → ' + b((x + 1) & M) + pc1;
      case 2: return 'R[' + r + '] = ' + b(x) + '\n     → ' + b((x - 1) & M) + pc1;
      case 3: return 'R[' + r + '] = ' + x + (x === 0 ? ' = 0' + to : ' ≠ 0' + nx);
      case 4: return to.slice(1);
      case 5: return '  ' + b(x) + '\n+ ' + b(y) + '\n= ' + CPU.bin(x + y, 17) + '\nR[' + r + '] = ' + ((x + y) & M) + ', C = ' + ((x + y) >>> 16) + pc1;
      case 6: return '  ' + b(x) + '\n− ' + b(y) + '\n= ' + b((x - y) & M) + '\nC = ' + (x < y ? 1 : 0) + (x < y ? '（借り）' : '') + pc1;
      case 7: return 'R[' + r + '] ← R[' + s + '] = ' + y + pc1;
      case 8: return b(x) + ' >> 1\n= ' + b(x >>> 1) + ',  C = ' + (x & 1) + pc1;
      case 9: { const jnc = f.r & 1; return (jnc ? 'JNC' : 'JC') + ': C = ' + m.C + ((jnc ? !m.C : m.C) ? to : nx); }
      case 10: return 'R[' + r + '] = ' + x + (x !== 0 ? ' ≠ 0' + to : ' = 0' + nx);
      case 11: return 'R[' + r + '] ← ' + f.a + ' (' + CPU.bin(f.a, 9) + ')' + pc1;
      case 12: return '番地 = R[' + s + '] mod 64 = ' + (y & 63) + '\nR[' + r + '] ← RAM[' + (y & 63) + '] = ' + m.ram[y & 63] + pc1;
      case 13: return '番地 = R[' + s + '] mod 64 = ' + (y & 63) + '\nRAM[' + (y & 63) + '] ← R[' + r + '] = ' + x + pc1;
      case 14: return 'LR ← PC + 1 = ' + ((m.pc + 1) & 255) + to;
      case 15: return 'PC ← LR = ' + m.LR;
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
    this.bar.innerHTML = '<span>PC <b class="mono">' + m.pc + '</b></span><span>IR <b class="mono">' + U.fieldBits(w) + '</b></span><span class="mono">' + CPU.REGN.map((x, i) => x + '=' + U.hex(m.R[i], 4)).join(' ') + ' C=' + m.C + ' LR=' + m.LR + '</span>';
    if (this.lod === 'overview') return;
    const last = m.trace[m.trace.length - 1];
    const memA = (f.op === 12 || f.op === 13) ? m.R[f.s] & 63 : -1;
    const arrs = P.c ? P.c.ast.arrays : [];
    const owner = i => { const a = arrs.find(x => i >= x.base && i < x.base + x.len); return a ? a.name + '[' + (i - a.base) + ']' : ''; };
    let rh = '<div class="ram-h">RAM 64 語（16 進）' + (arrs.length ? ' — ' + arrs.map(a => a.name + ' = ' + a.base + '〜' + (a.base + a.len - 1)).join(', ') : '') + '</div><div class="ram-g">';
    for (let i = 0; i < CPU.RAMN; i++) rh += '<span class="' + (i === memA ? 'on' : last && last.mem === i ? 'was' : owner(i) ? 'own' : '') + '" title="RAM[' + i + '] = ' + m.ram[i] + (owner(i) ? '  ' + owner(i) : '') + '">' + U.hex(m.ram[i], 4) + '</span>';
    this.ramEl.innerHTML = rh + '</div>';
    const isa = CPU.ISA[f.op], fmt = isa.fmt;
    let tr = '';
    if (this.lod === 'full') tr = '<h4>実行トレース（新しい順）</h4><div class="box mono" style="font-size:11.5px;white-space:pre">' + m.trace.slice(-40).reverse().map(t => '@' + String(t.pc).padStart(3, '0') + ' ' + U.esc(CPU.disasm(t.w)).padEnd(13) + (t.before !== t.after ? ' ' + t.before + '→' + t.after : '') + (t.mem != null ? ' M' + t.mem : '') + (t.c0 !== t.c1 ? ' C' + t.c1 : '') + '  ⇒' + t.npc).join('\n') + '</div>';
    this.side.innerHTML =
      '<h4>オペコード表（定義）</h4><div class="box"><table class="isa">' + CPU.ISA.map(e => '<tr class="' + (e.op === f.op ? 'on' : '') + '" data-def="M-' + CPU.bin(e.op, 4) + '"><td class="k-op">' + CPU.bin(e.op, 4) + '</td><td>' + e.name + '</td><td class="dim">' + U.esc(e.rtl) + '</td></tr>').join('') + '</table></div>' +
      '<h4>解読 → 実行</h4><div class="box"><div class="kv"><span>書式</span><span>' + U.esc(fmt) + '</span><span>op</span><span class="k-op">' + CPU.bin(f.op, 4) + ' = ' + CPU.mnOf(w) + '</span>' +
      '<span>r</span><span class="k-rr">' + CPU.bin(f.r, 3) + ' = ' + CPU.REGN[f.r] + '</span>' + ([5, 6, 7, 12, 13].includes(f.op) ? '<span>s</span><span class="k-ss">' + CPU.bin(f.s, 3) + ' = ' + CPU.REGN[f.s] + '</span>' : '<span>a / i</span><span class="k-ad">' + CPU.bin(f.a, 9) + ' = ' + f.a + '</span>') +
      '</div><pre class="def">' + U.esc(m.halted ? '停止' : this.explain(m, f)) + '</pre></div>' +
      '<h4>レジスタ</h4><div class="box"><div class="regs-bin">' + CPU.REGN.map((x, i) => '<span class="' + (i === f.r || ([5, 6, 7, 12, 13].includes(f.op) && i === f.s) ? 'on' : 'dim') + '">' + x + '</span><span>' + U.bits(m.R[i], 16) + '</span><span>' + m.R[i] + '</span>').join('') +
      '<span>C</span><span>' + U.bits(m.C, 1) + '</span><span></span><span>LR</span><span>' + U.bits(m.LR, 8) + '</span><span>' + m.LR + '</span></div></div>' + tr;
    this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const m = sim.mI, w = m.fetch(), f = CPU.decode(w);
    if (m.halted) return { level: 'mc', title: '停止', body: '' };
    const d = U.def('M-' + CPU.bin(f.op, 4));
    return { level: 'mc', id: d.id, title: d.title + '   (@' + m.pc + ' = ' + U.fmtBits(w) + ')', body: this.explain(m, f).replace(/\n/g, '  ') };
  }
}
window.McPanel = McPanel;
})();
