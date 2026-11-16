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
const BW = 1400, BH = 900;

/* ------------------------------------------------------------------ */
/*  回路図の自動配置                                                      */
/* ------------------------------------------------------------------ */
const GW = 34, COLW = 92, PORTW = 70, RH = 25;
const num = (s, re) => { const m = s.match(re); return m ? m.slice(1).map(x => isNaN(+x) ? x : +x) : null; };
const RI = r => 'abcdefgh'.indexOf(r);
const HINTS = {
  alu: n => {
    let m;
    const B = i => i * 4;
    if ((m = num(n, /^nW(\d)$/))) return { col: 0, row: B(m[0]) };
    if ((m = num(n, /^bA(\d)$/))) return { col: 1, row: B(m[0]) };
    if ((m = num(n, /^bS(\d)$/))) return { col: 1, row: B(m[0]) + 1 };
    if ((m = num(n, /^B(\d)$/))) return { col: 2, row: B(m[0]) + 0.5 };
    if ((m = num(n, /^p(\d)$/))) return { col: 3, row: B(m[0]) };
    if ((m = num(n, /^g(\d)$/))) return { col: 3, row: B(m[0]) + 1.2 };
    if ((m = num(n, /^u(\d)$/))) return { col: 4, row: B(m[0]) };
    if ((m = num(n, /^h(\d)$/))) return { col: 4, row: B(m[0]) + 1.2 };
    if ((m = num(n, /^c(\d)$/))) return { col: 5, row: B(m[0] - 1) + 2.2 };
    if ((m = num(n, /^ys(\d)$/))) return { col: 6, row: B(m[0]) };
    if ((m = num(n, /^ym(\d)$/))) return { col: 6, row: B(m[0]) + 1 };
    if ((m = num(n, /^yh(\d)$/))) return { col: 6, row: B(m[0]) + 2 };
    if ((m = num(n, /^Y(\d)$/))) return { col: 7, row: B(m[0]) + 1 };
    if (n === 'nonA') return { col: 4, row: 33 };
    if (n === 'useS') return { col: 5, row: 33 };
    if (n === 'ONE') return { col: 0, row: 33 };
    if (n === 'ZERO_C') return { col: 0, row: 34 };
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
  rmux: n => { let m; if ((m = num(n, /^x([a-h])(\d)$/))) return { col: (m[1] % 2) * 2, row: Math.floor(m[1] / 2) * 9 + RI(m[0]) }; if ((m = num(n, /^X(\d)$/))) return { col: (m[0] % 2) * 2 + 1, row: Math.floor(m[0] / 2) * 9 + 3.5 }; },
  smux: n => { let m; if ((m = num(n, /^w([a-h])(\d)$/))) return { col: (m[1] % 2) * 2, row: Math.floor(m[1] / 2) * 9 + RI(m[0]) }; if ((m = num(n, /^W(\d)$/))) return { col: (m[0] % 2) * 2 + 1, row: Math.floor(m[0] / 2) * 9 + 3.5 }; },
  regs: n => {
    let m;
    const G = r => ({ cb: 1 + (RI(r) % 4) * 5, rb: Math.floor(RI(r) / 4) * 18 });
    if (n === 'WE') return { col: 0, row: 0 };
    if ((m = num(n, /^WE([a-h])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 0.5 }; }
    if ((m = num(n, /^nWE([a-h])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 2 }; }
    if ((m = num(n, /^wy([a-h])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (7 - m[1]) }; }
    if ((m = num(n, /^wk([a-h])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (7 - m[1]) + 1 }; }
    if ((m = num(n, /^D([a-h])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 2, row: g.rb + 2 * (7 - m[1]) + 0.5 }; }
    if ((m = num(n, /^R([a-h])(\d)$/))) { const g = G(m[0]); return { col: g.cb + 3, row: g.rb + 2 * (7 - m[1]) + 0.5 }; }
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
function romLayout() { return { bid: 'rom', w: 640, h: 900, rom: true }; }

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
    // 全体配置: データの流れに沿って 2 段
    const rows = [[['pc', 'pcinc', 'pcmux'], ['rom'], ['dec', 'rsel', 'ssel', 'zero', 'br'], ['rmux'], ['smux']], [['alu'], ['regs']]];
    this.full = {};
    let y0 = 0, W = 0;
    for (const row of rows) {
      let x = 0, rh = 0;
      for (const col of row) {
        let y = y0, cw = 0;
        for (const b of col) { const l = this.L[b]; this.full[b] = { x, y: y + 34 }; y += l.h + 34 + 50; cw = Math.max(cw, l.w); }
        x += cw + 70; rh = Math.max(rh, y - y0);
      }
      y0 += rh + 30; W = Math.max(W, x);
    }
    this.fullBounds = { x: -20, y: -20, w: W, h: y0 };
  }
  load(prog) { this.prog = prog; this.ensure(); this.applyWorld(); }
  setLOD(l) { this.lod = l; this.bar.hidden = l !== 'detail'; this.applyWorld(); this.paintChips(); }
  paintChips() { [...this.chips.children].forEach(c => c.classList.toggle('on', c.dataset.b === this.block)); }
  applyWorld() {
    if (!this.C) return;
    if (this.lod === 'overview') this.cv.setWorld({ x: 0, y: 0, w: BW, h: BH });
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
    c.fillStyle = COL.board; c.fillRect(0, 0, BW, BH);
    if (!this.pat) {
      const p = document.createElement('canvas'); p.width = p.height = 24; const pc = p.getContext('2d');
      pc.fillStyle = COL.board2; pc.beginPath(); pc.arc(12, 12, 1.6, 0, 7); pc.fill(); this.pat = c.createPattern(p, 'repeat');
    }
    c.fillStyle = this.pat; c.fillRect(0, 0, BW, BH);
    c.strokeStyle = '#2b5a46'; c.lineWidth = 2; U.rr(c, 2, 2, BW - 4, BH - 4, 10); c.stroke();
    c.fillStyle = COL.silkDim; c.font = '600 11px ' + MONO; c.textAlign = 'right'; c.fillText('CPU⁵  REV.B  8bit 単一サイクル  レジスタ 8 本 / ROM 64 語', BW - 12, BH - 10); c.textAlign = 'left';
    this.hits = [];
    const B = (pts, nets, label, lp) => this.bus(c, pts, nets.map(n => this.N[n]), label, lp);
    const range = (p, a, b) => { const r = []; for (let i = a; i >= b; i--) r.push(p + i); return r; };
    const PCn = range('PC', 5, 0);
    B([[200, 138], [240, 138]], PCn);
    B([[220, 138], [220, 680], [120, 680], [120, 700]], PCn, () => 'PC ' + CPU.bin(this.busv('PC', 6), 6), [226, 420]);
    B([[220, 680], [330, 680], [330, 700]], PCn);
    B([[700, 70], [750, 70]], range('I', 15, 12), () => 'op ' + CPU.bin(this.busv('I', 16) >> 12, 4), [704, 52]);
    B([[700, 347], [750, 347]], range('I', 11, 9), () => 'r ' + CPU.bin((this.busv('I', 16) >> 9) & 7, 3), [704, 329]);
    B([[700, 437], [750, 437]], range('I', 8, 6), () => 's ' + CPU.bin((this.busv('I', 16) >> 6) & 7, 3), [704, 419]);
    B([[600, 660], [600, 700]], range('I', 5, 0), () => 'aaaaaa ' + CPU.bin(this.busv('I', 6), 6), [612, 672]);
    const CT = ['isHALT', 'isINC', 'isDEC', 'isJZ', 'isJMP', 'isADD', 'isSUB', 'isMOV', 'isSHR', 'isJC', 'isJNC', 'isJNZ', 'isBAD'];
    const WR = ['isINC', 'isDEC', 'isADD', 'isSUB', 'isMOV', 'isSHR'];
    B([[970, 110], [990, 110], [990, 640], [970, 640]], CT);
    B([[990, 150], [1020, 150]], WR);
    B([[990, 600], [1020, 600]], WR);
    B([[970, 347], [1006, 347], [1006, 250], [1020, 250]], range('SR', 0, 7).reverse());
    B([[1006, 347], [1006, 416], [1020, 416]], range('SR', 0, 7).reverse());
    B([[970, 437], [1000, 437], [1000, 452], [1295, 452], [1295, 436]], range('SS', 0, 7).reverse());
    CPU.REGN.forEach((r, k) => B([[1045 + k * 44, 380], [1045 + k * 44, 396]], range('R' + r, 7, 0)));
    const Xn = range('X', 7, 0);
    B([[1105, 436], [1105, 470]], Xn, () => 'X ' + CPU.bin(this.busv('X', 8), 8), [1112, 455]);
    B([[1105, 462], [978, 462], [978, 524], [970, 524]], Xn);
    B([[1295, 436], [1295, 470]], range('W', 7, 0), () => 'W ' + CPU.bin(this.busv('W', 8), 8), [1302, 455]);
    B([[1380, 600], [1392, 600], [1392, 200], [1380, 200]], range('Y', 7, 0), () => 'Y ' + CPU.bin(this.busv('Y', 8), 8), [1300, 728]);
    B([[860, 554], [860, 572]], ['Z']);
    B([[1380, 680], [1388, 680], [1388, 740], [985, 740], [985, 700], [970, 700]], ['c8']);
    B([[750, 620], [712, 620], [712, 760], [700, 760]], ['BR', 'HOLD']);
    B([[750, 650], [728, 650], [728, 866], [18, 866], [18, 236], [40, 236]], ['HOLD']);
    B([[750, 690], [738, 690], [738, 880], [10, 880], [10, 268], [40, 268]], ['C_D'], () => 'C_D ' + this.V('C_D'), [600, 872]);
    B([[200, 745], [240, 745]], range('P', 5, 0));
    B([[470, 820], [470, 848], [26, 848], [26, 150], [40, 150]], range('NPC', 5, 0), () => 'NPC ' + CPU.bin(this.busv('NPC', 6), 6), [60, 838]);

    this.drawClk(c, 40, 20, 160, 50);
    this.drawPC(c, 40, 90, 160, 96);
    this.drawFlags(c, 40, 206, 160, 86);
    this.drawROM(c, 240, 20, 460, 640);
    this.drawDec(c, 750, 20, 220, 270);
    this.drawSel(c, 750, 310, 220, 74, 'rsel', 'r 選択', 'SR', 11, COL.rr);
    this.drawSel(c, 750, 400, 220, 74, 'ssel', 's 選択', 'SS', 8, '#f07178');
    this.drawZero(c, 750, 494, 220, 60);
    this.drawBr(c, 750, 572, 220, 150);
    this.drawRegs(c, 1020, 20, 360, 360);
    this.drawMux(c, 1020, 396, 170, 40, 'rmux', 'X = R[r]');
    this.drawMux(c, 1210, 396, 170, 40, 'smux', 'W = R[s]');
    this.drawALU(c, 1020, 470, 360, 250);
    this.drawPcinc(c, 40, 700, 160, 90);
    this.drawPcmux(c, 240, 700, 460, 120);
    c.font = '11px ' + MONO; c.fillStyle = COL.silkDim;
    c.fillText('銅箔の線 1 本 = 1 ビット。金色 = 1 / 暗い = 0。白く光る線 = いま確定した信号', 760, 790);
    c.fillText('チップをクリックするとゲートレベルの回路図へ', 760, 808);
    if (this.hot && this.hot.kind === 'chip') { c.strokeStyle = COL.hot; c.lineWidth = 2; const h = this.hot; U.rr(c, h.x - 3, h.y - 3, h.w + 6, h.h + 6, 6); c.stroke(); }
  }
  bus(c, pts, nets, label, lp) {
    const n = nets.length, gap = n > 8 ? 2.1 : n > 6 ? 2.6 : 3.4;
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
      c.lineWidth = f ? 2.2 : v ? 1.6 : 1.2;
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
    c.fillStyle = COL.pin;
    for (let px = x + 10; px < x + w - 6; px += 12) { c.fillRect(px, y - 3, 4, 3); c.fillRect(px, y + h, 4, 3); }
    c.fillStyle = COL.silk; c.font = '700 11.5px ' + MONO; c.fillText(title, x + 8, y + 15);
    if (sub) { const tw = c.measureText(title).width; c.fillStyle = COL.silkDim; c.font = '10px ' + MONO; c.fillText(sub, x + 18 + tw, y + 15); }
  }
  led(c, x, y, on, ctl, r) {
    r = r || 4.5;
    c.beginPath(); c.arc(x, y, r, 0, 7);
    c.fillStyle = on ? (ctl ? COL.ctl1 : COL.led1) : (ctl ? COL.ctl0 : COL.led0);
    if (on) { c.shadowColor = ctl ? COL.ctl1 : COL.led1; c.shadowBlur = 8; }
    c.fill(); c.shadowBlur = 0;
  }
  bitCells(c, x, y, vals, cell) {
    vals.forEach((v, k) => {
      const cx = x + k * cell;
      c.fillStyle = v ? COL.led1 : COL.led0;
      if (v) { c.shadowColor = COL.led1; c.shadowBlur = 6; }
      c.fillRect(cx, y, cell - 3, cell - 3); c.shadowBlur = 0;
      c.fillStyle = v ? '#2a1d00' : '#6f8a7c'; c.font = '600 ' + Math.round(cell * 0.6) + 'px ' + MONO; c.textAlign = 'center'; c.fillText(v, cx + (cell - 3) / 2, y + cell * 0.65); c.textAlign = 'left';
    });
  }
  bitsRow(c, x, y, prefix, n, cell) { const v = []; for (let i = n - 1; i >= 0; i--) v.push(this.V(prefix + i)); this.bitCells(c, x, y, v, cell); }
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
    this.chip(c, x, y, w, h, 'PC', 'pc', 'DFF×6');
    this.bitsRow(c, x + 10, y + 26, 'PC', 6, 23);
    this.txt(c, '= ' + this.busv('PC', 6), x + 12, y + 76, '#fff', 18, true);
    this.txt(c, '番地', x + 76, y + 74, COL.silkDim, 10);
  }
  drawFlags(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'フラグ', 'pc', 'DFF×2');
    const hv = this.V('HALTED'), cv = this.V('CF');
    this.led(c, x + 20, y + 38, hv, false, 6); this.txt(c, 'HALTED ' + (hv ? '停止中' : '実行中'), x + 34, y + 42, hv ? '#ff8a80' : COL.silkDim, 11.5, hv);
    this.led(c, x + 20, y + 66, cv, false, 6); this.txt(c, 'C = ' + cv + '  桁上げ/借り', x + 34, y + 70, cv ? '#fff' : COL.silkDim, 11.5, cv);
  }
  drawROM(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ROM 64×16', 'rom', 'プログラム = 2 進数');
    const P = this.prog, pc = this.busv('PC', 6);
    const top = y + 40, rh = (h - 50) / 64, cell = 14, bx = x + 28;
    const band = (c0, n, col) => { c.fillStyle = col; c.fillRect(bx + c0 * cell - 1, top - 14, n * cell, 64 * rh + 14); };
    band(0, 4, 'rgba(232,163,106,.07)'); band(4, 3, 'rgba(199,146,234,.07)'); band(7, 3, 'rgba(240,113,120,.07)'); band(10, 6, 'rgba(95,211,196,.07)');
    c.font = '9px ' + MONO;
    c.fillStyle = COL.op; c.fillText('op', bx + 16, top - 4); c.fillStyle = COL.rr; c.fillText('r', bx + 4 * cell + 16, top - 4); c.fillStyle = '#f07178'; c.fillText('s', bx + 7 * cell + 16, top - 4); c.fillStyle = COL.ad; c.fillText('aaaaaa', bx + 10 * cell + 18, top - 4);
    const ROMv = this.dep[this.N.I0] <= this.wave;
    for (let a = 0; a < 64; a++) {
      const yy = top + a * rh, w0 = a < P.words.length ? P.words[a] : 0, used = a < P.words.length, sel = a === pc;
      if (sel) { c.fillStyle = ROMv ? 'rgba(255,207,77,.18)' : 'rgba(255,255,255,.06)'; c.fillRect(x + 4, yy - 1, w - 8, rh); }
      if (used || sel) { c.font = '8px ' + MONO; c.fillStyle = sel ? '#fff' : '#7fa392'; c.fillText(String(a).padStart(2, '0'), x + 8, yy + rh - 1.5); }
      for (let k = 0; k < 16; k++) {
        const b = (w0 >> (15 - k)) & 1;
        c.fillStyle = b ? (sel && ROMv ? COL.led1 : used ? '#b39239' : '#3b3520') : (used ? '#203a2e' : '#152620');
        c.fillRect(bx + k * cell, yy + 0.5, cell - 2.5, rh - 1.5);
      }
      if (used) { c.fillStyle = sel ? '#fff' : '#6f9784'; c.font = (sel ? '700 ' : '') + '9px ' + MONO; c.fillText(CPU.disasm(w0), bx + 16 * cell + 10, yy + rh - 1.5); }
    }
  }
  drawDec(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '命令デコーダ', 'dec');
    const op = (this.V('I15') << 3) | (this.V('I14') << 2) | (this.V('I13') << 1) | this.V('I12');
    this.txt(c, 'op = ' + CPU.bin(op, 4), x + 10, y + 36, COL.op, 12, true);
    const L = ['HALT', 'INC', 'DEC', 'JZ', 'JMP', 'ADD', 'SUB', 'MOV', 'SHR', 'JC', 'JNC', 'JNZ', 'BAD'];
    L.forEach((n, i) => {
      const v = this.V('is' + n), col = i < 7 ? 0 : 1, row = i < 7 ? i : i - 7;
      const xx = x + 18 + col * 104, yy = y + 60 + row * 28;
      this.led(c, xx, yy - 4, v, true);
      this.txt(c, (n === 'BAD' ? '未定義' : n) + ' ' + (n === 'BAD' ? '11xx' : CPU.bin(i, 4)), xx + 12, yy, v ? '#fff' : COL.silkDim, 11, v);
    });
  }
  drawSel(c, x, y, w, h, blk, title, pre, hi, col) {
    this.chip(c, x, y, w, h, title, blk);
    const v = (this.V('I' + hi) << 2) | (this.V('I' + (hi - 1)) << 1) | this.V('I' + (hi - 2));
    this.txt(c, CPU.bin(v, 3), x + 130, y + 15, col, 12, true);
    CPU.REGN.forEach((r, k) => { const on = this.V(pre + k); this.led(c, x + 18 + k * 25, y + 40, on, true); this.txt(c, r, x + 15 + k * 25, y + 62, on ? '#fff' : COL.silkDim, 11, on); });
  }
  drawRegs(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'レジスタファイル', 'regs', '8×8bit DFF');
    CPU.REGN.forEach((r, k) => {
      const yy = y + 28 + k * 41;
      const sr = this.V('SR' + k), ss = this.V('SS' + k), we = this.V('WE' + r);
      if (sr || ss) { c.fillStyle = sr ? 'rgba(199,146,234,.13)' : 'rgba(240,113,120,.10)'; c.fillRect(x + 4, yy - 3, w - 8, 37); }
      this.txt(c, r, x + 12, yy + 18, sr || ss ? '#fff' : COL.silk, 15, true);
      this.bitsRow(c, x + 32, yy + 4, 'R' + r, 8, 21);
      this.txt(c, String(this.busv('R' + r, 8)).padStart(3), x + 210, yy + 19, '#fff', 15, true);
      if (sr) this.txt(c, 'r', x + 258, yy + 18, COL.rr, 12, true);
      if (ss) this.txt(c, 's', x + 272, yy + 18, '#f07178', 12, true);
      if (we) this.txt(c, 'WE 書込', x + 290, yy + 18, this.clk ? '#fff' : COL.ctl1, 11, true);
    });
  }
  drawMux(c, x, y, w, h, blk, label) {
    this.hits.push({ kind: 'chip', x, y, w, h, block: blk, title: label });
    c.fillStyle = COL.chip; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - 30, y + h); c.lineTo(x + 30, y + h); c.closePath(); c.fill();
    c.strokeStyle = COL.chipEdge; c.stroke();
    this.txt(c, '読出 ' + label, x + 34, y + 25, COL.silk, 11, true);
  }
  drawALU(c, x, y, w, h) {
    const ops = ['INC', 'DEC', 'ADD', 'SUB', 'MOV', 'SHR'].filter(n => this.V('is' + n));
    this.chip(c, x, y, w, h, 'ALU', 'alu', '8bit 加算器 + MOV/SHR 選択');
    const bx = x + 64, cell = 22;
    this.txt(c, '桁上げ', x + 10, y + 38, COL.silkDim, 9.5);
    for (let i = 8, k = 0; i >= 1; i--, k++) { const v = this.V('c' + i); this.txt(c, String(v), bx + k * cell - 4, y + 38, v ? COL.led1 : '#4e6b5d', 10, v); }
    this.txt(c, 'cin ' + this.V('isSUB'), bx + 8 * cell + 2, y + 38, COL.silkDim, 9.5);
    this.txt(c, 'X', x + 40, y + 60, COL.silk, 13, true); this.bitsRow(c, bx, y + 45, 'X', 8, cell);
    this.txt(c, '+', x + 22, y + 84, COL.silk, 13, true); this.txt(c, 'B', x + 40, y + 84, COL.silk, 13, true); this.bitsRow(c, bx, y + 69, 'B', 8, cell);
    c.strokeStyle = COL.silkDim; c.beginPath(); c.moveTo(bx - 4, y + 96); c.lineTo(bx + 8 * cell, y + 96); c.stroke();
    this.txt(c, 'Σ', x + 40, y + 116, COL.silk, 13, true); this.bitsRow(c, bx, y + 101, 'u', 8, cell);
    this.txt(c, 'c8 = ' + this.V('c8'), bx + 8 * cell + 6, y + 116, this.V('c8') ? COL.led1 : COL.silkDim, 11);
    this.txt(c, 'Y', x + 40, y + 150, COL.silk, 13, true); this.bitsRow(c, bx, y + 135, 'Y', 8, cell);
    this.txt(c, '= ' + this.busv('Y', 8), bx + 8 * cell + 6, y + 150, '#fff', 13, true);
    const mode = this.V('isMOV') ? 'Y ← W（MOV）' : this.V('isSHR') ? 'Y ← X >> 1（SHR）' : 'Y ← Σ';
    const bm = this.V('isADD') ? 'B = W（ADD）' : this.V('isSUB') ? 'B = ¬W, cin = 1（SUB: X − W）' : this.V('isDEC') ? 'B = 11111111（DEC: −1）' : this.V('isINC') ? 'B = 00000001（INC: +1）' : 'B は使わない';
    this.txt(c, bm, x + 10, y + 184, ops.length ? COL.ctl1 : COL.silkDim, 11, !!ops.length);
    this.txt(c, mode + (ops.length ? '' : '（結果は書き込まれない）'), x + 10, y + 204, ops.length ? COL.ctl1 : COL.silkDim, 11, !!ops.length);
    this.txt(c, '→ フラグ C_D = ' + this.V('C_D'), x + 10, y + 228, COL.silkDim, 10.5);
  }
  drawZero(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ゼロ検出', 'zero', 'NOR8');
    const z = this.V('Z');
    this.led(c, x + 20, y + 40, z, true, 7);
    this.txt(c, 'Z = ' + z + (z ? '  (X = 0)' : '  (X ≠ 0)'), x + 34, y + 45, z ? '#fff' : COL.silkDim, 12, z);
  }
  drawBr(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '分岐・フラグ制御', 'br');
    [['tJZ', 'JZ·Z'], ['tJNZ', 'JNZ·¬Z'], ['tJC', 'JC·C'], ['tJNC', 'JNC·¬C'], ['BR', 'BR 分岐する'], ['HOLD', 'HOLD 止める'], ['C_D', 'C の次の値']].forEach(([n, l], i) => {
      const v = this.V(n), col = i < 4 ? 0 : 1, row = i < 4 ? i : i - 4;
      const xx = x + 16 + col * 100, yy = y + 40 + row * 26;
      this.led(c, xx, yy - 4, v, true, 5);
      this.txt(c, l, xx + 10, yy, v ? '#fff' : COL.silkDim, 10.5, v);
    });
  }
  drawPcinc(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'PC+1', 'pcinc', '半加算器×6');
    this.bitsRow(c, x + 10, y + 30, 'P', 6, 23);
    this.txt(c, '= ' + this.busv('P', 6), x + 12, y + 78, '#fff', 14, true);
  }
  drawPcmux(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '次 PC 選択', 'pcmux', 'NPC = HOLD ? PC : BR ? aaaaaa : PC+1');
    const br = this.V('BR'), hold = this.V('HOLD');
    const opts = [['PC+1', this.busv('P', 6), !br && !hold], ['aaaaaa', this.busv('I', 6), br && !hold], ['PC', this.busv('PC', 6), hold]];
    opts.forEach(([l, v, on], i) => {
      const xx = x + 12 + i * 148, yy = y + 30;
      c.fillStyle = on ? 'rgba(255,207,77,.16)' : 'rgba(255,255,255,.03)'; U.rr(c, xx, yy, 138, 44, 4); c.fill();
      if (on) { c.strokeStyle = COL.led1; c.lineWidth = 1.2; c.stroke(); }
      this.txt(c, l, xx + 8, yy + 16, on ? '#fff' : COL.silkDim, 11, on);
      this.txt(c, CPU.bin(v, 6) + ' = ' + v, xx + 8, yy + 34, on ? COL.led1 : COL.silkDim, 12, on);
    });
    this.txt(c, 'NPC', x + 12, y + 102, COL.silk, 11, true);
    this.bitsRow(c, x + 48, y + 88, 'NPC', 6, 19);
    this.txt(c, '→ 次のクロックで PC へ', x + 180, y + 102, this.clk ? '#fff' : COL.silkDim, 10.5);
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
    const small = this.cv.cam.s < 0.42;   // 縮小表示では文字を省く
    c.save(); c.translate(ox, oy);
    // 配線（色ごとにまとめて 1 回で描く）
    const P0 = new Path2D(), P1 = new Path2D(), PF = new Path2D(), PH = new Path2D();
    for (const g of L.gs) {
      const P = L.pos[g.id];
      g.ins.forEach((n, k) => {
        const ty = P.y + (k + 1) * P.h / (g.ins.length + 1), tx = P.x;
        let sx, sy;
        if (L.internal(n)) { const d = L.pos[C.nets[n].driver]; sx = d.x + d.w + (this.bubble(C.gates[C.nets[n].driver]) ? 5 : 0); sy = d.y + d.h / 2; }
        else { sx = PORTW; sy = L.ports[L.pIdx[n]].y; }
        const xm = tx - 10 - k * 3;
        const path = hotNet === n ? PH : this.front(n) ? PF : this.dv(n) ? P1 : P0;
        path.moveTo(sx, sy);
        if (sx + 6 <= xm) { path.lineTo(xm, sy); path.lineTo(xm, ty); }
        else { const cy = P.y - 5 - k * 2; path.lineTo(sx + 6, sy); path.lineTo(sx + 6, cy); path.lineTo(xm, cy); path.lineTo(xm, ty); }
        path.lineTo(tx, ty);
      });
    }
    c.lineJoin = 'round';
    c.strokeStyle = COL.wire0; c.lineWidth = 1.1; c.stroke(P0);
    c.strokeStyle = COL.wire1; c.lineWidth = 1.5; c.stroke(P1);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(PF);
    c.strokeStyle = COL.hot; c.lineWidth = 2.4; c.stroke(PH);
    // 入力ポート（ネットラベル）
    const Q0 = new Path2D(), Q1 = new Path2D();
    for (const p of L.ports) {
      const q = this.dv(p.net) ? Q1 : Q0;
      q.moveTo(2, p.y - 7); q.lineTo(PORTW - 8, p.y - 7); q.lineTo(PORTW, p.y); q.lineTo(PORTW - 8, p.y + 7); q.lineTo(2, p.y + 7); q.closePath();
    }
    c.lineWidth = 1;
    c.fillStyle = '#22262c'; c.fill(Q0); c.strokeStyle = '#4a525c'; c.stroke(Q0);
    c.fillStyle = '#3a2f10'; c.fill(Q1); c.strokeStyle = COL.wire1; c.stroke(Q1);
    if (!small) {
      c.font = '10.5px ' + MONO;
      for (const p of L.ports) { const v = this.dv(p.net); c.fillStyle = hotNet === p.net ? COL.hot : v ? '#ffe7a0' : '#aab2bc'; c.fillText(C.nets[p.net].name.slice(0, 8), 6, p.y + 4); }
    }
    // ゲート（値ごとにまとめる）
    const G0 = new Path2D(), G1 = new Path2D();
    for (const g of L.gs) { const P = L.pos[g.id]; this.gatePath(this.dv(g.out) ? G1 : G0, g, P.x, P.y, P.w, P.h); }
    c.lineWidth = 1.3;
    c.fillStyle = COL.gateFill; c.fill(G0); c.strokeStyle = COL.gate; c.stroke(G0);
    c.fillStyle = '#2a2616'; c.fill(G1); c.strokeStyle = COL.wire1; c.stroke(G1);
    if (this.hot && this.hot.gate != null && L.pos[this.hot.gate]) { const g = C.gates[this.hot.gate], P = L.pos[g.id]; const hp = new Path2D(); this.gatePath(hp, g, P.x, P.y, P.w, P.h); c.strokeStyle = COL.hot; c.lineWidth = 2.4; c.stroke(hp); }
    // 出力ラベルと DFF の文字
    const O0 = new Path2D(), O1 = new Path2D();
    for (const g of L.gs) {
      if (!(L.usedOut.has(g.out) || g.type === 'DFF')) continue;
      const P = L.pos[g.id], xo = P.x + P.w + (this.bubble(g) ? 5 : 0), q = this.dv(g.out) ? O1 : O0;
      q.moveTo(xo, P.y + P.h / 2); q.lineTo(xo + 12, P.y + P.h / 2);
    }
    c.lineWidth = 1.2; c.strokeStyle = COL.wire0; c.stroke(O0); c.strokeStyle = COL.wire1; c.stroke(O1);
    if (!small) {
      c.font = '10px ' + MONO;
      for (const g of L.gs) {
        const P = L.pos[g.id], v = this.dv(g.out);
        if (L.usedOut.has(g.out) || g.type === 'DFF') { const xo = P.x + P.w + (this.bubble(g) ? 5 : 0); c.fillStyle = v ? '#ffe7a0' : '#8b939d'; c.fillText(C.nets[g.out].name, xo + 14, P.y + P.h / 2 + 3.5); }
        if (g.type === 'DFF') { c.fillStyle = v ? '#ffe7a0' : '#9aa3ad'; c.font = '9px ' + MONO; c.fillText('D', P.x + 3, P.y + 12); c.fillText('Q', P.x + P.w - 10, P.y + 12); c.fillText(v ? '1' : '0', P.x + P.w / 2 - 2, P.y + P.h - 5); c.font = '10px ' + MONO; }
        else if (g.base === 'CONST') { c.fillStyle = '#9aa3ad'; c.fillText(g.type === 'CONST1' ? '1' : '0', P.x + 8, P.y + 12); }
      }
    }
    c.restore();
  }
  gatePath(p, g, x, y, w, h) {
    const t = g.base;
    if (t === 'AND') { p.moveTo(x, y); p.lineTo(x + w * 0.45, y); p.bezierCurveTo(x + w * 1.05, y, x + w * 1.05, y + h, x + w * 0.45, y + h); p.lineTo(x, y + h); p.closePath(); }
    else if (t === 'OR' || t === 'XOR' || t === 'NOR') { p.moveTo(x, y); p.quadraticCurveTo(x + w * 0.7, y, x + w, y + h / 2); p.quadraticCurveTo(x + w * 0.7, y + h, x, y + h); p.quadraticCurveTo(x + w * 0.3, y + h / 2, x, y); p.closePath(); }
    else if (t === 'NOT') { p.moveTo(x, y + 2); p.lineTo(x + w - 2, y + h / 2); p.lineTo(x, y + h - 2); p.closePath(); }
    else if (t === 'DFF') { p.rect(x, y, w, h); p.moveTo(x, y + h - 9); p.lineTo(x + 6, y + h - 5); p.lineTo(x, y + h - 1); }
    else p.rect(x, y, w, h);
    if (t === 'XOR') { p.moveTo(x - 4, y); p.quadraticCurveTo(x + w * 0.3 - 4, y + h / 2, x - 4, y + h); }
    if (this.bubble(g)) { p.moveTo(x + w + 5.1, y + h / 2); p.arc(x + w + 2.5, y + h / 2, 2.6, 0, 7); }
  }
  bubble(g) { return g.base === 'NOT' || g.base === 'NOR'; }
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
    const P = this.prog, pc = this.busv('PC', 6), ROMv = this.dep[this.N.I0] <= this.wave;
    c.save(); c.translate(ox, oy);
    const top = 18, rh = 12, mx = 170, cw = 26;
    c.fillStyle = COL.gateFill; c.strokeStyle = COL.gate; c.lineWidth = 1.3; c.fillRect(70, 6, 70, 64 * rh + 8); c.strokeRect(70, 6, 70, 64 * rh + 8);
    c.fillStyle = '#9aa3ad'; c.font = '10px ' + MONO; c.fillText('6→64', 86, 26); c.fillText('行', 98, 40); c.fillText('デコーダ', 80, 54);
    for (let i = 0; i < 6; i++) {
      const v = this.V('PC' + i), y = 90 + i * 40;
      c.strokeStyle = v ? COL.wire1 : COL.wire0; c.beginPath(); c.moveTo(56, y); c.lineTo(70, y); c.stroke();
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(2, y - 7, 54, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText('PC' + i, 8, y + 4);
    }
    for (let a = 0; a < 64; a++) {
      const y = top + a * rh, sel = a === pc && ROMv;
      c.strokeStyle = sel ? COL.wire1 : '#2c333b'; c.lineWidth = sel ? 1.8 : 0.8;
      c.beginPath(); c.moveTo(140, y); c.lineTo(mx + 16 * cw, y); c.stroke();
      if (a < P.words.length || sel) { c.fillStyle = sel ? '#fff' : '#58616b'; c.font = '8.5px ' + MONO; c.fillText(String(a).padStart(2, '0'), 146, y - 2); }
    }
    const H = top + 64 * rh;
    for (let k = 0; k < 16; k++) {
      const bit = 15 - k, x = mx + k * cw + cw / 2, v = this.V('I' + bit);
      c.strokeStyle = v ? COL.wire1 : '#2c333b'; c.lineWidth = v ? 1.6 : 0.8;
      c.beginPath(); c.moveTo(x, top - 8); c.lineTo(x, H + 16); c.stroke();
      c.fillStyle = k < 4 ? COL.op : k < 7 ? COL.rr : k < 10 ? '#f07178' : COL.ad; c.font = '9.5px ' + MONO; c.fillText('I' + bit, x - 7, H + 30);
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(x - 9, H + 36, 18, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText(String(v), x - 3, H + 47);
    }
    for (let a = 0; a < Math.min(64, P.words.length); a++) for (let k = 0; k < 16; k++) if ((P.words[a] >> (15 - k)) & 1) {
      const sel = a === pc && ROMv;
      c.beginPath(); c.arc(mx + k * cw + cw / 2, top + a * rh, sel ? 3.6 : 2.6, 0, 7); c.fillStyle = sel ? COL.wire1 : '#8a7a4a'; c.fill();
    }
    c.fillStyle = '#7d8590'; c.font = '10px ' + MONO; c.fillText('● = その行・その列が 1（ダイオード）。選ばれた行の ● がビット線を 1 にする（ワイヤード OR）', 0, H + 70);
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
    const v = sim.ck.v, N = this.N, g = n => v[N[n]];
    const bus = (p, n) => { let x = 0; for (let i = 0; i < n; i++) x |= v[N[p + i]] << i; return x; };
    const op = bus('I', 16) >> 12;
    const sum = CPU.ISA[op].name + '  X=' + CPU.bin(bus('X', 8), 8) + '  W=' + CPU.bin(bus('W', 8), 8) + '  Y=' + CPU.bin(bus('Y', 8), 8) + '  Z=' + g('Z') + '  BR=' + g('BR') + '  C_D=' + g('C_D') + '  NPC=' + CPU.bin(bus('NPC', 6), 6);
    if (sim.halted) return { level: 'circ', id: 'G-DFF', title: '停止（HALTED = 1, クロック無効）', body: '' };
    if (this.clk) return { level: 'circ', id: 'G-CLK', title: 'クロック↑: 全 DFF が Q ← D', body: 'PC ← ' + CPU.bin(bus('NPC', 6), 6) + (g('WE') ? ',  R[' + CPU.REGN[(bus('I', 16) >> 9) & 7] + '] ← Y = ' + CPU.bin(bus('Y', 8), 8) : '') + ',  C ← ' + g('C_D') };
    return { level: 'circ', id: 'G-PROP', title: '組合せ回路の伝搬  深さ ' + Math.min(this.C.maxDepth, Math.floor(this.wave)) + '/' + this.C.maxDepth, body: '確定後: ' + sum };
  }
}
function norm(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
window.CircuitPanel = CircuitPanel;
})();
