/* 回路パネル
 *   俯瞰: 基板（チップ + 銅箔のバス + 2 進数）
 *   詳細: 選んだブロックのゲート回路図
 *   全体: 全ブロックのゲート回路図（ネットラベルで接続, 高負荷）
 * 表示する値はすべてゲートのネットリスト評価 (Circuit.settle) の結果。 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const COL = {
  board: '#0f2a20', board2: '#12322a', silk: '#cfe8d8', silkDim: '#6f9784',
  cu0: '#5c4a22', cu1: '#ffcf4d', cuFront: '#ffffff',
  chip: '#121614', chipEdge: '#3f4b44', pin: '#9aa59f',
  led1: '#ffcf4d', led0: '#26352d', ctl1: '#4ec9b0', ctl0: '#1f3a33',
  sch: '#17191c', wire0: '#3b4652', wire1: '#ffcf4d', gate: '#c8ced6', gateFill: '#1d2025', hot: '#7fd4ff',
  op: '#e8a36a', rr: '#c792ea', ad: '#5fd3c4',
};
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';

/* ------------------------------------------------------------------ */
/*  回路図の自動配置                                                      */
/* ------------------------------------------------------------------ */
const GW = 34, COLW = 92, PORTW = 70, RH = 25;
const num = (s, re) => { const m = s.match(re); return m ? m.slice(1).map(x => isNaN(+x) ? x : +x) : null; };
const RI = r => 'abcd'.indexOf(r);
const HINTS = {
  alu: n => {
    let m;
    if ((m = num(n, /^p(\d)$/))) return { col: 0, row: m[0] * 2 };
    if ((m = num(n, /^g(\d)$/))) return { col: 0, row: m[0] * 2 + 1 };
    if ((m = num(n, /^Y(\d)$/))) return { col: 1, row: m[0] * 2 };
    if ((m = num(n, /^h(\d)$/))) return { col: 1, row: m[0] * 2 + 1 };
    if ((m = num(n, /^c(\d)$/))) return { col: 2, row: (m[0] - 1) * 2 + 1.5 };
    if (n === 'ONE') return { col: 0, row: 16.4 };
    if (n === 'ZERO_C') return { col: 0, row: 17.4 };
  },
  pcinc: n => { let m; if ((m = num(n, /^P(\d)$/))) return { col: 0, row: m[0] * 2 }; if ((m = num(n, /^k(\d)$/))) return { col: 1, row: m[0] * 2 - 0.5 }; },
  pcmux: n => {
    let m;
    if ((m = num(n, /^ba(\d)$/))) return { col: 0, row: m[0] * 3 };
    if ((m = num(n, /^bp(\d)$/))) return { col: 0, row: m[0] * 3 + 1 };
    if ((m = num(n, /^M(\d)$/))) return { col: 1, row: m[0] * 3 + 0.5 };
    if ((m = num(n, /^hp(\d)$/))) return { col: 2, row: m[0] * 3 + 1.5 };
    if ((m = num(n, /^hm(\d)$/))) return { col: 2, row: m[0] * 3 + 0.5 };
    if ((m = num(n, /^NPC(\d)$/))) return { col: 3, row: m[0] * 3 + 1 };
  },
  rmux: n => {
    let m;
    if ((m = num(n, /^m([abcd])(\d)$/))) return { col: 0, row: m[1] * 4.5 + RI(m[0]) };
    if ((m = num(n, /^X(\d)$/))) return { col: 1, row: m[0] * 4.5 + 1.5 };
  },
  regs: n => {
    let m;
    const G = r => ({ cb: 1 + (RI(r) % 2) * 5, rb: Math.floor(RI(r) / 2) * 18 });
    if (n === 'WE') return { col: 0, row: 0 };
    if ((m = num(n, /^WE([abcd])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 0.5 }; }
    if ((m = num(n, /^nWE([abcd])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 2 }; }
    if ((m = num(n, /^wy([abcd])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (7 - m[1]) }; }
    if ((m = num(n, /^wk([abcd])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (7 - m[1]) + 1 }; }
    if ((m = num(n, /^D([abcd])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 2, row: g.rb + 2 * (7 - m[1]) + 0.5 }; }
    if ((m = num(n, /^R([abcd])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 3, row: g.rb + 2 * (7 - m[1]) + 0.5 }; }
  },
};
function gateSize(g) {
  if (g.type === 'DFF') return { w: 40, h: 30 };
  if (g.type.startsWith('CONST')) return { w: 22, h: 16 };
  const n = g.ins.length;
  return { w: n > 4 ? 30 : GW, h: Math.max(22, n * 8 + 6) };
}
function layoutBlock(C, bid) {
  const gs = C.gates.filter(g => g.block === bid && g.type !== 'ROM');
  const inB = new Set(gs.map(g => g.id));
  const drv = n => C.nets[n].driver;
  const internal = n => { const d = drv(n); return d >= 0 && inB.has(d) && C.gates[d].type !== 'DFF'; };
  const lvl = {};
  const order = C.order.filter(id => inB.has(id)).concat(gs.filter(g => g.type === 'DFF').map(g => g.id));
  let maxL = 0;
  for (const id of order) { const g = C.gates[id]; let L = 0; for (const n of g.ins) if (internal(n)) L = Math.max(L, lvl[drv(n)] + 1); lvl[id] = L; maxL = Math.max(maxL, L); }
  const ports = [], pIdx = {};
  for (const g of gs) for (const n of g.ins) if (!internal(n) && pIdx[n] == null) { pIdx[n] = ports.length; ports.push({ net: n, y: 0 }); }
  ports.forEach((p, i) => p.y = 18 + i * 17);
  const pos = {};
  const outY = id => pos[id].y + pos[id].h / 2;
  const hint = HINTS[bid];
  if (hint) {
    // ビットごとに行をそろえた配置（加算器・MUX など）
    let maxC = 0;
    for (const g of gs) {
      const h = hint(C.nets[g.out].name, g) || { col: 0, row: 0 };
      const sz = gateSize(g);
      pos[g.id] = { x: PORTW + 40 + h.col * COLW, y: 12 + h.row * RH - sz.h / 2 + 11, w: sz.w, h: sz.h };
      maxC = Math.max(maxC, h.col);
    }
    // 入力ポートは使う側の高さの平均に寄せる
    const want = ports.map(p => {
      let s = 0, k = 0;
      for (const g of gs) g.ins.forEach((n, j) => { if (n === p.net) { s += pos[g.id].y + (j + 1) * pos[g.id].h / (g.ins.length + 1); k++; } });
      return { p, y: k ? s / k : 0 };
    }).sort((a, b) => a.y - b.y);
    let last = -1e9;
    for (const e of want) { e.p.y = Math.max(e.y, last + 17, 10); last = e.p.y; }
    maxL = maxC;
  } else for (let L = 0; L <= maxL; L++) {
    const col = order.filter(id => lvl[id] === L).map(id => {
      const g = C.gates[id];
      const ys = g.ins.map(n => internal(n) ? outY(drv(n)) : ports[pIdx[n]].y);
      const want = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 18;
      return { id, want, sz: gateSize(g) };
    }).sort((a, b) => a.want - b.want);
    let bottom = 0;
    for (const e of col) {
      let y = e.want - e.sz.h / 2;
      if (y < bottom + 6) y = bottom + 6;
      pos[e.id] = { x: PORTW + 30 + L * COLW, y, w: e.sz.w, h: e.sz.h };
      bottom = y + e.sz.h;
    }
  }
  // ブロックの外で使われる出力
  const usedOut = new Set();
  for (const g of C.gates) if (!inB.has(g.id)) for (const n of g.ins) { const d = drv(n); if (d >= 0 && inB.has(d)) usedOut.add(n); }
  let w = PORTW + 30 + (maxL + 1) * COLW + 60, h = 0;
  for (const p of ports) h = Math.max(h, p.y + 12);
  for (const id in pos) h = Math.max(h, pos[id].y + pos[id].h + 10);
  return { bid, gs, pos, ports, pIdx, internal, usedOut, w, h };
}
function romLayout() { return { bid: 'rom', w: 560, h: 520, rom: true }; }

/* ------------------------------------------------------------------ */
class CircuitPanel {
  constructor(body, app) {
    this.app = app;
    this.lod = 'overview';
    this.block = 'alu';
    this.bar = U.el('div', 'bar');
    this.chips = U.el('div', 'chips');
    this.bar.appendChild(this.chips);
    body.appendChild(this.bar);
    CPU.BLOCKS.forEach(b => {
      const c = U.el('button', 'chip', U.esc(b.name)); c.dataset.b = b.id; c.title = b.desc;
      c.onclick = () => { this.block = b.id; this.applyWorld(); this.paintChips(); };
      this.chips.appendChild(c);
    });
    this.info = U.el('span', 'mono dim'); this.bar.appendChild(this.info);
    this.cv = new U.CanvasView(body, { pan: true, hint: 'ドラッグで移動・ホイールで拡大・ダブルクリックで全体', onMove: p => this.hover(p), onLeave: () => { this.hot = null; U.hideTip(this); }, onClick: p => this.click(p) });
    this.C = null;
    this.hot = null;
  }
  ensure() {
    if (this.C) return;
    this.C = CPU.Circuit.netlist || CPU.buildCircuit();
    if (!CPU.Circuit.netlist) CPU.Circuit.netlist = this.C;
    this.N = this.C.byName;
    this.L = {};
    CPU.BLOCKS.forEach(b => this.L[b.id] = b.id === 'rom' ? romLayout() : layoutBlock(this.C, b.id));
    // 全体配置: データの流れに沿って 4 列
    const cols = [['pc', 'pcinc', 'pcmux', 'br'], ['rom', 'dec', 'rsel', 'zero'], ['rmux'], ['alu'], ['regs']];
    let x = 0; this.full = {};
    let H = 0;
    for (const col of cols) {
      let y = 0, cw = 0;
      for (const b of col) { const l = this.L[b]; this.full[b] = { x, y: y + 34 }; y += l.h + 34 + 50; cw = Math.max(cw, l.w); }
      x += cw + 70; H = Math.max(H, y);
    }
    this.fullBounds = { x: -20, y: -20, w: x, h: H + 20 };
  }
  load(prog) { this.prog = prog; this.ensure(); this.applyWorld(); }
  setLOD(l) { this.lod = l; this.bar.hidden = l !== 'detail'; this.applyWorld(); this.paintChips(); }
  paintChips() { [...this.chips.children].forEach(c => c.classList.toggle('on', c.dataset.b === this.block)); }
  applyWorld() {
    if (!this.C) return;
    if (this.lod === 'overview') this.cv.setWorld({ x: 0, y: 0, w: 1200, h: 720 });
    else if (this.lod === 'detail') { const l = this.L[this.block]; this.cv.setWorld({ x: -10, y: -40, w: l.w + 20, h: l.h + 50 }); }
    else this.cv.setWorld(this.fullBounds);
  }
  focusBlock(b) { this.block = b; this.paintChips(); this.applyWorld(); }
  // ---- 値（伝搬の波面で新旧を切り替える） ----
  prep() {
    const sim = this.app.sim, ck = sim.ck;
    this.cur = ck.v; this.prv = ck.prev;
    const max = this.C.maxDepth;
    const still = !this.app.running && sim.p === 0;
    this.wave = still || sim.halted ? max + 1 : Math.min(max + 1, sim.p / 0.85 * (max + 1));
    this.clk = !sim.halted && sim.p > 0.9;
    this.dep = this.C.depth;
  }
  dv(n) { return this.dep[n] <= this.wave ? this.cur[n] : this.prv[n]; }
  front(n) { const d = this.dep[n]; return d > this.wave - 1.2 && d <= this.wave && this.cur[n] !== this.prv[n]; }
  V(name) { return this.dv(this.N[name]); }
  busv(prefix, n) { let x = 0; for (let i = 0; i < n; i++) x |= this.V(prefix + i) << i; return x; }

  frame() {
    if (!this.cv.visible() || !this.app.sim || !this.prog || !this.prog.ok) return;
    this.prep();
    const c = this.cv.begin(true);
    if (this.lod === 'overview') this.drawBoard(c);
    else if (this.lod === 'detail') { this.drawSchBg(c, { x: -10, y: -40, w: this.L[this.block].w + 20, h: this.L[this.block].h + 50 }); this.drawBlock(c, this.block, 0, 0, true); }
    else {
      const b = this.fullBounds; this.drawSchBg(c, b);
      for (const id in this.full) this.drawBlock(c, id, this.full[id].x, this.full[id].y, true);
    }
    const sim = this.app.sim;
    this.info.textContent = '伝搬 ' + Math.min(this.C.maxDepth, Math.floor(this.wave)) + '/' + this.C.maxDepth + ' 段  ·  クロック ' + sim.ck.cycles;
  }

  /* ---------------- 基板（俯瞰） ---------------- */
  drawBoard(c) {
    c.fillStyle = COL.board; c.fillRect(0, 0, 1200, 720);
    if (!this.pat) {
      const p = document.createElement('canvas'); p.width = p.height = 24; const pc = p.getContext('2d');
      pc.fillStyle = COL.board2; pc.beginPath(); pc.arc(12, 12, 1.6, 0, 7); pc.fill(); this.pat = c.createPattern(p, 'repeat');
    }
    c.fillStyle = this.pat; c.fillRect(0, 0, 1200, 720);
    c.strokeStyle = '#2b5a46'; c.lineWidth = 2; U.rr(c, 2, 2, 1196, 716, 10); c.stroke();
    c.fillStyle = COL.silkDim; c.font = '600 11px ' + MONO; c.textAlign = 'right'; c.fillText('CPU⁵  REV.A  8bit 単一サイクル', 1188, 712); c.textAlign = 'left';
    this.hits = [];
    const B = (pts, nets, label, lp) => this.bus(c, pts, nets.map(n => this.N[n]), label, lp);
    const range = (p, a, b) => { const r = []; for (let i = a; i >= b; i--) r.push(p + i); return r; };
    // バス
    const PCn = range('PC', 4, 0);
    B([[170, 140], [210, 140]], PCn);
    B([[190, 140], [190, 495], [95, 495], [95, 520]], PCn, () => 'PC ' + CPU.bin(this.busv('PC', 5), 5), [190, 320]);
    B([[190, 495], [320, 495], [320, 520]], PCn);
    B([[590, 70], [640, 70]], ['I9', 'I8', 'I7'], () => 'op ' + CPU.bin(this.busv('I', 10) >> 7, 3), [598, 54]);
    B([[590, 242], [640, 242]], ['I6', 'I5'], () => 'rr ' + CPU.bin((this.busv('I', 10) >> 5) & 3, 2), [598, 226]);
    B([[480, 460], [480, 520]], range('I', 4, 0), () => 'aaaaa ' + CPU.bin(this.busv('I', 5), 5), [492, 494]);
    const CT = ['isHALT', 'isINC', 'isDEC', 'isJZ', 'isJMP', 'isBAD'];
    B([[830, 110], [856, 110], [856, 540], [830, 540]], CT);
    B([[856, 150], [880, 150]], ['isINC', 'isDEC']);
    B([[856, 470], [880, 470]], ['isDEC']);
    B([[830, 242], [880, 242]], ['S0', 'S1', 'S2', 'S3']);
    B([[868, 242], [868, 316], [880, 316]], ['S0', 'S1', 'S2', 'S3']);
    CPU.REGN.forEach((r, k) => B([[915 + k * 70, 270], [915 + k * 70, 292]], range('R' + r, 7, 0)));
    const Xn = range('X', 7, 0);
    B([[1030, 340], [1030, 380]], Xn, () => 'X ' + CPU.bin(this.busv('X', 8), 8), [1046, 352]);
    B([[1030, 360], [860, 360], [860, 415], [830, 415]], Xn);
    B([[1180, 465], [1193, 465], [1193, 160], [1180, 160]], range('Y', 7, 0), () => 'Y ' + CPU.bin(this.busv('Y', 8), 8), [1092, 300]);
    B([[735, 450], [735, 480]], ['Z']);
    B([[640, 555], [590, 555]], ['BR', 'HOLD']);
    B([[615, 560], [615, 706], [5, 706], [5, 238], [20, 238]], ['HOLD']);
    B([[170, 565], [210, 565]], range('P', 4, 0));
    B([[400, 640], [400, 672], [12, 672], [12, 150], [20, 150]], range('NPC', 4, 0), () => 'NPC ' + CPU.bin(this.busv('NPC', 5), 5), [40, 662]);

    // チップ
    this.drawClk(c, 20, 20, 150, 50);
    this.drawPC(c, 20, 90, 150, 100);
    this.drawHalted(c, 20, 210, 150, 56);
    this.drawROM(c, 210, 20, 380, 440);
    this.drawDec(c, 640, 20, 190, 160);
    this.drawRsel(c, 640, 200, 190, 84);
    this.drawRegs(c, 880, 20, 300, 250);
    this.drawRmux(c, 880, 292, 300, 48);
    this.drawALU(c, 880, 380, 300, 170);
    this.drawZero(c, 640, 380, 190, 70);
    this.drawBr(c, 640, 480, 190, 120);
    this.drawPcinc(c, 20, 520, 150, 90);
    this.drawPcmux(c, 210, 520, 380, 120);
    // 凡例
    c.font = '11px ' + MONO; c.fillStyle = COL.silkDim;
    c.fillText('銅箔の線 1 本 = 1 ビット。金色 = 1 / 暗い = 0。白く光る線 = いま確定した信号', 640, 640);
    c.fillText('チップをクリックするとゲートレベルの回路図へ', 640, 658);
    if (this.hot && this.hot.kind === 'chip') { c.strokeStyle = COL.hot; c.lineWidth = 2; const h = this.hot; U.rr(c, h.x - 3, h.y - 3, h.w + 6, h.h + 6, 6); c.stroke(); }
  }
  bus(c, pts, nets, label, lp) {
    const n = nets.length, gap = n > 6 ? 2.6 : 3.4;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * gap;
      const v = this.dv(nets[i]), f = this.front(nets[i]);
      c.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        const d1 = k > 0 ? norm(pts[k - 1], p) : null, d2 = k < pts.length - 1 ? norm(p, pts[k + 1]) : null;
        let nx = 0, ny = 0;
        if (d1) { nx += -d1[1]; ny += d1[0]; }
        if (d2 && !(d1 && d1[0] === d2[0] && d1[1] === d2[1])) { nx += -d2[1]; ny += d2[0]; }
        const x = p[0] + nx * o, y = p[1] + ny * o;
        k ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.strokeStyle = f ? COL.cuFront : v ? COL.cu1 : COL.cu0;
      c.lineWidth = f ? 2.2 : v ? 1.7 : 1.3;
      if (v || f) { c.shadowColor = f ? '#fff' : 'rgba(255,207,77,.7)'; c.shadowBlur = f ? 8 : 4; }
      c.stroke(); c.shadowBlur = 0;
    }
    if (label) {
      const t = label();
      c.font = '600 10.5px ' + MONO;
      const w = c.measureText(t).width + 10;
      c.fillStyle = 'rgba(6,20,14,.9)'; U.rr(c, lp[0], lp[1], w, 16, 3); c.fill();
      c.strokeStyle = '#3c6b55'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#ffe9a8'; c.fillText(t, lp[0] + 5, lp[1] + 12);
    }
  }
  chip(c, x, y, w, h, title, block, sub) {
    this.hits.push({ kind: 'chip', x, y, w, h, block, title });
    c.fillStyle = 'rgba(0,0,0,.35)'; U.rr(c, x + 3, y + 4, w, h, 5); c.fill();
    c.fillStyle = COL.chip; U.rr(c, x, y, w, h, 5); c.fill();
    c.strokeStyle = COL.chipEdge; c.lineWidth = 1.2; c.stroke();
    // ピン
    c.fillStyle = COL.pin;
    for (let px = x + 10; px < x + w - 6; px += 12) { c.fillRect(px, y - 3, 4, 3); c.fillRect(px, y + h, 4, 3); }
    c.fillStyle = COL.silk; c.font = '700 11.5px ' + MONO; c.fillText(title, x + 8, y + 15);
    if (sub) { c.fillStyle = COL.silkDim; c.font = '10px ' + MONO; c.fillText(sub, x + 8 + c.measureText(title).width * 1.06 + 14, y + 15); }
    c.beginPath(); c.arc(x + w - 9, y + 9, 2.5, 0, 7); c.fillStyle = '#2d3832'; c.fill();
  }
  led(c, x, y, on, ctl, r) {
    r = r || 4.5;
    c.beginPath(); c.arc(x, y, r, 0, 7);
    c.fillStyle = on ? (ctl ? COL.ctl1 : COL.led1) : (ctl ? COL.ctl0 : COL.led0);
    if (on) { c.shadowColor = ctl ? COL.ctl1 : COL.led1; c.shadowBlur = 8; }
    c.fill(); c.shadowBlur = 0;
  }
  bitsRow(c, x, y, prefix, n, cell, digits) {
    for (let i = n - 1, k = 0; i >= 0; i--, k++) {
      const v = this.V(prefix + i);
      const cx = x + k * cell;
      c.fillStyle = v ? COL.led1 : COL.led0;
      if (v) { c.shadowColor = COL.led1; c.shadowBlur = 6; }
      c.fillRect(cx, y, cell - 3, cell - 3); c.shadowBlur = 0;
      if (digits !== false) { c.fillStyle = v ? '#2a1d00' : '#6f8a7c'; c.font = '600 ' + Math.round(cell * 0.62) + 'px ' + MONO; c.textAlign = 'center'; c.fillText(v, cx + (cell - 3) / 2, y + cell * 0.66); c.textAlign = 'left'; }
    }
  }
  txt(c, s, x, y, col, size, bold) { c.fillStyle = col || COL.silk; c.font = (bold ? '700 ' : '') + (size || 11) + 'px ' + MONO; c.fillText(s, x, y); }

  drawClk(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'CLK', 'pc', '1 周期 = 1 命令');
    c.strokeStyle = this.clk ? '#fff' : COL.ctl1; c.lineWidth = 1.6; c.beginPath();
    let px = x + 10; const yh = y + 26, yl = y + 42;
    c.moveTo(px, yl); for (let k = 0; k < 4; k++) { c.lineTo(px + 14, yl); c.lineTo(px + 14, yh); c.lineTo(px + 28, yh); c.lineTo(px + 28, yl); px += 28; }
    c.stroke();
    this.led(c, x + w - 16, y + 34, this.clk, true, 6);
  }
  drawPC(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'PC', 'pc', 'DFF×5');
    this.bitsRow(c, x + 12, y + 28, 'PC', 5, 24);
    const pc = this.busv('PC', 5);
    this.txt(c, '= ' + pc, x + 12, y + 76, '#fff', 18, true);
    this.txt(c, '番地', x + 70, y + 74, COL.silkDim, 10);
  }
  drawHalted(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'HALTED', 'pc', 'DFF');
    const v = this.V('HALTED');
    this.led(c, x + 20, y + 36, v, false, 7);
    this.txt(c, v ? '停止中' : '実行中', x + 36, y + 41, v ? '#ff8a80' : COL.silkDim, 12, true);
  }
  drawROM(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ROM 32×10', 'rom', 'プログラム = 2 進数');
    const P = this.prog, pc = this.busv('PC', 5);
    const top = y + 40, rh = (h - 50) / 32, cell = 15.5, bx = x + 34;
    // フィールドの色帯
    const band = (c0, n, col) => { c.fillStyle = col; c.fillRect(bx + c0 * cell - 1, top - 14, n * cell, 32 * rh + 14); };
    band(0, 3, 'rgba(232,163,106,.07)'); band(3, 2, 'rgba(199,146,234,.07)'); band(5, 5, 'rgba(95,211,196,.07)');
    c.font = '9.5px ' + MONO;
    c.fillStyle = COL.op; c.fillText('op', bx + 12, top - 4); c.fillStyle = COL.rr; c.fillText('rr', bx + 3 * cell + 6, top - 4); c.fillStyle = COL.ad; c.fillText('aaaaa', bx + 5 * cell + 20, top - 4);
    const ROMv = this.dep[this.N.I0] <= this.wave;
    for (let a = 0; a < 32; a++) {
      const yy = top + a * rh;
      const w0 = a < P.words.length ? P.words[a] : 0, used = a < P.words.length;
      const sel = a === pc;
      if (sel) { c.fillStyle = ROMv ? 'rgba(255,207,77,.18)' : 'rgba(255,255,255,.06)'; c.fillRect(x + 4, yy - 1, w - 8, rh); }
      c.font = '9.5px ' + MONO; c.fillStyle = sel ? '#fff' : used ? '#7fa392' : '#3d5a4c';
      c.fillText(String(a).padStart(2, '0'), x + 10, yy + rh - 3);
      for (let k = 0; k < 10; k++) {
        const b = (w0 >> (9 - k)) & 1;
        c.fillStyle = b ? (sel && ROMv ? COL.led1 : used ? '#b39239' : '#3b3520') : (used ? '#203a2e' : '#172a22');
        if (b && sel && ROMv) { c.shadowColor = COL.led1; c.shadowBlur = 6; }
        c.fillRect(bx + k * cell, yy + 1, cell - 3, rh - 3);
        c.shadowBlur = 0;
      }
      if (used) { c.fillStyle = sel ? '#fff' : '#6f9784'; c.font = (sel ? '700 ' : '') + '10px ' + MONO; c.fillText(CPU.disasm(w0), bx + 10 * cell + 14, yy + rh - 3); }
    }
  }
  drawDec(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '命令デコーダ', 'dec');
    const op = (this.V('I9') << 2) | (this.V('I8') << 1) | this.V('I7');
    this.txt(c, 'op = ' + CPU.bin(op, 3), x + 10, y + 36, COL.op, 12, true);
    [['isHALT', 'HALT 000'], ['isINC', 'INC  001'], ['isDEC', 'DEC  010'], ['isJZ', 'JZ   011'], ['isJMP', 'JMP  100'], ['isBAD', '未定義']].forEach(([n, l], i) => {
      const v = this.V(n); const yy = y + 56 + i * 17;
      this.led(c, x + 18, yy - 4, v, true);
      this.txt(c, l, x + 30, yy, v ? '#fff' : COL.silkDim, 11, v);
    });
  }
  drawRsel(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'レジスタ選択', 'rsel');
    const rr = (this.V('I6') << 1) | this.V('I5');
    this.txt(c, 'rr = ' + CPU.bin(rr, 2), x + 10, y + 36, COL.rr, 12, true);
    CPU.REGN.forEach((r, k) => { const v = this.V('S' + k); this.led(c, x + 18 + k * 44, y + 58, v, true); this.txt(c, 'S' + k + ' ' + r, x + 26 + k * 44, y + 62, v ? '#fff' : COL.silkDim, 10); });
  }
  drawRegs(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'レジスタファイル', 'regs', '4×8bit DFF');
    CPU.REGN.forEach((r, k) => {
      const yy = y + 34 + k * 52;
      const sel = this.V('S' + k), we = this.V('WE' + r);
      if (sel) { c.fillStyle = 'rgba(78,201,176,.12)'; c.fillRect(x + 4, yy - 4, w - 8, 46); }
      this.txt(c, r, x + 12, yy + 20, sel ? '#fff' : COL.silk, 16, true);
      this.bitsRow(c, x + 34, yy + 4, 'R' + r, 8, 22);
      const v = this.busv('R' + r, 8);
      this.txt(c, String(v).padStart(3), x + 218, yy + 20, '#fff', 15, true);
      if (we) { this.txt(c, 'WE', x + 260, yy + 18, this.clk ? '#fff' : COL.ctl1, 11, true); }
      this.txt(c, 'S' + k + (we ? ' · 書込み' : ''), x + 34, yy + 40, COL.silkDim, 9);
    });
  }
  drawRmux(c, x, y, w, h) {
    this.hits.push({ kind: 'chip', x, y, w, h, block: 'rmux', title: '読み出し MUX' });
    c.fillStyle = COL.chip; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - 40, y + h); c.lineTo(x + 40, y + h); c.closePath(); c.fill();
    c.strokeStyle = COL.chipEdge; c.stroke();
    this.txt(c, '読み出し MUX   X = R[rr]', x + 52, y + 28, COL.silk, 11.5, true);
  }
  drawALU(c, x, y, w, h) {
    const inc = this.V('isINC'), dec = this.V('isDEC');
    this.chip(c, x, y, w, h, 'ALU', 'alu', '8bit 加算器 · リプルキャリー');
    const bx = x + 62, cell = 22;
    // 桁上げ
    this.txt(c, '桁上げ c', x + 8, y + 40, COL.silkDim, 9.5);
    for (let i = 8, k = 0; i >= 1; i--, k++) { const v = this.V('c' + i); this.txt(c, String(v), bx + k * cell + 5 + 11, y + 40, v ? COL.led1 : '#4e6b5d', 10, v); }
    this.txt(c, 'X', x + 40, y + 62, COL.silk, 13, true); this.bitsRow(c, bx, y + 47, 'X', 8, cell);
    c.font = '700 13px ' + MONO; c.fillStyle = COL.silk; c.fillText(dec ? '+' : '+', x + 22, y + 88);
    this.txt(c, 'B', x + 40, y + 88, COL.silk, 13, true);
    for (let i = 7, k = 0; i >= 0; i--, k++) { const v = i === 0 ? 1 : dec; c.fillStyle = v ? COL.led1 : COL.led0; c.fillRect(bx + k * cell, y + 73, cell - 3, cell - 3); c.fillStyle = v ? '#2a1d00' : '#6f8a7c'; c.font = '600 13px ' + MONO; c.textAlign = 'center'; c.fillText(v, bx + k * cell + 9.5, y + 87); c.textAlign = 'left'; }
    c.strokeStyle = COL.silkDim; c.beginPath(); c.moveTo(bx - 4, y + 100); c.lineTo(bx + 8 * cell, y + 100); c.stroke();
    this.txt(c, 'Y', x + 40, y + 122, COL.silk, 13, true); this.bitsRow(c, bx, y + 107, 'Y', 8, cell);
    this.txt(c, '= ' + this.busv('Y', 8), bx + 8 * cell + 6, y + 122, '#fff', 13, true);
    this.txt(c, dec ? 'B = 11111111 (−1)  DEC' : inc ? 'B = 00000001 (+1)  INC' : 'B = 00000001（結果は書き込まれない）', x + 10, y + 152, inc || dec ? COL.ctl1 : COL.silkDim, 10.5, inc || dec);
  }
  drawZero(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ゼロ検出', 'zero', 'NOR8');
    const z = this.V('Z');
    this.led(c, x + 20, y + 44, z, true, 7);
    this.txt(c, 'Z = ' + z + (z ? '  (X = 0)' : '  (X ≠ 0)'), x + 34, y + 49, z ? '#fff' : COL.silkDim, 12, z);
  }
  drawBr(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '分岐制御', 'br');
    [['JZZ', 'JZZ = JZ·Z'], ['BR', 'BR = JMP+JZZ'], ['HOLD', 'HOLD = HALT']].forEach(([n, l], i) => {
      const v = this.V(n); const yy = y + 42 + i * 24;
      this.led(c, x + 18, yy - 4, v, true, 5.5);
      this.txt(c, l, x + 32, yy, v ? '#fff' : COL.silkDim, 11.5, v);
    });
  }
  drawPcinc(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'PC+1', 'pcinc', '半加算器×5');
    this.bitsRow(c, x + 12, y + 32, 'P', 5, 24);
    this.txt(c, '= ' + this.busv('P', 5), x + 12, y + 78, '#fff', 14, true);
  }
  drawPcmux(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '次 PC 選択', 'pcmux', 'NPC = HOLD ? PC : BR ? aaaaa : PC+1');
    const br = this.V('BR'), hold = this.V('HOLD');
    const opts = [['PC+1', this.busv('P', 5), !br && !hold], ['aaaaa', this.busv('I', 5), br && !hold], ['PC', this.busv('PC', 5), hold]];
    opts.forEach(([l, v, on], i) => {
      const xx = x + 12 + i * 120, yy = y + 30;
      c.fillStyle = on ? 'rgba(255,207,77,.16)' : 'rgba(255,255,255,.03)'; U.rr(c, xx, yy, 110, 44, 4); c.fill();
      if (on) { c.strokeStyle = COL.led1; c.lineWidth = 1.2; c.stroke(); }
      this.txt(c, l, xx + 8, yy + 16, on ? '#fff' : COL.silkDim, 11, on);
      this.txt(c, CPU.bin(v, 5) + ' = ' + v, xx + 8, yy + 34, on ? COL.led1 : COL.silkDim, 12, on);
    });
    this.txt(c, 'NPC', x + 12, y + 102, COL.silk, 11, true);
    this.bitsRow(c, x + 50, y + 88, 'NPC', 5, 19);
    this.txt(c, '→ 次のクロックで PC へ', x + 160, y + 102, this.clk ? '#fff' : COL.silkDim, 10.5);
  }

  /* ---------------- 回路図（詳細・全体） ---------------- */
  drawSchBg(c, b) {
    c.fillStyle = COL.sch; c.fillRect(b.x - 2000, b.y - 2000, b.w + 4000, b.h + 4000);
    if (!this.dots) { const p = document.createElement('canvas'); p.width = p.height = 20; const pc = p.getContext('2d'); pc.fillStyle = '#23262b'; pc.fillRect(10, 10, 1.2, 1.2); this.dots = c.createPattern(p, 'repeat'); }
    c.fillStyle = this.dots; c.fillRect(b.x - 2000, b.y - 2000, b.w + 4000, b.h + 4000);
  }
  drawBlock(c, bid, ox, oy, frame) {
    const L = this.L[bid], meta = CPU.BLOCKS.find(b => b.id === bid);
    if (!this.blockHits) this.blockHits = [];
    if (frame) {
      c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(ox - 8, oy - 30, L.w + 16, L.h + 38);
      c.strokeStyle = '#3a4048'; c.lineWidth = 1; c.strokeRect(ox - 8, oy - 30, L.w + 16, L.h + 38);
      c.fillStyle = '#e6e6e6'; c.font = '700 13px ' + MONO; c.fillText(meta.name, ox, oy - 12);
      c.fillStyle = '#7d8590'; c.font = '11px ' + MONO; c.fillText(meta.desc, ox + c.measureText(meta.name).width * 1.0 + 30, oy - 12);
    }
    if (L.rom) return this.drawRomSch(c, ox, oy);
    const C = this.C, hotNet = this.hot && this.hot.net;
    c.save(); c.translate(ox, oy);
    // 配線
    c.lineJoin = 'round';
    for (const g of L.gs) {
      const P = L.pos[g.id];
      g.ins.forEach((n, k) => {
        const ty = P.y + (k + 1) * P.h / (g.ins.length + 1), tx = P.x;
        let sx, sy;
        if (L.internal(n)) { const d = L.pos[C.nets[n].driver]; sx = d.x + d.w + (this.bubble(C.gates[C.nets[n].driver]) ? 5 : 0); sy = d.y + d.h / 2; }
        else { sx = PORTW; sy = L.ports[L.pIdx[n]].y; }
        const xm = tx - 10 - k * 3;
        const v = this.dv(n), f = this.front(n), h = hotNet === n;
        c.strokeStyle = h ? COL.hot : f ? '#fff' : v ? COL.wire1 : COL.wire0;
        c.lineWidth = h ? 2.4 : f ? 2 : v ? 1.5 : 1.1;
        c.beginPath(); c.moveTo(sx, sy);
        if (sx + 6 <= xm) { c.lineTo(xm, sy); c.lineTo(xm, ty); }
        else { const cy = P.y - 5 - k * 2; c.lineTo(sx + 6, sy); c.lineTo(sx + 6, cy); c.lineTo(xm, cy); c.lineTo(xm, ty); }
        c.lineTo(tx, ty); c.stroke();
      });
    }
    // 入力ポート（ネットラベル）
    c.font = '10.5px ' + MONO;
    for (const p of L.ports) {
      const v = this.dv(p.net), h = hotNet === p.net;
      const name = C.nets[p.net].name;
      c.fillStyle = h ? '#12303f' : v ? '#3a2f10' : '#22262c';
      c.beginPath(); c.moveTo(2, p.y - 7); c.lineTo(PORTW - 8, p.y - 7); c.lineTo(PORTW, p.y); c.lineTo(PORTW - 8, p.y + 7); c.lineTo(2, p.y + 7); c.closePath(); c.fill();
      c.strokeStyle = h ? COL.hot : v ? COL.wire1 : '#4a525c'; c.lineWidth = 1; c.stroke();
      c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText(name.slice(0, 8), 6, p.y + 4);
    }
    // ゲート
    for (const g of L.gs) {
      const P = L.pos[g.id];
      const v = this.dv(g.out), h = this.hot && this.hot.gate === g.id;
      this.gate(c, g, P.x, P.y, P.w, P.h, v, h);
      if (L.usedOut.has(g.out) || g.type === 'DFF') {
        const name = C.nets[g.out].name, xo = P.x + P.w + (this.bubble(g) ? 5 : 0);
        c.strokeStyle = v ? COL.wire1 : COL.wire0; c.lineWidth = 1.2; c.beginPath(); c.moveTo(xo, P.y + P.h / 2); c.lineTo(xo + 12, P.y + P.h / 2); c.stroke();
        c.fillStyle = v ? '#ffe7a0' : '#8b939d'; c.font = '10px ' + MONO; c.fillText(name, xo + 14, P.y + P.h / 2 + 3.5);
      }
    }
    c.restore();
  }
  bubble(g) { return g.type === 'NOT' || g.type.startsWith('NOR'); }
  gate(c, g, x, y, w, h, v, hot) {
    c.lineWidth = hot ? 2.2 : 1.3;
    c.strokeStyle = hot ? COL.hot : v ? COL.wire1 : COL.gate;
    c.fillStyle = v ? '#2a2616' : COL.gateFill;
    const t = g.type;
    c.beginPath();
    if (t.startsWith('AND')) {
      c.moveTo(x, y); c.lineTo(x + w * 0.45, y); c.bezierCurveTo(x + w * 1.05, y, x + w * 1.05, y + h, x + w * 0.45, y + h); c.lineTo(x, y + h); c.closePath();
    } else if (t.startsWith('OR') || t.startsWith('XOR') || t.startsWith('NOR')) {
      c.moveTo(x, y); c.quadraticCurveTo(x + w * 0.7, y, x + w, y + h / 2); c.quadraticCurveTo(x + w * 0.7, y + h, x, y + h); c.quadraticCurveTo(x + w * 0.3, y + h / 2, x, y);
    } else if (t === 'NOT') {
      c.moveTo(x, y + 2); c.lineTo(x + w - 2, y + h / 2); c.lineTo(x, y + h - 2); c.closePath();
    } else if (t === 'DFF') {
      c.rect(x, y, w, h);
    } else { c.rect(x, y, w, h); }
    c.fill(); c.stroke();
    if (t.startsWith('XOR')) { c.beginPath(); c.moveTo(x - 4, y); c.quadraticCurveTo(x + w * 0.3 - 4, y + h / 2, x - 4, y + h); c.stroke(); }
    if (this.bubble(g)) { c.beginPath(); c.arc(x + w + 2.5, y + h / 2, 2.6, 0, 7); c.fillStyle = COL.gateFill; c.fill(); c.stroke(); }
    c.fillStyle = v ? '#ffe7a0' : '#9aa3ad'; c.font = '9px ' + MONO;
    if (t === 'DFF') { c.fillText('D', x + 3, y + 12); c.fillText('Q', x + w - 10, y + 12); c.beginPath(); c.moveTo(x, y + h - 9); c.lineTo(x + 6, y + h - 5); c.lineTo(x, y + h - 1); c.stroke(); c.fillText(this.cur[g.out] ? '1' : '0', x + w / 2 - 2, y + h - 5); }
    else if (t.startsWith('CONST')) c.fillText(t === 'CONST1' ? '1' : '0', x + 8, y + 12);
  }
  drawRomSch(c, ox, oy) {
    const P = this.prog, pc = this.busv('PC', 5), ROMv = this.dep[this.N.I0] <= this.wave;
    c.save(); c.translate(ox, oy);
    // 行デコーダ
    c.fillStyle = COL.gateFill; c.strokeStyle = COL.gate; c.lineWidth = 1.3; c.fillRect(70, 10, 70, 32 * 14 + 10); c.strokeRect(70, 10, 70, 32 * 14 + 10);
    c.fillStyle = '#9aa3ad'; c.font = '10px ' + MONO; c.fillText('5→32', 86, 26); c.fillText('行', 98, 40); c.fillText('デコーダ', 80, 54);
    for (let i = 0; i < 5; i++) {
      const v = this.V('PC' + i), y = 80 + i * 40;
      c.strokeStyle = v ? COL.wire1 : COL.wire0; c.beginPath(); c.moveTo(56, y); c.lineTo(70, y); c.stroke();
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(2, y - 7, 54, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText('PC' + i, 8, y + 4);
    }
    const mx = 170, cw = 32, rh = 14, top = 18;
    for (let a = 0; a < 32; a++) {
      const y = top + a * rh, sel = a === pc && ROMv;
      c.strokeStyle = sel ? COL.wire1 : '#2c333b'; c.lineWidth = sel ? 1.8 : 1;
      c.beginPath(); c.moveTo(140, y); c.lineTo(mx + 10 * cw, y); c.stroke();
      c.fillStyle = sel ? '#fff' : '#58616b'; c.font = '9px ' + MONO; c.fillText(String(a).padStart(2, '0'), 146, y - 2);
    }
    for (let k = 0; k < 10; k++) {
      const bit = 9 - k, x = mx + k * cw + cw / 2, v = this.V('I' + bit);
      c.strokeStyle = v ? COL.wire1 : '#2c333b'; c.lineWidth = v ? 1.6 : 1;
      c.beginPath(); c.moveTo(x, top - 8); c.lineTo(x, top + 32 * rh + 20); c.stroke();
      c.fillStyle = k < 3 ? COL.op : k < 5 ? COL.rr : COL.ad; c.font = '10px ' + MONO; c.fillText('I' + bit, x - 6, top + 32 * rh + 34);
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(x - 10, top + 32 * rh + 40, 20, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText(String(v), x - 3, top + 32 * rh + 51);
    }
    for (let a = 0; a < Math.min(32, P.words.length); a++) {
      for (let k = 0; k < 10; k++) if ((P.words[a] >> (9 - k)) & 1) {
        const sel = a === pc && ROMv;
        c.beginPath(); c.arc(mx + k * cw + cw / 2, top + a * rh, sel ? 4 : 3, 0, 7); c.fillStyle = sel ? COL.wire1 : '#8a7a4a'; c.fill();
      }
    }
    c.fillStyle = '#7d8590'; c.font = '10px ' + MONO; c.fillText('● = その行・その列が 1（ダイオード）。選ばれた行の ● がビット線を 1 にする（ワイヤード OR）', 0, top + 32 * rh + 76);
    c.restore();
  }

  /* ---------------- ホバー / クリック ---------------- */
  hover(p) {
    if (!this.C || !this.app.sim) return;
    this.hot = null;
    if (this.lod === 'overview') {
      const h = (this.hits || []).find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
      if (!h) return U.hideTip(this);
      this.hot = h;
      const b = CPU.BLOCKS.find(x => x.id === h.block);
      const gs = this.C.gates.filter(g => g.block === h.block);
      U.showTip(p.cx, p.cy, { level: 'circ', title: b.name, body: b.desc + '\n\n' + gs.slice(0, 7).map(g => g.role).join('\n') + (gs.length > 7 ? '\n… ほか ' + (gs.length - 7) + ' 個' : ''), value: 'クリックでゲートレベルの回路図へ（' + gs.length + ' 素子）' }, this);
      return;
    }
    const blocks = this.lod === 'detail' ? [[this.block, 0, 0]] : Object.keys(this.full).map(b => [b, this.full[b].x, this.full[b].y]);
    for (const [bid, ox, oy] of blocks) {
      const L = this.L[bid]; if (L.rom) continue;
      const x = p.x - ox, y = p.y - oy;
      for (const g of L.gs) { const P = L.pos[g.id]; if (x >= P.x - 2 && x <= P.x + P.w + 6 && y >= P.y && y <= P.y + P.h) { this.hot = { gate: g.id, net: g.out }; return this.tipGate(p, g); } }
      for (const pt of L.ports) if (x >= 0 && x <= PORTW && Math.abs(y - pt.y) < 8) { this.hot = { net: pt.net }; return this.tipNet(p, pt.net); }
    }
    U.hideTip(this);
  }
  tipGate(p, g) {
    const d = U.def(g.def);
    const ins = g.ins.map(n => this.C.nets[n].name + '=' + this.dv(n)).join('  ');
    U.showTip(p.cx, p.cy, { level: 'circ', id: g.def, title: g.role, body: d.title + ': ' + d.body + '\nブロック: ' + CPU.BLOCKS.find(b => b.id === g.block).name + '   伝搬の深さ: ' + this.dep[g.out], value: '入力 ' + ins + '\n出力 ' + this.C.nets[g.out].name + ' = ' + this.dv(g.out) }, this);
  }
  tipNet(p, n) {
    const net = this.C.nets[n], g = this.C.gates[net.driver];
    U.showTip(p.cx, p.cy, { level: 'circ', title: 'ネット ' + net.name, body: g ? '駆動: ' + g.role + '\n（' + CPU.BLOCKS.find(b => b.id === g.block).name + '）' : '', value: net.name + ' = ' + this.dv(n) }, this);
  }
  click(p) {
    if (this.lod !== 'overview') return;
    const h = (this.hits || []).find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
    if (h) { this.block = h.block; this.app.setMode('detail', 'circ'); }
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim || !this.C) return null;
    this.prep();
    const ck = sim.ck, v = ck.v, N = this.N, g = n => v[N[n]];
    const op = (g('I9') << 2) | (g('I8') << 1) | g('I7');
    const bus = (p, n) => { let x = 0; for (let i = 0; i < n; i++) x |= v[N[p + i]] << i; return x; };
    const sum = CPU.ISA[op].name + '  rr=' + CPU.bin((bus('I', 10) >> 5) & 3, 2) + '  X=' + CPU.bin(bus('X', 8), 8) + '  Y=' + CPU.bin(bus('Y', 8), 8) + '  Z=' + g('Z') + '  BR=' + g('BR') + '  HOLD=' + g('HOLD') + '  NPC=' + CPU.bin(bus('NPC', 5), 5);
    if (sim.halted) return { level: 'circ', id: 'G-DFF', title: '停止（HALTED = 1, クロック無効）', body: '' };
    if (this.clk) return { level: 'circ', id: 'G-CLK', title: 'クロック↑: 全 DFF が Q ← D', body: 'PC ← ' + CPU.bin(bus('NPC', 5), 5) + (g('WE') ? ',  R[' + CPU.REGN[(bus('I', 10) >> 5) & 3] + '] ← Y = ' + CPU.bin(bus('Y', 8), 8) : '') };
    return { level: 'circ', id: 'G-PROP', title: '組合せ回路の伝搬  深さ ' + Math.min(this.C.maxDepth, Math.floor(this.wave)) + '/' + this.C.maxDepth, body: '確定後: ' + sum };
  }
}
function norm(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
window.CircuitPanel = CircuitPanel;
})();
