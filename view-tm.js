/* チューリングマシン パネル
 *   俯瞰: ヘッド周りのテープ + 状態 + 直前の遷移
 *   詳細: 大きいテープ + 現在状態の δ 行 + 履歴
 *   全体: テープ全体（折り返し）+ 状態遷移図 + δ 全表 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';
const SYM = { '^': 'テープ左端', '*': 'PC の印（この直後の命令を実行中）', ':': '命令の区切り', ']': 'プログラムの終わり / レジスタの始まり', '#': 'レジスタの区切り', '$': 'テープ右端の印', '_': '空白', '0': 'ビット 0', '1': 'ビット 1' };

class TMPanel {
  constructor(body, app) {
    this.app = app;
    this.lod = 'overview';
    this.tapeCv = new U.CanvasView(body, { onMove: p => this.hoverTape(p), onLeave: () => U.hideTip(this) });
    this.tapeCv.wrap.style.flex = '0 0 132px';
    this.info = U.el('div', 'tm-info'); body.appendChild(this.info);
    this.lower = U.el('div', 'tm-lower'); body.appendChild(this.lower);
    this.graphWrap = U.el('div'); this.graphWrap.style.cssText = 'flex:1.4;display:flex;min-height:0;border-right:1px solid #111';
    this.lower.appendChild(this.graphWrap);
    this.graph = new U.CanvasView(this.graphWrap, { pan: true, hint: '状態遷移図（ドラッグ・ホイール）', onMove: p => this.hoverGraph(p), onLeave: () => U.hideTip(this) });
    this.curTab = U.el('div', 'dtab'); this.curTab.style.flex = '1'; this.lower.appendChild(this.curTab);
    this.allTab = U.el('div', 'dtab'); this.allTab.style.flex = '1.2'; this.allTab.style.borderLeft = '1px solid #111'; this.lower.appendChild(this.allTab);
    this.camX = 0;
    this.allTab.addEventListener('mousemove', e => { const tr = e.target.closest('tr[data-r]'); if (!tr) return U.hideTip(this); U.showTip(e.clientX, e.clientY, 'TM-' + tr.dataset.r, this); });
    this.allTab.addEventListener('mouseleave', () => U.hideTip(this));
    this.curTab.addEventListener('mousemove', e => { const tr = e.target.closest('tr[data-r]'); if (!tr) return U.hideTip(this); U.showTip(e.clientX, e.clientY, 'TM-' + tr.dataset.r, this); });
    this.curTab.addEventListener('mouseleave', () => U.hideTip(this));
  }
  load(prog) { this.prog = prog; this.M = CPU.TM.machine || CPU.buildTM(); if (!CPU.TM.machine) CPU.TM.machine = this.M; this.allBuilt = false; this.layoutGraph(); }
  setLOD(l) {
    this.lod = l;
    this.lower.hidden = l === 'overview';
    this.graphWrap.hidden = l !== 'full';
    this.allTab.hidden = l !== 'full';
    this.tapeCv.wrap.style.flex = l === 'full' ? '0 0 300px' : l === 'detail' ? '0 0 170px' : '1 1 110px';
    if (l === 'full') this.buildAll();
    this.lastQ = null;
    this.update();
  }
  /* ---------- テープ ---------- */
  region(tm, i) {
    const t = tm.tape;
    if (i === 0) return { k: 'end' };
    if (i < tm.progEnd) { const ins = Math.floor((i - 1) / 11), f = (i - 1) % 11; return { k: 'ins', ins, f }; }
    if (i === tm.progEnd) return { k: 'pend' };
    for (let r = 0; r < 4; r++) { const s = tm.regStart[r]; if (i >= s && i < s + 8) return { k: 'reg', r, bit: 7 - (i - s) }; if (i === s + 8) return { k: r < 3 ? 'sep' : 'dollar' }; }
    return { k: 'blank' };
  }
  frame(dt) {
    if (!this.app.sim || !this.prog || !this.prog.ok) return;
    if (this.tapeCv.visible()) this.drawTape();
    if (this.lod === 'full' && this.graph.visible()) this.drawGraph();
  }
  drawTape() {
    const cv = this.tapeCv, tm = this.app.sim.tm, c = cv.begin(false);
    const W = cv.w, H = cv.h;
    c.fillStyle = '#16181b'; c.fillRect(0, 0, W, H);
    const t = tm.tape;
    if (this.lod === 'full') return this.drawTapeWrapped(c, W, H, tm);
    const cw = this.lod === 'detail' ? 26 : Math.max(16, Math.min(24, H / 4.4)), ch = cw * 1.25;
    const y0 = Math.max(34, (H - ch) / 2 - 6);
    const target = tm.head * cw - W / 2 + cw / 2;
    this.camX += (target - this.camX) * (this.app.running ? 0.25 : 1);
    if (Math.abs(target - this.camX) > W) this.camX = target;
    const i0 = Math.max(0, Math.floor(this.camX / cw) - 1), i1 = Math.min(t.length, Math.ceil((this.camX + W) / cw) + 1);
    this.cellGeom = { cw, ch, y0, camX: this.camX };
    for (let i = i0; i < i1; i++) this.drawCell(c, tm, i, i * cw - this.camX, y0, cw, ch);
    // 領域ラベル
    c.font = '10.5px ' + MONO; c.textBaseline = 'alphabetic';
    for (let k = 0; k * 11 + 1 < tm.progEnd; k++) {
      const s = 1 + k * 11, x = s * cw - this.camX;
      if (x > W || x + 11 * cw < 0) continue;
      const w = parseInt(t.slice(s + 1, s + 11).join(''), 2);
      c.fillStyle = t[s] === '*' ? '#ffcf4d' : '#7d8590';
      c.fillText('[' + k + '] ' + CPU.disasm(w), x + 3, y0 + ch + 15);
    }
    CPU.REGN.forEach((r, k) => {
      const s = tm.regStart[k], x = s * cw - this.camX;
      if (x > W || x + 8 * cw < 0) return;
      c.fillStyle = '#9cdcfe'; c.fillText(r + ' = ' + parseInt(t.slice(s, s + 8).join(''), 2), x + 3, y0 + ch + 15);
    });
    // ヘッド
    const hx = tm.head * cw - this.camX;
    const q = tm.q, ph = this.M.info[q] ? this.M.info[q].phase : 'halt';
    c.fillStyle = U.PHCOLOR[ph]; c.beginPath(); c.moveTo(hx + cw / 2, y0 - 3); c.lineTo(hx + cw / 2 - 7, y0 - 13); c.lineTo(hx + cw / 2 + 7, y0 - 13); c.fill();
    c.strokeStyle = U.PHCOLOR[ph]; c.lineWidth = 2.5; c.strokeRect(hx + 1, y0 + 1, cw - 2, ch - 2);
    c.font = '600 12px ' + MONO; c.textAlign = 'center';
    const lbl = q + '  ·  ' + CPU.PHASE[ph].name;
    const lw = c.measureText(lbl).width + 14;
    const lx = Math.max(lw / 2 + 2, Math.min(W - lw / 2 - 2, hx + cw / 2));
    c.fillStyle = '#26282c'; U.rr(c, lx - lw / 2, y0 - 32, lw, 18, 3); c.fill();
    c.fillStyle = U.PHCOLOR[ph]; c.fillText(lbl, lx, y0 - 19); c.textAlign = 'left';
  }
  drawCell(c, tm, i, x, y, cw, ch, small) {
    const s = tm.tape[i], rg = this.region(tm, i);
    let bg = '#1e2024';
    if (rg.k === 'ins') bg = rg.f === 0 ? '#25272b' : rg.f <= 3 ? 'rgba(232,163,106,.13)' : rg.f <= 5 ? 'rgba(199,146,234,.13)' : 'rgba(95,211,196,.11)';
    else if (rg.k === 'reg') bg = 'rgba(156,220,254,.10)';
    c.fillStyle = bg; c.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    if (rg.k === 'ins' && rg.ins % 2) { c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(x, y, cw, ch); }
    c.strokeStyle = '#30343a'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    const last = this.app.sim.tm.last;
    c.fillStyle = s === '1' ? '#ffcf4d' : s === '0' ? '#808893' : s === '*' ? '#ff6b6b' : '#c5c8ce';
    c.font = (s === '1' || s === '*' ? '700 ' : '') + Math.round(cw * 0.6) + 'px ' + MONO;
    c.textAlign = 'center'; c.fillText(s, x + cw / 2, y + ch * 0.68); c.textAlign = 'left';
    if (!small && cw > 18 && i % 10 === 0) { c.fillStyle = '#4d535c'; c.font = '9px ' + MONO; c.fillText(i, x + 2, y - 3); }
  }
  drawTapeWrapped(c, W, H, tm) {
    const t = tm.tape, n = t.length;
    const cw = Math.max(12, Math.min(22, Math.floor((W - 20) / 44))), ch = cw * 1.25, per = Math.floor((W - 20) / cw);
    const rowsH = ch + 18;
    this.cellGeom = { wrapped: true, cw, ch, per, rowsH };
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), x = 10 + (i % per) * cw, y = 22 + r * rowsH;
      if (y > H) break;
      this.drawCell(c, tm, i, x, y, cw, ch, true);
      if (i === tm.head) { const ph = this.M.info[tm.q] ? this.M.info[tm.q].phase : 'halt'; c.strokeStyle = U.PHCOLOR[ph]; c.lineWidth = 2.5; c.strokeRect(x + 1, y + 1, cw - 2, ch - 2); c.fillStyle = U.PHCOLOR[ph]; c.beginPath(); c.moveTo(x + cw / 2, y - 1); c.lineTo(x + cw / 2 - 5, y - 8); c.lineTo(x + cw / 2 + 5, y - 8); c.fill(); }
    }
    c.fillStyle = '#7d8590'; c.font = '11px ' + MONO;
    c.fillText('テープ全体 ' + n + ' マス（命令 ' + this.prog.words.length + ' 個 × 11 マス + レジスタ 4 × 8bit）  状態 ' + tm.q, 10, 14);
  }
  hoverTape(p) {
    const tm = this.app.sim && this.app.sim.tm, g = this.cellGeom; if (!tm || !g) return;
    let i;
    if (g.wrapped) { const r = Math.floor((p.sy - 22) / g.rowsH), col = Math.floor((p.sx - 10) / g.cw); if (col < 0 || col >= g.per) return U.hideTip(this); i = r * g.per + col; }
    else { if (p.sy < g.y0 || p.sy > g.y0 + g.ch) return U.hideTip(this); i = Math.floor((p.sx + g.camX) / g.cw); }
    if (i < 0 || i >= tm.tape.length) return U.hideTip(this);
    const rg = this.region(tm, i), s = tm.tape[i];
    let where = '';
    if (rg.k === 'ins') where = '命令 [' + rg.ins + '] の ' + (rg.f === 0 ? '区切り' : rg.f <= 3 ? 'オペコード bit' + (10 - rg.f) : rg.f <= 5 ? 'rr bit' + (10 - rg.f) : 'aaaaa bit' + (10 - rg.f));
    else if (rg.k === 'reg') where = 'レジスタ ' + CPU.REGN[rg.r] + ' の bit' + rg.bit + '（2^' + rg.bit + ' の位）';
    U.showTip(p.cx, p.cy, { level: 'tm', id: 'TM-TAPE', title: 'マス ' + i + ' : 「' + s + '」', body: SYM[s] + (where ? '\n' + where : '') + '\n\n' + U.def('TM-TAPE').body, value: i === tm.head ? 'ヘッドがここにある。次の遷移 δ(' + tm.q + ', ' + s + ')' : '' }, this);
  }
  /* ---------- 状態遷移図 ---------- */
  layoutGraph() {
    if (this.gpos) return;
    const M = this.M, pos = {};
    const cols = [
      ['F', 'D', 'D0', 'D1', 'D00', 'D01', 'D10', 'D11', 'HALT', 'HALT_ERR'],
      ['INC_R', 'INC_R0', 'INC_R1', 'DEC_R', 'DEC_R0', 'DEC_R1', 'JZ_R', 'JZ_R0', 'JZ_R1', 'JMP_S1', 'JMP_S2'],
      M.states.filter(q => /_SEEK_/.test(q)),
      M.states.filter(q => /_K\d$|_IN$/.test(q)),
      ['INC_C', 'DEC_B', 'ADV_L', 'ADV_R', 'JZ_BACK', 'JZ_SK5', 'JZ_SK4', 'JZ_SK3', 'JZ_SK2', 'JZ_SK1'],
    ];
    const H = 640;
    cols.forEach((col, ci) => col.forEach((q, k) => pos[q] = { x: 40 + ci * 120, y: 30 + (k + 0.5) * (H / col.length) }));
    // RD は二分木
    for (let k = 0; k < 5; k++) for (let v = 0; v < (1 << k); v++) pos['RD_' + k + '_' + v] = { x: 640 + k * 60, y: 30 + (v + 0.5) * (H / (1 << k)) };
    for (let v = 0; v < 32; v++) { pos['GOL_' + v] = { x: 980, y: 30 + (v + 0.5) * H / 32 }; pos['CNT_' + v] = { x: 1090, y: 30 + (v + 0.5) * H / 32 }; }
    this.gpos = pos;
    const E = new Map();
    for (const r of M.rules) if (r.q !== r.q2) E.set(r.q + '>' + r.q2, [r.q, r.q2]);
    this.edges = [...E.values()];
    this.graph.setWorld({ x: 0, y: 0, w: 1140, h: 700 });
  }
  drawGraph() {
    const cv = this.graph, c = cv.begin(true), M = this.M, P = this.gpos, tm = this.app.sim.tm;
    c.fillStyle = '#16181b'; c.fillRect(-2000, -2000, 6000, 6000);
    c.font = '600 10px ' + MONO; c.fillStyle = '#5d6470';
    [['取り出し・解読', 40], ['レジスタ番号', 160], ['オペランドへ', 280], ['レジスタ内', 400], ['ALU・PC+1・分岐', 520], ['分岐先を読む (二分木)', 640], ['左端へ', 980], ['数える', 1090]].forEach(([t, x]) => c.fillText(t, x - 30, 16));
    c.lineWidth = 0.6; c.strokeStyle = 'rgba(120,130,145,.22)';
    c.beginPath();
    for (const [a, b] of this.edges) { const p = P[a], q = P[b]; if (!p || !q) continue; c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); }
    c.stroke();
    // 最近の遷移
    const h = tm.hist;
    for (let k = Math.max(0, h.length - 24); k < h.length; k++) {
      const r = M.rules[h[k].r]; if (r.q === r.q2) continue;
      const p = P[r.q], q = P[r.q2]; if (!p || !q) continue;
      const a = (k - (h.length - 24)) / 24;
      c.strokeStyle = 'rgba(255,207,77,' + a.toFixed(2) + ')'; c.lineWidth = 1 + 2 * a;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    for (const q of M.states) {
      const p = P[q]; if (!p) continue;
      const ph = M.info[q].phase, on = q === tm.q;
      c.beginPath(); c.arc(p.x, p.y, on ? 9 : 4.2, 0, 7);
      c.fillStyle = U.PHCOLOR[ph]; c.globalAlpha = on ? 1 : 0.75;
      if (on) { c.shadowColor = U.PHCOLOR[ph]; c.shadowBlur = 14; }
      c.fill(); c.shadowBlur = 0; c.globalAlpha = 1;
      if (!/^(RD_|GOL_|CNT_)/.test(q) || on) { c.fillStyle = on ? '#fff' : '#9aa3ad'; c.font = (on ? '700 11px ' : '9px ') + MONO; c.fillText(q, p.x + 7, p.y - 5); }
    }
  }
  hoverGraph(p) {
    const P = this.gpos; if (!P) return;
    let best = null, bd = 64;
    for (const q in P) { const d = (P[q].x - p.x) ** 2 + (P[q].y - p.y) ** 2; if (d < bd) { bd = d; best = q; } }
    if (!best) return U.hideTip(this);
    const inf = this.M.info[best];
    const rs = this.M.rules.filter(r => r.q === best);
    U.showTip(p.cx, p.cy, { level: 'tm', title: '状態 ' + best, body: inf.desc + '\n' + CPU.PHASE[inf.phase].name + '（CPU では: ' + CPU.PHASE[inf.phase].cpu + '）\n\n' + rs.map(r => 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')').join('\n') }, this);
  }
  /* ---------- 表 ---------- */
  buildAll() {
    if (this.allBuilt) return;
    const M = this.M;
    this.allTab.innerHTML = '<table><thead><tr><th>#</th><th>q</th><th>読</th><th>q′</th><th>書</th><th>移</th><th>回数</th></tr></thead><tbody>' +
      M.rules.map(r => '<tr data-r="' + r.id + '"><td class="faint">' + r.id + '</td><td><span class="ph-dot" style="background:' + U.PHCOLOR[M.info[r.q].phase] + '"></span>' + r.q + '</td><td>' + U.esc(r.s) + '</td><td>' + r.q2 + '</td><td>' + U.esc(r.w) + '</td><td>' + r.d + '</td><td class="cnt">0</td></tr>').join('') + '</tbody></table>';
    this.allRows = [...this.allTab.querySelectorAll('tbody tr')];
    this.allBuilt = true; this.lastHL = -1; this.lastCountT = 0;
  }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok) { this.info.innerHTML = ''; return; }
    const tm = sim.tm, M = this.M, r = tm.last, nx = tm.rule();
    const inf = M.info[tm.q] || { phase: 'halt', desc: '' };
    const ph = CPU.PHASE[inf.phase];
    this.info.innerHTML =
      '<span>状態 <span class="q">' + tm.q + '</span></span>' +
      '<span><span class="ph-dot" style="background:' + U.PHCOLOR[inf.phase] + '"></span>' + ph.name + ' <span class="dim">≙ ' + ph.cpu + '</span></span>' +
      '<span>直前 <span class="tm-rule">' + (r ? 'δ(' + r.q + ', ' + U.esc(r.s) + ') = (' + r.q2 + ', ' + U.esc(r.w) + ', ' + r.d + ')' : '—') + '</span></span>' +
      '<span class="dim">' + tm.steps.toLocaleString() + ' 歩 · この命令 ' + sim.segDone + '/' + sim.segN + '</span>' +
      (tm.err ? '<span style="color:var(--bad)">' + U.esc(tm.err) + '</span>' : '');
    if (this.lod === 'overview') return;
    // 現在の状態の δ 行
    if (this.lastQ !== tm.q || this.lod === 'detail') {
      const rs = M.rules.filter(x => x.q === tm.q);
      const hist = tm.hist.slice(-14).reverse();
      this.curTab.innerHTML = '<table><thead><tr><th colspan="5">いまの状態 ' + tm.q + ' の遷移（' + U.esc(inf.desc) + '）</th></tr><tr><th>読</th><th>q′</th><th>書</th><th>移</th><th>意味</th></tr></thead><tbody>' +
        rs.map(x => '<tr data-r="' + x.id + '" class="' + (nx && x.id === nx.id ? 'next' : '') + '"><td>' + U.esc(x.s) + '</td><td>' + x.q2 + '</td><td>' + U.esc(x.w) + '</td><td>' + x.d + '</td><td class="note">' + U.esc(x.note) + '</td></tr>').join('') +
        '</tbody></table><table style="margin-top:8px"><thead><tr><th colspan="4">直近の遷移（新しい順）</th></tr></thead><tbody>' +
        hist.map((h, k) => { const x = M.rules[h.r]; return '<tr data-r="' + x.id + '" class="' + (k === 0 ? 'last' : '') + '"><td class="faint">' + h.step + '</td><td>δ(' + x.q + ', ' + U.esc(x.s) + ')</td><td>→ (' + x.q2 + ', ' + U.esc(x.w) + ', ' + x.d + ')</td><td class="note">' + U.esc(x.note) + '</td></tr>'; }).join('') + '</tbody></table>';
      this.lastQ = tm.q;
    }
    if (this.lod === 'full' && this.allRows && r) {
      if (this.lastHL >= 0) this.allRows[this.lastHL].classList.remove('last');
      this.allRows[r.id].classList.add('last'); this.lastHL = r.id;
      const now = performance.now();
      if (now - this.lastCountT > 400) {
        this.lastCountT = now;
        this.allRows.forEach((row, i) => { row.lastChild.textContent = tm.ruleCount[i]; });
        const row = this.allRows[r.id], T = this.allTab;
        if (row.offsetTop < T.scrollTop + 30 || row.offsetTop > T.scrollTop + T.clientHeight - 20) T.scrollTop = row.offsetTop - T.clientHeight / 2;
      }
    }
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const tm = sim.tm, r = tm.last;
    if (!r) { const nx = tm.rule(); return nx ? { level: 'tm', id: 'TM-' + nx.id, title: '次: δ(' + nx.q + ', ' + nx.s + ') = (' + nx.q2 + ', ' + nx.w + ', ' + nx.d + ')', body: nx.note } : null; }
    const inf = this.M.info[r.q];
    return { level: 'tm', id: 'TM-' + r.id, title: 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')', body: r.note + '   [' + CPU.PHASE[inf.phase].name + ' ≙ ' + CPU.PHASE[inf.phase].cpu + ']' };
  }
}
window.TMPanel = TMPanel;
})();
