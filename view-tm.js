/* チューリングマシン パネル
 *   俯瞰: ヘッド周りのテープ + 状態 + 直前の遷移 + 一言解説
 *   詳細: テープ + 「TM のロジック（擬似コード）」+ なぜこの遷移か + 現在状態の δ
 *   全体: テープ全体 + 状態遷移図 + 擬似コード + δ 全表 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';
const SYM = { '^': 'テープ左端', '*': 'PC の印（この直後の命令を実行中）', ':': '命令の区切り', ']': 'プログラムの終わり / レジスタ領域の始まり', '#': 'レジスタの区切り', 'T': '印 T: 操作するレジスタ（r, 書き込み先）', 'S': '印 S: 2 本目のレジスタ（s, 読み出し元）', 'B': '印 B: r と s が同じレジスタ', '!': 'フラグ C の区切り', '$': 'テープ右端の印', '_': '空白', '0': 'ビット 0', '1': 'ビット 1', 'x': '処理済みの 0（筆算の作業印）', 'y': '処理済みの 1（筆算の作業印）' };
const SYMCOL = { '1': '#ffcf4d', '0': '#808893', '*': '#ff6b6b', 'x': '#5fd3c4', 'y': '#7fffd4', 'T': '#c792ea', 'S': '#f07178', 'B': '#ff9cf0' };
const GCOLS = [['fetch', 'dec1', 'halt'], ['markT'], ['markS'], ['dec2'], ['inc', 'dec', 'shr', 'jz', 'jc'], ['addS'], ['addT'], ['flag', 'bpath', 'clean'], ['adv', 'jread'], ['jgol'], ['jcnt']];

class TMPanel {
  constructor(body, app) {
    this.app = app;
    this.lod = 'overview';
    this.tapeCv = new U.CanvasView(body, { onMove: p => this.hoverTape(p), onLeave: () => U.hideTip(this) });
    this.info = U.el('div', 'tm-info'); body.appendChild(this.info);
    this.lower = U.el('div', 'tm-lower'); body.appendChild(this.lower);
    this.graphWrap = U.el('div'); this.graphWrap.style.cssText = 'flex:1.3;display:flex;min-height:0;border-right:1px solid #111';
    this.lower.appendChild(this.graphWrap);
    this.graph = new U.CanvasView(this.graphWrap, { pan: true, hint: '状態遷移図（ドラッグ・ホイール）', onMove: p => this.hoverGraph(p), onLeave: () => U.hideTip(this) });
    this.logic = U.el('div', 'tm-logic'); this.lower.appendChild(this.logic);
    this.curTab = U.el('div', 'dtab'); this.curTab.style.flex = '1'; this.lower.appendChild(this.curTab);
    this.allTab = U.el('div', 'dtab'); this.allTab.style.flex = '1'; this.allTab.style.borderLeft = '1px solid #111'; this.lower.appendChild(this.allTab);
    this.camX = 0;
    for (const t of [this.allTab, this.curTab]) {
      t.addEventListener('mousemove', e => { const tr = e.target.closest('tr[data-r]'); if (!tr) return U.hideTip(this); U.showTip(e.clientX, e.clientY, 'TM-' + tr.dataset.r, this); });
      t.addEventListener('mouseleave', () => U.hideTip(this));
    }
  }
  load(prog) { this.prog = prog; this.M = CPU.TM.machine || CPU.buildTM(); if (!CPU.TM.machine) CPU.TM.machine = this.M; this.allBuilt = false; this.layoutGraph(); this.lastQ = null; }
  setLOD(l) {
    this.lod = l;
    this.lower.hidden = l === 'overview';
    this.graphWrap.hidden = l !== 'full';
    this.allTab.hidden = l !== 'full';
    this.tapeCv.wrap.style.flex = l === 'full' ? '0 0 260px' : l === 'detail' ? '0 0 150px' : '1 1 100px';
    if (l === 'full') this.buildAll();
    this.lastQ = null; this.lastLine = null; this.logicKey = null;
    this.update();
  }
  /* ---------- テープ ---------- */
  region(tm, i) {
    if (i === 0) return { k: 'end' };
    if (i < tm.progEnd) { const ins = Math.floor((i - 1) / 17), f = (i - 1) % 17; return { k: 'ins', ins, f }; }
    if (i === tm.progEnd) return { k: 'pend' };
    for (let r = 0; r < CPU.NREG; r++) { const s = tm.regStart[r]; if (i === s - 1) return { k: 'sep', r }; if (i >= s && i < s + 8) return { k: 'reg', r, bit: 7 - (i - s) }; }
    if (i === tm.flagPos) return { k: 'flag' };
    return { k: 'other' };
  }
  regVal(tm, r) { let v = 0; const s = tm.regStart[r]; for (let i = 0; i < 8; i++) { const c = tm.sym(s + i); v = v * 2 + (c === '1' || c === 'y' ? 1 : 0); } return v; }
  frame() {
    if (!this.app.sim || !this.prog || !this.prog.ok) return;
    if (this.tapeCv.visible()) this.drawTape();
    if (this.lod === 'full' && this.graph.visible()) this.drawGraph();
  }
  drawTape() {
    const cv = this.tapeCv, tm = this.app.sim.tm, c = cv.begin(false);
    const W = cv.w, H = cv.h;
    c.fillStyle = '#16181b'; c.fillRect(0, 0, W, H);
    if (this.lod === 'full') return this.drawTapeWrapped(c, W, H, tm);
    const cw = this.lod === 'detail' ? 24 : Math.max(16, Math.min(26, H / 4.2)), ch = cw * 1.25;
    const y0 = Math.max(36, (H - ch) / 2 - 4);
    const target = tm.head * cw - W / 2 + cw / 2;
    this.camX += (target - this.camX) * (this.app.running ? 0.25 : 1);
    if (Math.abs(target - this.camX) > W) this.camX = target;
    const n = tm.tape.length;
    const i0 = Math.max(0, Math.floor(this.camX / cw) - 1), i1 = Math.min(n, Math.ceil((this.camX + W) / cw) + 1);
    this.cellGeom = { cw, ch, y0, camX: this.camX };
    for (let i = i0; i < i1; i++) this.drawCell(c, tm, i, i * cw - this.camX, y0, cw, ch);
    c.font = '10.5px ' + MONO;
    for (let k = 0; k * 17 + 1 < tm.progEnd; k++) {
      const s = 1 + k * 17, x = s * cw - this.camX;
      if (x > W || x + 17 * cw < 0) continue;
      let w = 0; for (let j = 1; j <= 16; j++) w = w * 2 + (tm.sym(s + j) === '1' ? 1 : 0);
      c.fillStyle = tm.sym(s) === '*' ? '#ffcf4d' : '#7d8590';
      c.fillText('[' + k + '] ' + CPU.disasm(w), x + 3, y0 + ch + 15);
    }
    CPU.REGN.forEach((r, k) => {
      const s = tm.regStart[k], x = (s - 1) * cw - this.camX;
      if (x > W || x + 9 * cw < 0) return;
      const sep = tm.sym(s - 1);
      c.fillStyle = sep === 'T' ? '#c792ea' : sep === 'S' ? '#f07178' : sep === 'B' ? '#ff9cf0' : '#9cdcfe';
      c.fillText(r + ' = ' + this.regVal(tm, k) + (sep !== '#' ? '  (' + sep + ')' : ''), x + 3, y0 + ch + 15);
    });
    { const x = (tm.flagPos - 1) * cw - this.camX; if (x < W && x > -2 * cw) { c.fillStyle = '#ff9e64'; c.fillText('C = ' + tm.flagC(), x + 3, y0 + ch + 15); } }
    const q = tm.q, inf = this.M.info[q], ph = inf ? inf.phase : 'halt';
    const hx = tm.head * cw - this.camX;
    c.fillStyle = U.PHCOLOR[ph]; c.beginPath(); c.moveTo(hx + cw / 2, y0 - 3); c.lineTo(hx + cw / 2 - 7, y0 - 13); c.lineTo(hx + cw / 2 + 7, y0 - 13); c.fill();
    c.strokeStyle = U.PHCOLOR[ph]; c.lineWidth = 2.5; c.strokeRect(hx + 1, y0 + 1, cw - 2, ch - 2);
    c.font = '600 12px ' + MONO; c.textAlign = 'center';
    const lbl = q + '  ·  ' + CPU.PHASE[ph].name;
    const lw = c.measureText(lbl).width + 14, lx = Math.max(lw / 2 + 2, Math.min(W - lw / 2 - 2, hx + cw / 2));
    c.fillStyle = '#26282c'; U.rr(c, lx - lw / 2, y0 - 33, lw, 18, 3); c.fill();
    c.fillStyle = U.PHCOLOR[ph]; c.fillText(lbl, lx, y0 - 20); c.textAlign = 'left';
  }
  drawCell(c, tm, i, x, y, cw, ch, small) {
    const s = tm.sym(i), rg = this.region(tm, i);
    let bg = '#1e2024';
    if (rg.k === 'ins') bg = rg.f === 0 ? '#25272b' : rg.f <= 4 ? 'rgba(232,163,106,.13)' : rg.f <= 7 ? 'rgba(199,146,234,.13)' : rg.f <= 10 ? 'rgba(240,113,120,.11)' : 'rgba(95,211,196,.11)';
    else if (rg.k === 'reg') bg = rg.r % 2 ? 'rgba(156,220,254,.07)' : 'rgba(156,220,254,.13)';
    else if (rg.k === 'flag') bg = 'rgba(255,158,100,.16)';
    c.fillStyle = bg; c.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    if (s === 'T' || s === 'S' || s === 'B') { c.fillStyle = 'rgba(199,146,234,.25)'; c.fillRect(x, y, cw, ch); }
    c.strokeStyle = '#30343a'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    c.fillStyle = SYMCOL[s] || '#c5c8ce';
    c.font = (s === '1' || s === '*' || s === 'T' || s === 'S' || s === 'B' ? '700 ' : '') + Math.round(cw * 0.6) + 'px ' + MONO;
    c.textAlign = 'center'; c.fillText(s, x + cw / 2, y + ch * 0.68); c.textAlign = 'left';
    if (!small && cw > 18 && i % 10 === 0) { c.fillStyle = '#4d535c'; c.font = '9px ' + MONO; c.fillText(i, x + 2, y - 3); }
  }
  drawTapeWrapped(c, W, H, tm) {
    const n = tm.tape.length;
    let cw = 18, per = Math.floor((W - 20) / cw), rows = Math.ceil(n / per);
    while (rows * (cw * 1.25 + 10) + 30 > H && cw > 9) { cw--; per = Math.floor((W - 20) / cw); rows = Math.ceil(n / per); }
    const ch = cw * 1.25, rowsH = ch + 10;
    this.cellGeom = { wrapped: true, cw, ch, per, rowsH };
    for (let i = 0; i < n; i++) {
      const x = 10 + (i % per) * cw, y = 26 + Math.floor(i / per) * rowsH;
      this.drawCell(c, tm, i, x, y, cw, ch, true);
      if (i === tm.head) { const ph = this.M.info[tm.q] ? this.M.info[tm.q].phase : 'halt'; c.strokeStyle = U.PHCOLOR[ph]; c.lineWidth = 2.5; c.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
    }
    c.fillStyle = '#7d8590'; c.font = '11px ' + MONO;
    c.fillText('テープ全体 ' + n + ' マス（命令 ' + this.prog.words.length + ' 個 × 17 マス + レジスタ 8 × 9 マス + C）   ヘッド ' + tm.head + '   状態 ' + tm.q, 10, 16);
  }
  hoverTape(p) {
    const tm = this.app.sim && this.app.sim.tm, g = this.cellGeom; if (!tm || !g) return;
    let i;
    if (g.wrapped) { const r = Math.floor((p.sy - 26) / g.rowsH), col = Math.floor((p.sx - 10) / g.cw); if (col < 0 || col >= g.per || r < 0) return U.hideTip(this); i = r * g.per + col; }
    else { if (p.sy < g.y0 || p.sy > g.y0 + g.ch) return U.hideTip(this); i = Math.floor((p.sx + g.camX) / g.cw); }
    if (i < 0 || i >= tm.tape.length) return U.hideTip(this);
    const rg = this.region(tm, i), s = tm.sym(i);
    let where = '';
    if (rg.k === 'ins') where = '命令 [' + rg.ins + '] の ' + (rg.f === 0 ? '区切り' : rg.f <= 4 ? 'op bit' + (16 - rg.f) : rg.f <= 7 ? 'r bit' + (16 - rg.f) : rg.f <= 10 ? 's bit' + (16 - rg.f) : 'aaaaaa bit' + (16 - rg.f));
    else if (rg.k === 'reg') where = 'レジスタ ' + CPU.REGN[rg.r] + ' の bit' + rg.bit + '（2^' + rg.bit + ' の位）';
    else if (rg.k === 'sep') where = 'レジスタ ' + CPU.REGN[rg.r] + ' の直前の区切り';
    else if (rg.k === 'flag') where = 'フラグ C';
    U.showTip(p.cx, p.cy, { level: 'tm', id: 'TM-TAPE', title: 'マス ' + i + ' : 「' + s + '」', body: SYM[s] + (where ? '\n' + where : '') + '\n\n' + U.def('TM-TAPE').body, value: i === tm.head ? 'ヘッドがここにある。次の遷移 δ(' + tm.q + ', ' + s + ')' : '' }, this);
  }
  /* ---------- 状態遷移図 ---------- */
  layoutGraph() {
    if (this.gpos) return;
    const M = this.M, pos = {};
    const colOf = {}; GCOLS.forEach((ls, ci) => ls.forEach(l => colOf[l] = ci));
    const cols = GCOLS.map(() => []);
    M.states.forEach(q => cols[colOf[M.info[q].line]].push(q));
    const H = 760;
    cols.forEach((col, ci) => {
      const n = col.length, sub = n > 48 ? 2 : 1, per = Math.ceil(n / sub);
      col.forEach((q, k) => { const sc = Math.floor(k / per), r = k % per; pos[q] = { x: 40 + ci * 110 + sc * 34, y: 40 + (r + 0.5) * (H / per) }; });
    });
    this.gpos = pos;
    const E = new Map();
    for (const r of M.rules) if (r.q !== r.q2) E.set(r.q + '>' + r.q2, [r.q, r.q2]);
    this.edges = [...E.values()];
    this.graph.setWorld({ x: 0, y: 0, w: 40 + GCOLS.length * 110, h: 820 });
  }
  drawGraph() {
    const cv = this.graph, c = cv.begin(true), M = this.M, P = this.gpos, tm = this.app.sim.tm;
    c.fillStyle = '#16181b'; c.fillRect(-4000, -4000, 9000, 9000);
    c.font = '600 10px ' + MONO; c.fillStyle = '#5d6470';
    const titles = ['取出・解読1', 'T の印', 'S の印', '解読2', 'INC DEC SHR 判定', '筆算: S', '筆算: T', 'C・B・片付け', 'PC+1・分岐読', '左端へ', '数える'];
    titles.forEach((t, i) => c.fillText(t, 20 + i * 110, 20));
    c.lineWidth = 0.5; c.strokeStyle = 'rgba(120,130,145,.18)';
    c.beginPath();
    for (const [a, b] of this.edges) { const p = P[a], q = P[b]; c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); }
    c.stroke();
    const h = tm.hist, nh = h.length / 2;
    for (let k = Math.max(0, nh - 30); k < nh; k++) {
      const r = M.rules[h[k * 2]]; if (r.q === r.q2) continue;
      const p = P[r.q], q = P[r.q2], a = (k - (nh - 30)) / 30;
      c.strokeStyle = 'rgba(255,207,77,' + Math.max(0.05, a).toFixed(2) + ')'; c.lineWidth = 1 + 2 * a;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    for (const q of M.states) {
      const p = P[q], ph = M.info[q].phase, on = q === tm.q;
      c.beginPath(); c.arc(p.x, p.y, on ? 9 : 3.6, 0, 7);
      c.fillStyle = U.PHCOLOR[ph]; c.globalAlpha = on ? 1 : 0.75;
      if (on) { c.shadowColor = U.PHCOLOR[ph]; c.shadowBlur = 14; }
      c.fill(); c.shadowBlur = 0; c.globalAlpha = 1;
      if (on) { c.fillStyle = '#fff'; c.font = '700 12px ' + MONO; c.fillText(q, p.x + 10, p.y - 6); }
    }
  }
  hoverGraph(p) {
    const P = this.gpos; if (!P) return;
    let best = null, bd = 49;
    for (const q in P) { const d = (P[q].x - p.x) ** 2 + (P[q].y - p.y) ** 2; if (d < bd) { bd = d; best = q; } }
    if (!best) return U.hideTip(this);
    const inf = this.M.info[best], L = CPU.TM_CODE.find(x => x.id === inf.line);
    const rs = this.M.rules.filter(r => r.q === best);
    U.showTip(p.cx, p.cy, { level: 'tm', title: '状態 ' + best, body: inf.desc + '\n擬似コード: ' + L.text.trim() + '\n\n' + rs.slice(0, 10).map(r => 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')  ' + r.note).join('\n') + (rs.length > 10 ? '\n…' : '') }, this);
  }
  /* ---------- ロジック解説 ---------- */
  why(tm) {
    const r = tm.last, nx = tm.rule(), M = this.M;
    const inf = M.info[tm.q] || { line: 'halt', desc: '' };
    const L = CPU.TM_CODE.find(x => x.id === inf.line);
    return { r, nx, inf, L };
  }
  renderLogic() {
    const tm = this.app.sim.tm, { r, nx, inf, L } = this.why(tm);
    const code = CPU.TM_CODE.map(l => '<div class="tl-line' + (l.id === inf.line ? ' on' : '') + '" data-l="' + l.id + '"><span class="ph-dot" style="background:' + U.PHCOLOR[l.ph] + '"></span>' + U.esc(l.text) + '</div>').join('');
    const rq = r ? this.M.info[r.q] : null;
    const box = '<div class="tl-why"><div class="tl-h">なぜこの遷移？</div>' +
      (r ? '<div class="tl-rule">直前: δ(' + r.q + ', <b>' + U.esc(r.s) + '</b>) = (' + r.q2 + ', <b>' + U.esc(r.w) + '</b>, ' + r.d + ')</div>' +
        '<div class="tl-p"><span class="dim">状態 ' + r.q + ' は</span> ' + U.esc(rq.desc) + '。<br><span class="dim">ヘッドの下が「' + U.esc(r.s) + '」だったので</span> ' + U.esc(r.note) + (r.s !== r.w ? '（「' + U.esc(r.w) + '」を書いた）' : '') + '。</div>' : '<div class="tl-p dim">まだ 1 歩も進んでいません。</div>') +
      (nx ? '<div class="tl-rule next">次: δ(' + nx.q + ', ' + U.esc(nx.s) + ') = (' + nx.q2 + ', ' + U.esc(nx.w) + ', ' + nx.d + ') — ' + U.esc(nx.note) + '</div>' : '') +
      '<div class="tl-h">この段階のねらい</div><div class="tl-p">' + U.esc(L.why) + '</div>' +
      '<div class="tl-p dim">CPU では: ' + U.esc(CPU.PHASE[inf.phase].cpu) + '</div></div>';
    const key = (r ? r.id : -1) + '|' + (nx ? nx.id : -1);
    if (this.logicKey === key) return;
    this.logicKey = key;
    if (!this.codeEl) {
      this.logic.innerHTML = '<div class="tl-h" style="padding:6px 10px 2px">TM のロジック（擬似コード ⇔ 状態）</div><div class="tl-code">' + code + '</div><div class="tl-box"></div>';
      this.codeEl = this.logic.querySelector('.tl-code'); this.boxEl = this.logic.querySelector('.tl-box');
      this.bindLogic();
    }
    if (this.curLine !== inf.line) { this.codeEl.querySelectorAll('.tl-line').forEach(e => e.classList.toggle('on', e.dataset.l === inf.line)); this.curLine = inf.line; }
    this.boxEl.innerHTML = box;
  }
  bindLogic() {
    this.logic.querySelectorAll('[data-l]').forEach(e => {
      e.onmousemove = ev => { const l = CPU.TM_CODE.find(x => x.id === e.dataset.l); const qs = this.M.states.filter(q => this.M.info[q].line === l.id); U.showTip(ev.clientX, ev.clientY, { level: 'tm', title: l.text.trim(), body: l.why + '\n\nこの行の状態（' + qs.length + ' 個）: ' + qs.slice(0, 24).join(', ') + (qs.length > 24 ? ' …' : '') }, this); };
      e.onmouseleave = () => U.hideTip(this);
    });
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
    const tm = sim.tm, M = this.M, r = tm.last;
    const { inf, L } = this.why(tm);
    const ph = CPU.PHASE[inf.phase];
    this.info.innerHTML =
      '<span>状態 <span class="q">' + tm.q + '</span></span>' +
      '<span><span class="ph-dot" style="background:' + U.PHCOLOR[inf.phase] + '"></span>' + ph.name + ' <span class="dim">≙ ' + ph.cpu + '</span></span>' +
      '<span>直前 <span class="tm-rule">' + (r ? 'δ(' + r.q + ', ' + U.esc(r.s) + ') = (' + r.q2 + ', ' + U.esc(r.w) + ', ' + r.d + ')' : '—') + '</span>' + (r ? ' <span class="dim">' + U.esc(r.note) + '</span>' : '') + '</span>' +
      '<span class="dim">' + tm.steps.toLocaleString() + ' 歩 · この命令 ' + sim.segDone + '/' + sim.segN + '</span>' +
      (this.lod === 'overview' ? '<span class="tm-line">▸ ' + U.esc(L.text.trim()) + '</span>' : '') +
      (tm.err ? '<span style="color:var(--bad)">' + U.esc(tm.err) + '</span>' : '');
    if (this.lod === 'overview') return;
    this.renderLogic();
    if (this.lastQ !== tm.q || this.lod === 'detail') {
      const nx = tm.rule();
      const rs = M.rules.filter(x => x.q === tm.q);
      const hist = []; for (let k = tm.hist.length - 2; k >= 0 && hist.length < 14; k -= 2) hist.push({ r: tm.hist[k], step: tm.hist[k + 1] });
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
        const T0 = this.allTab, rh = 17, a0 = Math.max(0, Math.floor(T0.scrollTop / rh) - 5), a1 = Math.min(this.allRows.length, a0 + Math.ceil(T0.clientHeight / rh) + 10);
        for (let i = a0; i < a1; i++) { const t = String(tm.ruleCount[i]); const cell = this.allRows[i].lastChild; if (cell.textContent !== t) cell.textContent = t; }
        const row = this.allRows[r.id], T = this.allTab;
        if (row.offsetTop < T.scrollTop + 30 || row.offsetTop > T.scrollTop + T.clientHeight - 20) T.scrollTop = row.offsetTop - T.clientHeight / 2;
      }
    }
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const tm = sim.tm, r = tm.last;
    const { inf, L } = this.why(tm);
    if (!r) { const nx = tm.rule(); return nx ? { level: 'tm', id: 'TM-' + nx.id, title: '次: δ(' + nx.q + ', ' + nx.s + ') = (' + nx.q2 + ', ' + nx.w + ', ' + nx.d + ')', body: nx.note } : null; }
    return { level: 'tm', id: 'TM-' + r.id, title: 'δ(' + r.q + ', ' + r.s + ') = (' + r.q2 + ', ' + r.w + ', ' + r.d + ')', body: r.note + '\n▸ ' + L.text.trim() + '   [' + CPU.PHASE[inf.phase].name + ' ≙ ' + CPU.PHASE[inf.phase].cpu + ']' };
  }
}
window.TMPanel = TMPanel;
})();
