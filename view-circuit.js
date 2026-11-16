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
  op: '#e8a36a', rr: '#c792ea', ss: '#f07178', ad: '#5fd3c4',
};
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';
const BW = 1620, BH = 1010;

/* ---------------- 回路図の自動配置 ---------------- */
const GW = 34, COLW = 92, PORTW = 70, RH = 25;
const num = (s, re) => { const m = s.match(re); return m ? m.slice(1).map(x => isNaN(+x) ? x : +x) : null; };
const RI = r => 'abcdefgh'.indexOf(r);
const HINTS = {
  alu: n => {
    let m;
    const at = (i, col, sub) => ({ col: col + (i >= 8 ? 9 : 0), row: (i % 8) * 5 + sub });
    if ((m = num(n, /^nW(\d+)$/))) return at(m[0], 0, 0);
    if ((m = num(n, /^bA(\d+)$/))) return at(m[0], 1, 0);
    if ((m = num(n, /^bS(\d+)$/))) return at(m[0], 1, 1);
    if ((m = num(n, /^B(\d+)$/))) return at(m[0], 2, 0.5);
    if ((m = num(n, /^p(\d+)$/))) return at(m[0], 3, 0);
    if ((m = num(n, /^g(\d+)$/))) return at(m[0], 3, 1.2);
    if ((m = num(n, /^u(\d+)$/))) return at(m[0], 4, 0);
    if ((m = num(n, /^h(\d+)$/))) return at(m[0], 4, 1.2);
    if ((m = num(n, /^c(\d+)$/))) return at(m[0] - 1, 5, 2.4);
    if ((m = num(n, /^ys(\d+)$/))) return at(m[0], 6, 0);
    if ((m = num(n, /^ym(\d+)$/))) return at(m[0], 6, 1);
    if ((m = num(n, /^yh(\d+)$/))) return at(m[0], 6, 2);
    if ((m = num(n, /^yi(\d+)$/))) return at(m[0], 6, 3);
    if ((m = num(n, /^yl(\d+)$/))) return at(m[0], 6, 4);
    if ((m = num(n, /^Y(\d+)$/))) return at(m[0], 7, 2);
    if (n === 'nonA') return { col: 4, row: 40.5 };
    if (n === 'useS') return { col: 5, row: 40.5 };
  },
  pcinc: n => { let m; if ((m = num(n, /^P(\d)$/))) return { col: 0, row: m[0] * 2 }; if ((m = num(n, /^k(\d)$/))) return { col: 1, row: m[0] * 2 - 0.5 }; if (n === 'ONE') return { col: -0.5, row: -1 }; },
  pcmux: n => {
    let m;
    const at = (i, col, sub) => ({ col, row: i * 3 + sub });
    if ((m = num(n, /^ba(\d)$/))) return at(m[0], 0, 0);
    if ((m = num(n, /^bp(\d)$/))) return at(m[0], 0, 1);
    if ((m = num(n, /^M(\d)$/))) return at(m[0], 1, 0.5);
    if ((m = num(n, /^rl(\d)$/))) return at(m[0], 2, 0);
    if ((m = num(n, /^rm(\d)$/))) return at(m[0], 2, 1);
    if ((m = num(n, /^N(\d)$/))) return at(m[0], 3, 0.5);
    if ((m = num(n, /^hp(\d)$/))) return at(m[0], 4, 1.6);
    if ((m = num(n, /^hm(\d)$/))) return at(m[0], 4, 0.6);
    if ((m = num(n, /^NPC(\d)$/))) return at(m[0], 5, 1);
  },
  rmux: n => { let m; if ((m = num(n, /^x([a-h])(\d+)$/))) return { col: (m[1] % 4) * 2, row: Math.floor(m[1] / 4) * 9 + RI(m[0]) }; if ((m = num(n, /^X(\d+)$/))) return { col: (m[0] % 4) * 2 + 1, row: Math.floor(m[0] / 4) * 9 + 3.5 }; },
  smux: n => { let m; if ((m = num(n, /^w([a-h])(\d+)$/))) return { col: (m[1] % 4) * 2, row: Math.floor(m[1] / 4) * 9 + RI(m[0]) }; if ((m = num(n, /^W(\d+)$/))) return { col: (m[0] % 4) * 2 + 1, row: Math.floor(m[0] / 4) * 9 + 3.5 }; },
  regs: n => {
    let m;
    const G = r => ({ cb: 1 + (RI(r) % 4) * 5, rb: Math.floor(RI(r) / 4) * 35 });
    if (n === 'WE') return { col: 0, row: 0 };
    if ((m = num(n, /^WE([a-h])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 0.5 }; }
    if ((m = num(n, /^nWE([a-h])$/))) { const g = G(m[0]); return { col: g.cb - 0.2, row: g.rb + 2 }; }
    if ((m = num(n, /^wy([a-h])(\d+)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (15 - m[1]) }; }
    if ((m = num(n, /^wk([a-h])(\d+)$/))) { const g = G(m[0]); return { col: g.cb + 1, row: g.rb + 2 * (15 - m[1]) + 1 }; }
    if ((m = num(n, /^D([a-h])(\d+)$/))) { const g = G(m[0]); return { col: g.cb + 2, row: g.rb + 2 * (15 - m[1]) + 0.5 }; }
    if ((m = num(n, /^R([a-h])(\d+)$/))) { const g = G(m[0]); return { col: g.cb + 3, row: g.rb + 2 * (15 - m[1]) + 0.5 }; }
  },
};
function gateSize(g) {
  if (g.type === 'DFF') return { w: 40, h: 30 };
  if (g.base === 'CONST') return { w: 22, h: 16 };
  const n = g.ins.length;
  return { w: n > 4 ? 30 : GW, h: Math.max(22, n * (n > 8 ? 5 : 8) + 6) };
}
function layoutBlock(C, bid) {
  const gs = C.gates.filter(g => g.block === bid && g.type !== 'ROM' && g.type !== 'RAM');
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
    let maxC = 0;
    for (const g of gs) {
      const h = hint(C.nets[g.out].name, g) || { col: 0, row: 0 };
      const sz = gateSize(g);
      pos[g.id] = { x: PORTW + 40 + h.col * COLW, y: 12 + h.row * RH - sz.h / 2 + 11, w: sz.w, h: sz.h };
      maxC = Math.max(maxC, h.col);
    }
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
      return { id, want: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 18, sz: gateSize(g) };
    }).sort((a, b) => a.want - b.want);
    let bottom = 0;
    for (const e of col) {
      let y = e.want - e.sz.h / 2;
      if (y < bottom + 6) y = bottom + 6;
      pos[e.id] = { x: PORTW + 30 + L * COLW, y, w: e.sz.w, h: e.sz.h };
      bottom = y + e.sz.h;
    }
  }
  const usedOut = new Set();
  for (const g of C.gates) if (!inB.has(g.id)) for (const n of g.ins) { const d = drv(n); if (d >= 0 && inB.has(d)) usedOut.add(n); }
  let w = PORTW + 40 + (maxL + 1) * COLW + 60, h = 0;
  for (const p of ports) h = Math.max(h, p.y + 12);
  for (const id in pos) { h = Math.max(h, pos[id].y + pos[id].h + 10); w = Math.max(w, pos[id].x + pos[id].w + 70); }
  return { bid, gs, pos, ports, pIdx, internal, usedOut, w, h };
}

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
    this.C = null; this.hot = null;
  }
  ensure() {
    if (this.C) return;
    this.C = CPU.Circuit.netlist || CPU.buildCircuit();
    if (!CPU.Circuit.netlist) CPU.Circuit.netlist = this.C;
    this.N = this.C.byName;
    this.L = {};
    CPU.BLOCKS.forEach(b => this.L[b.id] = b.id === 'rom' ? { bid: 'rom', w: 760, h: 1460, rom: true } : b.id === 'ram' ? { bid: 'ram', w: 700, h: 560, ram: true } : layoutBlock(this.C, b.id));
    const rows = [[['pc', 'pcinc', 'pcmux'], ['rom'], ['dec', 'rsel', 'ssel', 'zero', 'br'], ['ram', 'rmux'], ['smux']], [['alu'], ['regs']]];
    this.full = {};
    let y0 = 0, Wd = 0;
    for (const row of rows) {
      let x = 0, rh = 0;
      for (const col of row) {
        let y = y0, cw = 0;
        for (const b of col) { const l = this.L[b]; this.full[b] = { x, y: y + 34 }; y += l.h + 34 + 50; cw = Math.max(cw, l.w); }
        x += cw + 70; rh = Math.max(rh, y - y0);
      }
      y0 += rh + 30; Wd = Math.max(Wd, x);
    }
    this.fullBounds = { x: -20, y: -20, w: Wd, h: y0 };
  }
  load(prog) { this.prog = prog; this.loadN = (this.loadN || 0) + 1; this.ensure(); this.applyWorld(); }
  setLOD(l) { this.lod = l; this.bar.hidden = l !== 'detail'; this.applyWorld(); this.paintChips(); }
  paintChips() { [...this.chips.children].forEach(c => c.classList.toggle('on', c.dataset.b === this.block)); }
  applyWorld() {
    if (!this.C) return;
    if (this.lod === 'overview') this.cv.setWorld({ x: 0, y: 0, w: BW, h: BH });
    else if (this.lod === 'detail') { const l = this.L[this.block]; this.cv.setWorld({ x: -10, y: -40, w: l.w + 20, h: l.h + 50 }); }
    else this.cv.setWorld(this.fullBounds);
  }
  focusBlock(b) { this.block = b; this.paintChips(); this.applyWorld(); }
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
  busv(prefix, n) { let x = 0; for (let i = 0; i < n; i++) x |= this.V(prefix + i) << i; return x >>> 0; }

  frame() {
    if (!this.cv.visible() || !this.app.sim || !this.prog || !this.prog.ok) return;
    const sim = this.app.sim, cm = this.cv.cam, h = this.hot;
    const key = [this.loadN, sim.instr, sim.halted, sim.p.toFixed(3), this.app.running, cm.x, cm.y, cm.s, this.cv.w, this.cv.h, this.lod, this.block, h ? (h.gate != null ? 'g' + h.gate : h.block || h.net) : ''].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.prep();
    const c = this.cv.begin(true);
    if (this.lod === 'overview') this.drawBoard(c);
    else if (this.lod === 'detail') { this.drawSchBg(c, { x: -10, y: -40, w: this.L[this.block].w + 20, h: this.L[this.block].h + 50 }); this.drawBlock(c, this.block, 0, 0); }
    else { this.drawSchBg(c, this.fullBounds); for (const id in this.full) this.drawBlock(c, id, this.full[id].x, this.full[id].y); }
    this.info.textContent = '伝搬 ' + Math.min(this.C.maxDepth, Math.floor(this.wave)) + '/' + this.C.maxDepth + ' 段  ·  クロック ' + this.app.sim.ck.cycles + '  ·  ゲート ' + this.C.gates.length;
  }

  /* ---------------- 基板（俯瞰） ---------------- */
  drawBoard(c) {
    c.fillStyle = COL.board; c.fillRect(0, 0, BW, BH);
    if (!this.pat) { const p = document.createElement('canvas'); p.width = p.height = 24; const pc = p.getContext('2d'); pc.fillStyle = COL.board2; pc.beginPath(); pc.arc(12, 12, 1.6, 0, 7); pc.fill(); this.pat = c.createPattern(p, 'repeat'); }
    c.fillStyle = this.pat; c.fillRect(0, 0, BW, BH);
    c.strokeStyle = '#2b5a46'; c.lineWidth = 2; U.rr(c, 2, 2, BW - 4, BH - 4, 10); c.stroke();
    c.fillStyle = COL.silkDim; c.font = '600 11px ' + MONO; c.textAlign = 'right'; c.fillText('CPU⁵  REV.C  16bit 単一サイクル  レジスタ 8 / ROM 256 / RAM 64', BW - 14, BH - 10); c.textAlign = 'left';
    this.hits = [];
    const B = (pts, nets, label, lp) => this.bus(c, pts, nets.map(n => this.N[n]), label, lp);
    const range = (p, a, b) => { const r = []; for (let i = a; i >= b; i--) r.push(p + i); return r; };
    const PCn = range('PC', 7, 0);
    B([[210, 128], [250, 128]], PCn);
    B([[230, 128], [230, 728], [125, 728], [125, 760]], PCn, () => 'PC ' + this.busv('PC', 8), [236, 420]);
    B([[230, 728], [350, 728], [350, 740]], PCn);
    B([[730, 70], [770, 70]], range('I', 15, 12), () => 'op ' + CPU.bin(this.busv('I', 16) >> 12, 4), [734, 52]);
    B([[730, 372], [770, 372]], range('I', 11, 9), () => 'r ' + CPU.bin((this.busv('I', 16) >> 9) & 7, 3), [734, 354]);
    B([[730, 456], [770, 456]], range('I', 8, 6), () => 's ' + CPU.bin((this.busv('I', 16) >> 6) & 7, 3), [734, 438]);
    B([[620, 700], [620, 740]], range('I', 7, 0), () => 'a ' + (this.busv('I', 16) & 255), [632, 712]);
    const CT = ['isHALT', 'isINC', 'isDEC', 'isJZ', 'isJMP', 'isADD', 'isSUB', 'isMOV', 'isSHR', 'isJCC', 'isJNZ', 'isLDI', 'isLD', 'isST', 'isCALL', 'isRET'];
    const WR = ['isINC', 'isDEC', 'isADD', 'isSUB', 'isMOV', 'isSHR', 'isLDI', 'isLD'];
    B([[1000, 110], [1016, 110], [1016, 670], [1000, 670]], CT);
    B([[1016, 150], [1040, 150]], WR);
    B([[1016, 600], [1040, 600]], WR);
    B([[1000, 372], [1030, 372], [1030, 250], [1040, 250]], range('SR', 0, 7).reverse());
    B([[1030, 372], [1030, 416], [1040, 416]], range('SR', 0, 7).reverse());
    B([[1000, 456], [1034, 456], [1034, 454], [1450, 454], [1450, 436]], range('SS', 0, 7).reverse());
    CPU.REGN.forEach((r, k) => B([[1072 + k * 64, 380], [1072 + k * 64, 396]], range('R' + r, 15, 0)));
    const Xn = range('X', 15, 0);
    B([[1170, 436], [1170, 470]], Xn, () => 'X ' + this.busv('X', 16), [1178, 446]);
    B([[1170, 462], [1008, 462], [1008, 532], [1000, 532]], Xn);
    B([[1450, 436], [1450, 470]], range('W', 15, 0), () => 'W ' + this.busv('W', 16), [1458, 446]);
    B([[1460, 720], [1460, 740]], range('W', 5, 0), () => '番地 ' + this.busv('W', 6), [1470, 724]);
    B([[1200, 740], [1200, 720]], range('MD', 15, 0), () => 'MD ' + this.busv('MD', 16), [1210, 724]);
    B([[1580, 560], [1598, 560], [1598, 200], [1580, 200]], range('Y', 15, 0), () => 'Y ' + this.busv('Y', 16), [1480, 724 - 260]);
    B([[885, 560], [885, 576]], ['Z']);
    B([[770, 640], [745, 640], [745, 800], [730, 800]], ['BR', 'isRET', 'isHALT']);
    B([[770, 690], [754, 690], [754, 992], [14, 992], [14, 316], [40, 316]], ['isHALT']);
    B([[770, 720], [762, 720], [762, 1000], [8, 1000], [8, 340], [40, 340]], ['C_D'], () => 'C_D ' + this.V('C_D'), [600, 990]);
    B([[210, 800], [250, 800]], range('P', 7, 0));
    B([[218, 800], [218, 250], [210, 250]], range('P', 7, 0));
    B([[40, 228], [32, 228], [32, 884], [280, 884], [280, 870]], range('LR', 7, 0), () => 'LR ' + this.busv('LR', 8), [36, 600]);
    B([[490, 870], [490, 904], [24, 904], [24, 128], [40, 128]], range('NPC', 7, 0), () => 'NPC ' + this.busv('NPC', 8), [300, 894]);

    this.drawClk(c, 40, 20, 170, 48);
    this.drawReg8(c, 40, 86, 170, 84, 'PC', 'pc', 'PC', '番地');
    this.drawReg8(c, 40, 186, 170, 84, 'LR', 'pc', 'LR', '戻り番地');
    this.drawFlags(c, 40, 286, 170, 74);
    this.drawROM(c, 250, 20, 480, 680);
    this.drawDec(c, 770, 20, 230, 300);
    this.drawSel(c, 770, 336, 230, 72, 'rsel', 'r 選択', 'SR', 11, COL.rr);
    this.drawSel(c, 770, 420, 230, 72, 'ssel', 's 選択', 'SS', 8, COL.ss);
    this.drawZero(c, 770, 504, 230, 56);
    this.drawBr(c, 770, 576, 230, 170);
    this.drawRegs(c, 1040, 20, 540, 360);
    this.drawMux(c, 1040, 396, 260, 40, 'rmux', 'X = R[r]');
    this.drawMux(c, 1320, 396, 260, 40, 'smux', 'W = R[s]');
    this.drawALU(c, 1040, 470, 540, 250);
    this.drawRAM(c, 1040, 740, 540, 240);
    this.drawReg8(c, 40, 760, 170, 84, 'PC+1', 'pcinc', 'P', '');
    this.drawPcmux(c, 250, 740, 480, 130);
    c.font = '11px ' + MONO; c.fillStyle = COL.silkDim;
    c.fillText('銅箔の線 1 本 = 1 ビット。金色 = 1 / 暗い = 0。白く光る線 = いま確定した信号。チップをクリックで回路図へ', 250, 960);
    if (this.hot && this.hot.kind === 'chip') { c.strokeStyle = COL.hot; c.lineWidth = 2; const h = this.hot; U.rr(c, h.x - 3, h.y - 3, h.w + 6, h.h + 6, 6); c.stroke(); }
  }
  bus(c, pts, nets, label, lp) {
    const n = nets.length, gap = n > 12 ? 1.25 : n > 8 ? 1.9 : n > 6 ? 2.5 : 3.4;
    const P0 = new Path2D(), P1 = new Path2D(), PF = new Path2D();
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * gap, v = this.dv(nets[i]), f = this.front(nets[i]);
      const path = f ? PF : v ? P1 : P0;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        const d1 = k > 0 ? norm(pts[k - 1], p) : null, d2 = k < pts.length - 1 ? norm(p, pts[k + 1]) : null;
        let nx = 0, ny = 0;
        if (d1) { nx += -d1[1]; ny += d1[0]; }
        if (d2 && !(d1 && d1[0] === d2[0] && d1[1] === d2[1])) { nx += -d2[1]; ny += d2[0]; }
        const x = p[0] + nx * o, y = p[1] + ny * o;
        k ? path.lineTo(x, y) : path.moveTo(x, y);
      }
    }
    const lw = n > 12 ? 0.8 : 1;
    c.strokeStyle = COL.cu0; c.lineWidth = 1.2 * lw; c.stroke(P0);
    c.strokeStyle = COL.cu1; c.lineWidth = 1.6 * lw; c.shadowColor = 'rgba(255,207,77,.7)'; c.shadowBlur = 4; c.stroke(P1);
    c.strokeStyle = COL.cuFront; c.lineWidth = 2.2 * lw; c.shadowColor = '#fff'; c.shadowBlur = 8; c.stroke(PF); c.shadowBlur = 0;
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
      c.fillRect(cx, y, cell - 2.5, cell - 2.5);
      if (cell >= 13) { c.fillStyle = v ? '#2a1d00' : '#6f8a7c'; c.font = '600 ' + Math.round(cell * 0.6) + 'px ' + MONO; c.textAlign = 'center'; c.fillText(v, cx + (cell - 2.5) / 2, y + cell * 0.66); c.textAlign = 'left'; }
    });
  }
  bitsRow(c, x, y, prefix, n, cell) { const v = []; for (let i = n - 1; i >= 0; i--) v.push(this.V(prefix + i)); this.bitCells(c, x, y, v, cell); }
  txt(c, s, x, y, col, size, bold) { c.fillStyle = col || COL.silk; c.font = (bold ? '700 ' : '') + (size || 11) + 'px ' + MONO; c.fillText(s, x, y); }

  drawClk(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'CLK', 'pc', '1 周期 = 1 命令');
    c.strokeStyle = this.clk ? '#fff' : COL.ctl1; c.lineWidth = 1.6; c.beginPath();
    let px = x + 10; const yh = y + 25, yl = y + 40;
    c.moveTo(px, yl); for (let k = 0; k < 4; k++) { c.lineTo(px + 14, yl); c.lineTo(px + 14, yh); c.lineTo(px + 28, yh); c.lineTo(px + 28, yl); px += 28; }
    c.stroke();
    this.led(c, x + w - 16, y + 32, this.clk, true, 6);
  }
  drawReg8(c, x, y, w, h, title, blk, pre, sub) {
    this.chip(c, x, y, w, h, title, blk, sub);
    this.bitsRow(c, x + 8, y + 26, pre, 8, 19.5);
    this.txt(c, '= ' + this.busv(pre, 8), x + 10, y + 72, '#fff', 16, true);
  }
  drawFlags(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'フラグ', 'pc', 'DFF×2');
    const hv = this.V('HALTED'), cv = this.V('CF');
    this.led(c, x + 18, y + 34, hv, false, 6); this.txt(c, 'HALTED ' + (hv ? '停止' : '実行中'), x + 30, y + 38, hv ? '#ff8a80' : COL.silkDim, 11, hv);
    this.led(c, x + 18, y + 58, cv, false, 6); this.txt(c, 'C = ' + cv + ' 桁上げ/借り', x + 30, y + 62, cv ? '#fff' : COL.silkDim, 11, cv);
  }
  drawROM(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ROM 256×16', 'rom', 'プログラム = 2 進数（64 行を表示）');
    const P = this.prog, pc = this.busv('PC', 8);
    const start = Math.max(0, Math.min(Math.max(0, P.words.length - 64), pc - 24));
    const top = y + 44, rh = (h - 54) / 64, cell = 14, bx = x + 34;
    const band = (c0, n, col) => { c.fillStyle = col; c.fillRect(bx + c0 * cell - 1, top - 14, n * cell, 64 * rh + 14); };
    band(0, 4, 'rgba(232,163,106,.07)'); band(4, 3, 'rgba(199,146,234,.07)'); band(7, 9, 'rgba(95,211,196,.05)');
    c.font = '9px ' + MONO; c.fillStyle = COL.op; c.fillText('op', bx + 16, top - 4); c.fillStyle = COL.rr; c.fillText('r', bx + 4 * cell + 16, top - 4); c.fillStyle = COL.ad; c.fillText('s / a / i', bx + 8 * cell, top - 4);
    const ROMv = this.dep[this.N.I0] <= this.wave;
    for (let k = 0; k < 64; k++) {
      const a = start + k, yy = top + k * rh, w0 = a < P.words.length ? P.words[a] : 0, used = a < P.words.length, sel = a === pc;
      if (sel) { c.fillStyle = ROMv ? 'rgba(255,207,77,.18)' : 'rgba(255,255,255,.06)'; c.fillRect(x + 4, yy - 1, w - 8, rh); }
      if (used || sel) { c.font = '8px ' + MONO; c.fillStyle = sel ? '#fff' : '#7fa392'; c.fillText(String(a).padStart(3, '0'), x + 8, yy + rh - 1.5); }
      for (let j = 0; j < 16; j++) {
        const b = (w0 >> (15 - j)) & 1;
        c.fillStyle = b ? (sel && ROMv ? COL.led1 : used ? '#b39239' : '#3b3520') : (used ? '#203a2e' : '#152620');
        c.fillRect(bx + j * cell, yy + 0.5, cell - 2.5, rh - 1.5);
      }
      if (used) { c.fillStyle = sel ? '#fff' : '#6f9784'; c.font = (sel ? '700 ' : '') + '9px ' + MONO; c.fillText(CPU.disasm(w0), bx + 16 * cell + 10, yy + rh - 1.5); }
    }
    this.txt(c, '全 ' + P.words.length + ' 語', x + w - 70, y + 15, COL.silkDim, 10);
  }
  drawDec(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '命令デコーダ', 'dec');
    const op = this.busv('I', 16) >> 12;
    this.txt(c, 'op = ' + CPU.bin(op, 4), x + 130, y + 15, COL.op, 12, true);
    const L = ['HALT', 'INC', 'DEC', 'JZ', 'JMP', 'ADD', 'SUB', 'MOV', 'SHR', 'JCC', 'JNZ', 'LDI', 'LD', 'ST', 'CALL', 'RET'];
    L.forEach((n, i) => {
      const v = this.V('is' + n), col = i < 8 ? 0 : 1, row = i % 8, xx = x + 16 + col * 110, yy = y + 44 + row * 32;
      this.led(c, xx, yy - 4, v, true);
      this.txt(c, (n === 'JCC' ? 'JC/JNC' : n) + ' ' + CPU.bin(i, 4), xx + 11, yy, v ? '#fff' : COL.silkDim, 10.5, v);
    });
  }
  drawSel(c, x, y, w, h, blk, title, pre, hi, col) {
    this.chip(c, x, y, w, h, title, blk);
    const v = (this.busv('I', 16) >> (hi - 2)) & 7;
    this.txt(c, CPU.bin(v, 3), x + 140, y + 15, col, 12, true);
    CPU.REGN.forEach((r, k) => { const on = this.V(pre + k); this.led(c, x + 18 + k * 26, y + 38, on, true); this.txt(c, r, x + 15 + k * 26, y + 60, on ? '#fff' : COL.silkDim, 11, on); });
  }
  drawRegs(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'レジスタファイル', 'regs', '8×16bit DFF');
    CPU.REGN.forEach((r, k) => {
      const yy = y + 26 + k * 41, sr = this.V('SR' + k), ss = this.V('SS' + k), we = this.V('WE' + r);
      if (sr || ss) { c.fillStyle = sr ? 'rgba(199,146,234,.13)' : 'rgba(240,113,120,.10)'; c.fillRect(x + 4, yy - 3, w - 8, 37); }
      this.txt(c, r, x + 12, yy + 18, sr || ss ? '#fff' : COL.silk, 15, true);
      this.bitsRow(c, x + 32, yy + 4, 'R' + r, 16, 16.5);
      this.txt(c, String(this.busv('R' + r, 16)).padStart(5), x + 304, yy + 19, '#fff', 15, true);
      if (sr) this.txt(c, 'r', x + 368, yy + 18, COL.rr, 12, true);
      if (ss) this.txt(c, 's', x + 382, yy + 18, COL.ss, 12, true);
      if (we) this.txt(c, 'WE 書込', x + 400, yy + 18, this.clk ? '#fff' : COL.ctl1, 11, true);
    });
  }
  drawMux(c, x, y, w, h, blk, label) {
    this.hits.push({ kind: 'chip', x, y, w, h, block: blk, title: label });
    c.fillStyle = COL.chip; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - 30, y + h); c.lineTo(x + 30, y + h); c.closePath(); c.fill();
    c.strokeStyle = COL.chipEdge; c.stroke();
    this.txt(c, '読出 ' + label, x + 40, y + 25, COL.silk, 11, true);
  }
  drawALU(c, x, y, w, h) {
    const ops = ['INC', 'DEC', 'ADD', 'SUB', 'MOV', 'SHR', 'LDI', 'LD'].filter(n => this.V('is' + n));
    this.chip(c, x, y, w, h, 'ALU', 'alu', '16bit 加算器 + 結果の選択');
    const bx = x + 64, cell = 16.5;
    this.txt(c, '桁上げ', x + 10, y + 38, COL.silkDim, 9.5);
    for (let i = 16, k = 0; i >= 1; i--, k++) { const v = this.V('c' + i); this.txt(c, String(v), bx + k * cell - 4, y + 38, v ? COL.led1 : '#4e6b5d', 9.5, v); }
    const row = (lbl, pre, yy) => { this.txt(c, lbl, x + 40, yy + 13, COL.silk, 13, true); this.bitsRow(c, bx, yy, pre, 16, cell); };
    row('X', 'X', y + 46); this.txt(c, '+', x + 22, y + 82, COL.silk, 13, true); row('B', 'B', y + 68);
    c.strokeStyle = COL.silkDim; c.beginPath(); c.moveTo(bx - 4, y + 90); c.lineTo(bx + 16 * cell, y + 90); c.stroke();
    row('Σ', 'u', y + 96); row('Y', 'Y', y + 130);
    this.txt(c, '= ' + this.busv('Y', 16), bx + 16 * cell + 8, y + 143, '#fff', 13, true);
    this.txt(c, 'c16 = ' + this.V('c16'), bx + 16 * cell + 8, y + 109, this.V('c16') ? COL.led1 : COL.silkDim, 11);
    const mode = this.V('isMOV') ? 'Y ← W（MOV）' : this.V('isSHR') ? 'Y ← X >> 1（SHR）' : this.V('isLDI') ? 'Y ← 命令の下 9 ビット（LDI）' : this.V('isLD') ? 'Y ← RAM の出力 MD（LD）' : 'Y ← Σ';
    const bm = this.V('isADD') ? 'B = W（ADD）' : this.V('isSUB') ? 'B = ¬W, cin = 1（SUB: X − W）' : this.V('isDEC') ? 'B = 1…1（DEC: −1）' : this.V('isINC') ? 'B = 0…01（INC: +1）' : 'B は使わない';
    this.txt(c, bm, x + 10, y + 180, ops.length ? COL.ctl1 : COL.silkDim, 11, !!ops.length);
    this.txt(c, mode + (ops.length ? '' : '（結果は書き込まれない）'), x + 10, y + 202, ops.length ? COL.ctl1 : COL.silkDim, 11, !!ops.length);
    this.txt(c, '→ フラグ C_D = ' + this.V('C_D'), x + 10, y + 226, COL.silkDim, 10.5);
  }
  drawRAM(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'RAM 64×16', 'ram', '番地 = W mod 64');
    const ram = this.app.sim.ck.ram, a = this.busv('W', 6), ld = this.V('isLD'), st = this.V('isST'), lw = this.app.sim.ck.lastWrite;
    const arrs = this.prog.c ? this.prog.c.ast.arrays : [];
    for (let i = 0; i < 64; i++) {
      const cx = x + 10 + (i % 8) * 65, cy = y + 26 + Math.floor(i / 8) * 25;
      const own = arrs.find(q => i >= q.base && i < q.base + q.len);
      const act = (ld || st) && i === a;
      c.fillStyle = act ? (st ? 'rgba(240,113,120,.35)' : 'rgba(255,207,77,.3)') : i === lw ? 'rgba(255,255,255,.12)' : own ? 'rgba(95,211,196,.08)' : 'rgba(255,255,255,.02)';
      c.fillRect(cx, cy, 61, 21);
      c.fillStyle = '#4e6b5d'; c.font = '8px ' + MONO; c.fillText(String(i).padStart(2, '0'), cx + 2, cy + 8);
      c.fillStyle = act ? '#fff' : ram[i] ? COL.led1 : '#5d7a6c'; c.font = (act ? '700 ' : '') + '11px ' + MONO; c.textAlign = 'right'; c.fillText(String(ram[i]), cx + 58, cy + 17); c.textAlign = 'left';
    }
    this.txt(c, (ld ? 'LD: MD ← RAM[' + a + ']' : st ? 'ST: クロックで RAM[' + a + '] ← X = ' + this.busv('X', 16) : '（読み書きなし）'), x + 200, y + 15, ld || st ? COL.ctl1 : COL.silkDim, 10.5, ld || st);
  }
  drawZero(c, x, y, w, h) {
    this.chip(c, x, y, w, h, 'ゼロ検出', 'zero', 'NOR16');
    const z = this.V('Z');
    this.led(c, x + 20, y + 38, z, true, 7);
    this.txt(c, 'Z = ' + z + (z ? '  (X = 0)' : '  (X ≠ 0)'), x + 34, y + 43, z ? '#fff' : COL.silkDim, 12, z);
  }
  drawBr(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '分岐・フラグ制御', 'br');
    [['tJZ', 'JZ·Z'], ['tJNZ', 'JNZ·¬Z'], ['tJC', 'JC·C'], ['tJNC', 'JNC·¬C'], ['BR', 'BR 分岐'], ['isRET', 'RET'], ['isHALT', 'HOLD 止める'], ['C_D', 'C の次']].forEach(([n, l], i) => {
      const v = this.V(n), col = i < 4 ? 0 : 1, row = i % 4, xx = x + 16 + col * 108, yy = y + 42 + row * 30;
      this.led(c, xx, yy - 4, v, true, 5);
      this.txt(c, l, xx + 10, yy, v ? '#fff' : COL.silkDim, 10.5, v);
    });
  }
  drawPcmux(c, x, y, w, h) {
    this.chip(c, x, y, w, h, '次 PC 選択', 'pcmux', 'HOLD ? PC : RET ? LR : BR ? a : PC+1');
    const br = this.V('BR'), hold = this.V('isHALT'), ret = this.V('isRET');
    const opts = [['PC+1', this.busv('P', 8), !br && !hold && !ret], ['a（分岐先）', this.busv('I', 8), br && !hold && !ret], ['LR', this.busv('LR', 8), ret && !hold], ['PC', this.busv('PC', 8), hold]];
    opts.forEach(([l, v, on], i) => {
      const xx = x + 10 + i * 116, yy = y + 28;
      c.fillStyle = on ? 'rgba(255,207,77,.16)' : 'rgba(255,255,255,.03)'; U.rr(c, xx, yy, 108, 44, 4); c.fill();
      if (on) { c.strokeStyle = COL.led1; c.lineWidth = 1.2; c.stroke(); }
      this.txt(c, l, xx + 7, yy + 16, on ? '#fff' : COL.silkDim, 10.5, on);
      this.txt(c, String(v), xx + 7, yy + 35, on ? COL.led1 : COL.silkDim, 13, on);
    });
    this.txt(c, 'NPC', x + 12, y + 108, COL.silk, 11, true);
    this.bitsRow(c, x + 48, y + 94, 'NPC', 8, 18);
    this.txt(c, '→ 次のクロックで PC へ', x + 210, y + 108, this.clk ? '#fff' : COL.silkDim, 10.5);
  }

  /* ---------------- 回路図（詳細・全体） ---------------- */
  drawSchBg(c, b) {
    c.fillStyle = COL.sch; c.fillRect(b.x - 2000, b.y - 2000, b.w + 4000, b.h + 4000);
    if (!this.dots) { const p = document.createElement('canvas'); p.width = p.height = 20; const pc = p.getContext('2d'); pc.fillStyle = '#23262b'; pc.fillRect(10, 10, 1.2, 1.2); this.dots = c.createPattern(p, 'repeat'); }
    c.fillStyle = this.dots; c.fillRect(b.x - 2000, b.y - 2000, b.w + 4000, b.h + 4000);
  }
  drawBlock(c, bid, ox, oy) {
    const L = this.L[bid], meta = CPU.BLOCKS.find(b => b.id === bid);
    c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(ox - 8, oy - 30, L.w + 16, L.h + 38);
    c.strokeStyle = '#3a4048'; c.lineWidth = 1; c.strokeRect(ox - 8, oy - 30, L.w + 16, L.h + 38);
    c.fillStyle = '#e6e6e6'; c.font = '700 13px ' + MONO; c.fillText(meta.name, ox, oy - 12);
    c.fillStyle = '#7d8590'; c.font = '11px ' + MONO; c.fillText(meta.desc, ox + c.measureText(meta.name).width + 30, oy - 12);
    if (L.rom) return this.drawRomSch(c, ox, oy);
    if (L.ram) return this.drawRamSch(c, ox, oy);
    const C = this.C, hotNet = this.hot && this.hot.net, small = this.cv.cam.s < 0.42;
    c.save(); c.translate(ox, oy);
    const P0 = new Path2D(), P1 = new Path2D(), PF = new Path2D(), PH = new Path2D();
    for (const g of L.gs) {
      const P = L.pos[g.id];
      g.ins.forEach((n, k) => {
        const ty = P.y + (k + 1) * P.h / (g.ins.length + 1), tx = P.x;
        let sx, sy;
        if (L.internal(n)) { const d = L.pos[C.nets[n].driver]; sx = d.x + d.w + (this.bubble(C.gates[C.nets[n].driver]) ? 5 : 0); sy = d.y + d.h / 2; }
        else { sx = PORTW; sy = L.ports[L.pIdx[n]].y; }
        const xm = tx - 10 - (k % 6) * 3;
        const path = hotNet === n ? PH : this.front(n) ? PF : this.dv(n) ? P1 : P0;
        path.moveTo(sx, sy);
        if (sx + 6 <= xm) { path.lineTo(xm, sy); path.lineTo(xm, ty); }
        else { const cy = P.y - 5 - (k % 6) * 2; path.lineTo(sx + 6, sy); path.lineTo(sx + 6, cy); path.lineTo(xm, cy); path.lineTo(xm, ty); }
        path.lineTo(tx, ty);
      });
    }
    c.lineJoin = 'round';
    c.strokeStyle = COL.wire0; c.lineWidth = 1.1; c.stroke(P0);
    c.strokeStyle = COL.wire1; c.lineWidth = 1.5; c.stroke(P1);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(PF);
    c.strokeStyle = COL.hot; c.lineWidth = 2.4; c.stroke(PH);
    const Q0 = new Path2D(), Q1 = new Path2D();
    for (const p of L.ports) { const q = this.dv(p.net) ? Q1 : Q0; q.moveTo(2, p.y - 7); q.lineTo(PORTW - 8, p.y - 7); q.lineTo(PORTW, p.y); q.lineTo(PORTW - 8, p.y + 7); q.lineTo(2, p.y + 7); q.closePath(); }
    c.lineWidth = 1;
    c.fillStyle = '#22262c'; c.fill(Q0); c.strokeStyle = '#4a525c'; c.stroke(Q0);
    c.fillStyle = '#3a2f10'; c.fill(Q1); c.strokeStyle = COL.wire1; c.stroke(Q1);
    if (!small) { c.font = '10.5px ' + MONO; for (const p of L.ports) { const v = this.dv(p.net); c.fillStyle = hotNet === p.net ? COL.hot : v ? '#ffe7a0' : '#aab2bc'; c.fillText(C.nets[p.net].name.slice(0, 8), 6, p.y + 4); } }
    const G0 = new Path2D(), G1 = new Path2D();
    for (const g of L.gs) { const P = L.pos[g.id]; this.gatePath(this.dv(g.out) ? G1 : G0, g, P.x, P.y, P.w, P.h); }
    c.lineWidth = 1.3;
    c.fillStyle = COL.gateFill; c.fill(G0); c.strokeStyle = COL.gate; c.stroke(G0);
    c.fillStyle = '#2a2616'; c.fill(G1); c.strokeStyle = COL.wire1; c.stroke(G1);
    if (this.hot && this.hot.gate != null && L.pos[this.hot.gate]) { const g = C.gates[this.hot.gate], P = L.pos[g.id]; const hp = new Path2D(); this.gatePath(hp, g, P.x, P.y, P.w, P.h); c.strokeStyle = COL.hot; c.lineWidth = 2.4; c.stroke(hp); }
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
  drawRomSch(c, ox, oy) {
    const P = this.prog, pc = this.busv('PC', 8), ROMv = this.dep[this.N.I0] <= this.wave;
    c.save(); c.translate(ox, oy);
    const top = 18, rh = 5.4, mx = 170, cw = 30, H = top + 256 * rh;
    c.fillStyle = COL.gateFill; c.strokeStyle = COL.gate; c.lineWidth = 1.3; c.fillRect(70, 6, 70, 256 * rh + 8); c.strokeRect(70, 6, 70, 256 * rh + 8);
    c.fillStyle = '#9aa3ad'; c.font = '10px ' + MONO; c.fillText('8→256', 80, 26); c.fillText('行', 98, 40); c.fillText('デコーダ', 80, 54);
    for (let i = 0; i < 8; i++) {
      const v = this.V('PC' + i), y = 90 + i * 40;
      c.strokeStyle = v ? COL.wire1 : COL.wire0; c.beginPath(); c.moveTo(56, y); c.lineTo(70, y); c.stroke();
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(2, y - 7, 54, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText('PC' + i, 8, y + 4);
    }
    for (let a = 0; a < 256; a++) {
      const y = top + a * rh, sel = a === pc && ROMv;
      if (sel || a < P.words.length) { c.strokeStyle = sel ? COL.wire1 : '#2c333b'; c.lineWidth = sel ? 1.8 : 0.6; c.beginPath(); c.moveTo(140, y); c.lineTo(mx + 16 * cw, y); c.stroke(); }
      if (sel || a % 16 === 0) { c.fillStyle = sel ? '#fff' : '#58616b'; c.font = '8.5px ' + MONO; c.fillText(String(a).padStart(3, '0'), 143, y + 3); }
    }
    for (let k = 0; k < 16; k++) {
      const bit = 15 - k, x = mx + k * cw + cw / 2, v = this.V('I' + bit);
      c.strokeStyle = v ? COL.wire1 : '#2c333b'; c.lineWidth = v ? 1.6 : 0.8;
      c.beginPath(); c.moveTo(x, top - 8); c.lineTo(x, H + 16); c.stroke();
      c.fillStyle = k < 4 ? COL.op : k < 7 ? COL.rr : COL.ad; c.font = '9.5px ' + MONO; c.fillText('I' + bit, x - 7, H + 30);
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(x - 9, H + 36, 18, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText(String(v), x - 3, H + 47);
    }
    for (let a = 0; a < Math.min(256, P.words.length); a++) for (let k = 0; k < 16; k++) if ((P.words[a] >> (15 - k)) & 1) {
      const sel = a === pc && ROMv;
      c.beginPath(); c.arc(mx + k * cw + cw / 2, top + a * rh, sel ? 3 : 2, 0, 7); c.fillStyle = sel ? COL.wire1 : '#8a7a4a'; c.fill();
    }
    c.fillStyle = '#7d8590'; c.font = '10px ' + MONO; c.fillText('● = その行・その列が 1（ダイオード）。選ばれた行の ● がビット線を 1 にする（ワイヤード OR）', 0, H + 70);
    c.restore();
  }
  drawRamSch(c, ox, oy) {
    const ram = this.app.sim.ck.ram, a = this.busv('W', 6), ld = this.V('isLD'), st = this.V('isST');
    c.save(); c.translate(ox, oy);
    c.fillStyle = COL.gateFill; c.strokeStyle = COL.gate; c.lineWidth = 1.3; c.fillRect(70, 6, 70, 420); c.strokeRect(70, 6, 70, 420);
    c.fillStyle = '#9aa3ad'; c.font = '10px ' + MONO; c.fillText('6→64', 84, 26); c.fillText('番地', 90, 40); c.fillText('デコーダ', 80, 54);
    for (let i = 0; i < 6; i++) {
      const v = this.V('W' + i), y = 90 + i * 34;
      c.strokeStyle = v ? COL.wire1 : COL.wire0; c.beginPath(); c.moveTo(56, y); c.lineTo(70, y); c.stroke();
      c.fillStyle = v ? '#3a2f10' : '#22262c'; c.fillRect(2, y - 7, 54, 14); c.fillStyle = v ? '#ffe7a0' : '#aab2bc'; c.fillText('W' + i, 8, y + 4);
    }
    const st0 = this.V('isST');
    c.fillStyle = st0 ? '#3a2f10' : '#22262c'; c.fillRect(2, 330, 54, 14); c.fillStyle = st0 ? '#ffe7a0' : '#aab2bc'; c.fillText('isST', 8, 341);
    for (let i = 0; i < 64; i++) {
      const cx = 160 + (i % 8) * 64, cy = 10 + Math.floor(i / 8) * 52, act = (ld || st) && i === a;
      c.fillStyle = act ? (st ? 'rgba(240,113,120,.3)' : 'rgba(255,207,77,.25)') : '#1d2025'; c.fillRect(cx, cy, 58, 44);
      c.strokeStyle = act ? COL.wire1 : '#3a4048'; c.strokeRect(cx, cy, 58, 44);
      c.fillStyle = '#58616b'; c.font = '8.5px ' + MONO; c.fillText('[' + i + ']', cx + 3, cy + 10);
      c.fillStyle = act ? '#fff' : '#c5c8ce'; c.font = '12px ' + MONO; c.fillText(String(ram[i]), cx + 4, cy + 27);
      c.fillStyle = '#58616b'; c.font = '7.5px ' + MONO; c.fillText(CPU.bin(ram[i], 16).replace(/(....)/g, '$1 '), cx + 2, cy + 40);
    }
    c.fillStyle = '#9aa3ad'; c.font = '10.5px ' + MONO;
    c.fillText('MD15..0 = RAM[W mod 64] = ' + this.busv('MD', 16) + (ld ? '（LD で Y へ）' : ''), 160, 450);
    c.fillText(st ? 'クロック↑で RAM[' + a + '] ← X = ' + this.busv('X', 16) : '書き込みなし（isST = 0）', 160, 470);
    c.fillText('1 語 = 16 個の記憶素子（DFF）× 64 語。ここでは 1 部品として扱う', 160, 500);
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
      const b = CPU.BLOCKS.find(x => x.id === h.block), gs = this.C.gates.filter(g => g.block === h.block);
      U.showTip(p.cx, p.cy, { level: 'circ', title: b.name, body: b.desc + '\n\n' + gs.slice(0, 7).map(g => g.role).join('\n') + (gs.length > 7 ? '\n… ほか ' + (gs.length - 7) + ' 個' : ''), value: 'クリックでゲートレベルの回路図へ（' + gs.length + ' 素子）' }, this);
      return;
    }
    const blocks = this.lod === 'detail' ? [[this.block, 0, 0]] : Object.keys(this.full).map(b => [b, this.full[b].x, this.full[b].y]);
    for (const [bid, ox, oy] of blocks) {
      const L = this.L[bid]; if (L.rom || L.ram) continue;
      const x = p.x - ox, y = p.y - oy;
      for (const g of L.gs) { const P = L.pos[g.id]; if (x >= P.x - 2 && x <= P.x + P.w + 6 && y >= P.y && y <= P.y + P.h) { this.hot = { gate: g.id, net: g.out }; return this.tipGate(p, g); } }
      for (const pt of L.ports) if (x >= 0 && x <= PORTW && Math.abs(y - pt.y) < 8) { this.hot = { net: pt.net }; return this.tipNet(p, pt.net); }
    }
    U.hideTip(this);
  }
  tipGate(p, g) {
    const d = U.def(g.def), ins = g.ins.map(n => this.C.nets[n].name + '=' + this.dv(n)).join('  ');
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
    const bus = (p, n) => { let x = 0; for (let i = 0; i < n; i++) x |= v[N[p + i]] << i; return x >>> 0; };
    const I = bus('I', 16);
    const sum = CPU.mnOf(I) + '  X=' + bus('X', 16) + '  W=' + bus('W', 16) + '  Y=' + bus('Y', 16) + '  Z=' + g('Z') + '  BR=' + g('BR') + '  C_D=' + g('C_D') + '  NPC=' + bus('NPC', 8);
    if (sim.halted) return { level: 'circ', id: 'G-DFF', title: '停止（HALTED = 1, クロック無効）', body: '' };
    if (this.clk) return { level: 'circ', id: 'G-CLK', title: 'クロック↑: 全 DFF が Q ← D', body: 'PC ← ' + bus('NPC', 8) + (g('WE') ? ',  R[' + CPU.REGN[(I >> 9) & 7] + '] ← Y = ' + bus('Y', 16) : '') + (g('isST') ? ',  RAM[' + bus('W', 6) + '] ← ' + bus('X', 16) : '') + ',  C ← ' + g('C_D') };
    return { level: 'circ', id: 'G-PROP', title: '組合せ回路の伝搬  深さ ' + Math.min(this.C.maxDepth, Math.floor(this.wave)) + '/' + this.C.maxDepth, body: '確定後: ' + sum };
  }
}
function norm(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
window.CircuitPanel = CircuitPanel;
})();
