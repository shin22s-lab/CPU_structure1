/* フローチャート パネル（6 つ目のビュー）
 *   C の構文木から構造化フローチャートを描く（JIS/ISO 風: 端子・処理・判断）。
 *   アセンブリ直接のときは、基本ブロックの制御フローグラフ（CFG）を描く。
 *   いま実行中の箱・矢印を光らせ、通った回数を数える。 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';
const GAP = 24, BH = 30, DH = 46;
const tw = s => { let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 12.5 : 7.4; return w; };
const COL = { bg: '#17191c', box: '#20242a', edge: '#56606b', text: '#d4d4d4', act: '#ffcc00', pred: 'rgba(255,204,0,.45)', proc: '#569cd6', dec: '#c586c0', term: '#4ec9b0', loop: '#dcdcaa', brk: '#f78c6c', call: '#ff7edb' };

const condText = c => { const t = window.C_TXT.condText(c); return t.replace('!=', '≠').replace('>=', '≥').replace('<=', '≤'); };
function exprText(n) {
  const T = window.C_TXT, e = n.expr;
  return T.dstText(n.dst) + ' ← ' + (e.t === 'bin' ? T.opnd(e.a) + ' ' + ({ '-': '−', '*': '×', '/': '÷', '%': 'mod' }[e.op] || e.op) + ' ' + T.opnd(e.b) : T.opnd(e));
}

/* ---- 構造化フローチャートの配置 ---- */
function measure(n) {
  switch (n.k) {
    case 'block': {
      const ch = n.body.filter(x => x.k !== 'empty').map(measure);
      if (!ch.length) return n.m = { l: 0, r: 0, h: 0, empty: true };
      return n.m = { l: Math.max(...ch.map(m => m.l)), r: Math.max(...ch.map(m => m.r)), h: ch.reduce((a, m) => a + m.h, 0) + GAP * (ch.length - 1) };
    }
    case 'empty': return n.m = { l: 0, r: 0, h: 0, empty: true };
    case 'asg': case 'brk': case 'ret': case 'call': {
      const label = n.k === 'asg' ? exprText(n) : n.k === 'brk' ? 'break（ループを抜ける）' : n.k === 'call' ? n.name + '()' : (n.inMain ? 'return（停止）' : 'return（戻る）');
      const w = Math.max(96, tw(label) + 26);
      return n.m = { l: w / 2, r: w / 2, h: BH, w, label };
    }
    case 'while': {
      const B = measure(n.body);
      const inf = n.c.k === 'true';
      const label = inf ? '∞ 繰り返し' : condText(n.c) + ' ?';
      const dw = inf ? 120 : Math.max(120, tw(label) + 50), dh = inf ? 28 : DH;
      return n.m = { l: Math.max(dw / 2, B.l) + 30, r: Math.max(dw / 2, B.r) + 36, h: dh + GAP + B.h + GAP + 14, dw, dh, label, inf };
    }
    case 'if': {
      const T = measure(n.then), E = n.else ? measure(n.else) : { l: 0, r: 0, h: 0, empty: true };
      const label = condText(n.c) + ' ?', dw = Math.max(120, tw(label) + 50);
      const tx = Math.max(T.r + 22, dw / 2 + 12), ex = Math.max(E.l + 22, dw / 2 + 12);
      return n.m = { l: tx + T.l, r: ex + E.r, h: DH + GAP + Math.max(T.h, E.h) + GAP, dw, dh: DH, label, tx, ex, T, E };
    }
  }
  return n.m = { l: 0, r: 0, h: 0, empty: true };
}

function buildCharts(ast) {
  const fns = [ast].concat(Object.values(ast.funcs || {}).filter(f => f.k === 'func'));
  const all = { boxes: [], edges: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  let ox = 0;
  for (const f of fns) {
    const fc = new FlowChart(f, ox);
    all.boxes.push(...fc.boxes); all.edges.push(...fc.edges);
    ox = fc.bounds.x + fc.bounds.w + 50; all.bounds.h = Math.max(all.bounds.h, fc.bounds.h);
  }
  all.bounds.w = ox;
  return all;
}
class FlowChart {
  constructor(fn, ox) {
    this.boxes = []; this.edges = []; this.loops = []; this.key = new Map();
    ox = ox || 0;
    const isMain = fn.k === 'main';
    const B = measure(fn.body);
    const cx = ox + Math.max(B.l, 80) + 20;
    this.box({ kind: 'term', x: cx, y: 10, w: 150, h: 30, label: isMain ? '開始 main()' : '入口 ' + fn.name + '()' });
    let y = 40;
    if (!B.empty) { this.edge([[cx, y], [cx, y + GAP]]); y = this.place(fn.body, cx, y + GAP); }
    const ey = (y === null ? this.lastY : y) + GAP;
    if (y !== null) this.edge([[cx, y], [cx, ey]]);
    this.box({ kind: 'term', x: cx, y: ey, w: 160, h: 30, label: isMain ? '終了（HALT）' : '戻る（RET）', node: fn, role: isMain ? 'halt' : 'ret' });
    this.bounds = { x: ox, y: 0, w: (cx - ox) + Math.max(B.r, 90) + 30, h: ey + 50 };
  }
  box(b) { this.boxes.push(b); if (b.node) this.key.set(b.node, Object.assign(this.key.get(b.node) || {}, { [b.role]: b })); return b; }
  edge(pts, opt) { const e = Object.assign({ pts }, opt || {}); this.edges.push(e); return e; }
  // 戻り値: 下端の y（流れが続かないなら null）
  place(n, cx, y) {
    const m = n.m;
    switch (n.k) {
      case 'block': {
        const ch = n.body.filter(x => x.k !== 'empty');
        let yy = y;
        for (let i = 0; i < ch.length; i++) {
          const yb = this.place(ch[i], cx, yy);
          if (yb === null) { this.lastY = yy + ch[i].m.h; return null; }
          if (i < ch.length - 1) { this.edge([[cx, yb], [cx, yb + GAP]]); yy = yb + GAP; } else yy = yb;
        }
        return yy;
      }
      case 'asg': this.box({ kind: 'proc', x: cx, y, w: m.w, h: BH, label: m.label, node: n, role: 'asg' }); return y + BH;
      case 'brk': {
        const b = this.box({ kind: 'brk', x: cx, y, w: m.w, h: BH, label: m.label, node: n, role: 'brk' });
        this.loops[this.loops.length - 1].brks.push(b);
        this.lastY = y + BH; return null;
      }
      case 'ret': this.box({ kind: 'term', x: cx, y, w: m.w, h: BH, label: m.label, node: n, role: n.inMain ? 'halt' : 'ret' }); this.lastY = y + BH; return null;
      case 'call': this.box({ kind: 'call', x: cx, y, w: m.w, h: BH, label: m.label, node: n, role: 'call' }); return y + BH;
      case 'while': {
        const top = y, mid = y + m.dh / 2, bottom = y + m.h, lane = cx + m.r - 10, left = cx - m.l + 10;
        this.box({ kind: m.inf ? 'loop' : 'dec', x: cx, y, w: m.dw, h: m.dh, label: m.label, node: n, role: 'cond' });
        const ctx = { brks: [] };
        this.loops.push(ctx);
        const bt = y + m.dh + GAP;
        let yb = bt;
        if (!n.body.m.empty) { this.edge([[cx, y + m.dh], [cx, bt]], { label: m.inf ? '' : '真', node: n, role: 'T' }); yb = this.place(n.body, cx, bt); }
        else yb = y + m.dh;
        this.loops.pop();
        if (yb !== null) this.edge([[cx, yb], [cx, yb + 14], [left, yb + 14], [left, mid], [cx - m.dw / 2, mid]], { node: n, role: 'back' });
        if (!m.inf) this.edge([[cx + m.dw / 2, mid], [lane, mid], [lane, bottom], [cx, bottom]], { label: '偽', node: n, role: 'F', arrowEnd: false });
        const ys = ctx.brks.map(b => b.y + BH / 2);
        for (const b of ctx.brks) this.edge([[b.x + b.w / 2, b.y + BH / 2], [lane, b.y + BH / 2]], { node: b.node, role: 'brkE', arrowEnd: false });
        if (m.inf && ys.length) this.edge([[lane, Math.min(...ys)], [lane, bottom], [cx, bottom]], { arrowEnd: false });
        if (m.inf && !ys.length) return null;
        return bottom;
      }
      case 'if': {
        const mid = y + m.dh / 2, tX = cx - m.tx, eX = cx + m.ex, by = y + m.dh + GAP, merge = y + m.h;
        this.box({ kind: 'dec', x: cx, y, w: m.dw, h: m.dh, label: m.label, node: n, role: 'cond' });
        let any = false;
        if (!m.T.empty) {
          this.edge([[cx - m.dw / 2, mid], [tX, mid], [tX, by]], { label: '真', node: n, role: 'T' });
          const yb = this.place(n.then, tX, by);
          if (yb !== null) { this.edge([[tX, yb], [tX, merge], [cx, merge]], { node: n, role: n.else ? 'skip' : 'Tj', arrowEnd: false }); any = true; }
        } else { this.edge([[cx - m.dw / 2, mid], [tX, mid], [tX, merge], [cx, merge]], { label: '真', node: n, role: 'T', arrowEnd: false }); any = true; }
        if (!m.E.empty) {
          this.edge([[cx + m.dw / 2, mid], [eX, mid], [eX, by]], { label: '偽', node: n, role: 'F' });
          const yb = this.place(n.else, eX, by);
          if (yb !== null) { this.edge([[eX, yb], [eX, merge], [cx, merge]], { arrowEnd: false }); any = true; }
        } else { this.edge([[cx + m.dw / 2, mid], [eX, mid], [eX, merge], [cx, merge]], { label: '偽', node: n, role: 'F', arrowEnd: false }); any = true; }
        if (!any) { this.lastY = merge; return null; }
        return merge;
      }
    }
    return y;
  }
}

/* ---- アセンブリの基本ブロック（CFG） ---- */
class CFG {
  constructor(prog, ox) {
    const ins = prog.asm.instrs, n = ins.length;
    const lead = new Set([0]);
    ins.forEach((it, i) => { if (it.target != null) { lead.add(it.target); if (i + 1 < n) lead.add(i + 1); } if ((it.op === 'HALT' || it.op === 'RET') && i + 1 < n) lead.add(i + 1); });
    const starts = [...lead].filter(x => x < n).sort((a, b) => a - b);
    this.blocks = starts.map((s, k) => ({ s, e: (starts[k + 1] || n) - 1 }));
    this.of = new Array(n);
    this.blocks.forEach((b, k) => { for (let i = b.s; i <= b.e; i++) this.of[i] = k; });
    const LH = 15;
    let y = 20;
    const wmax = Math.max(...ins.map(it => tw('@' + it.addr + ' ' + CPU.disasm(prog.words[it.addr])))) + 30;
    this.blocks.forEach(b => { b.x = ox + 30; b.y = y; b.w = wmax; b.h = (b.e - b.s + 1) * LH + 10; y += b.h + 26; });
    this.LH = LH;
    this.edges = [];
    let lane = 0;
    this.blocks.forEach((b, k) => {
      const last = ins[b.e];
      const fall = !(last.op === 'JMP' || last.op === 'HALT' || last.op === 'RET') && k + 1 < this.blocks.length;
      if (fall) this.edges.push({ from: k, to: k + 1, kind: 'fall' });
      if (last.target != null) this.edges.push({ from: k, to: this.of[last.target], kind: last.op === 'JMP' ? 'jmp' : last.op === 'CALL' ? 'call' : 'br', lane: lane++, op: last.op });
    });
    this.bounds = { x: ox, y: 0, w: wmax + 60 + lane * 12 + 30, h: y };
    this.prog = prog;
  }
}

class FlowPanel {
  constructor(body, app) {
    this.app = app; this.lod = 'overview';
    this.bar = U.el('div', 'bar'); body.appendChild(this.bar);
    const split = U.el('div', 'split'); body.appendChild(split);
    const left = U.el('div'); left.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0';
    split.appendChild(left);
    this.cv = new U.CanvasView(left, { pan: true, hint: 'ドラッグで移動・ホイールで拡大', onMove: p => this.hover(p), onLeave: () => { this.hot = null; U.hideTip(this); } });
    this.side = U.el('div', 'side'); split.appendChild(this.side);
  }
  load(prog) {
    this.prog = prog;
    this.fc = prog.c ? buildCharts(prog.c.ast) : null;
    const ox = this.fc ? this.fc.bounds.w + 60 : 0;
    this.cfg = new CFG(prog, ox);
    this.applyWorld();
  }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.applyWorld(); this.update(); }
  applyWorld() {
    if (!this.prog) return;
    const showC = !!this.fc, showA = !this.fc || this.lod === 'full';
    let b;
    if (showC && showA) b = { x: -10, y: -10, w: this.cfg.bounds.x + this.cfg.bounds.w + 20, h: Math.max(this.fc.bounds.h, this.cfg.bounds.h) + 20 };
    else if (showC) b = { x: -10, y: -10, w: this.fc.bounds.w + 20, h: this.fc.bounds.h + 20 };
    else b = { x: this.cfg.bounds.x - 10, y: -10, w: this.cfg.bounds.w + 20, h: this.cfg.bounds.h + 20 };
    this.cv.setWorld(b);
  }
  counts() {
    const sim = this.app.sim, cnt = new Map();
    if (!sim) return cnt;
    this.prog.asm.instrs.forEach(it => { const m = it.meta; if (m && m.idx === 0) { const k = m.node; const o = cnt.get(k) || {}; o[m.role] = (o[m.role] || 0) + sim.aI.count[it.addr]; cnt.set(k, o); } });
    return cnt;
  }
  frame() {
    if (!this.cv.visible() || !this.app.sim || !this.prog || !this.prog.ok) return;
    const c = this.cv.begin(true), sim = this.app.sim;
    c.fillStyle = COL.bg; c.fillRect(-5000, -5000, 12000, 12000);
    const ev = sim.cI ? sim.cI.cur : null;
    if (this.fc) this.drawFC(c, ev, sim);
    if (!this.fc || this.lod === 'full') this.drawCFG(c, sim);
  }
  drawFC(c, ev, sim) {
    const fc = this.fc, cnt = this.lod !== 'overview' ? this.counts() : null;
    // 条件の行き先を予告
    let pred = null;
    if (ev && ev.role === 'cond') pred = sim.cI.test(ev.node.c) ? 'T' : 'F';
    c.lineJoin = 'round';
    for (const e of fc.edges) {
      const act = ev && e.node === ev.node && (e.role === ev.role || (ev.role === 'brk' && e.role === 'brkE') || (ev.role === 'cond' && e.role === pred));
      const isPred = act && ev.role === 'cond';
      c.strokeStyle = act ? (isPred ? COL.pred : COL.act) : COL.edge; c.lineWidth = act ? 2.6 : 1.3;
      c.beginPath(); e.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
      if (e.arrowEnd !== false) { const a = e.pts[e.pts.length - 2], b = e.pts[e.pts.length - 1]; arrow(c, a, b, c.strokeStyle); }
      if (e.label) { c.fillStyle = act ? COL.act : '#9aa3ad'; c.font = '600 11px ' + MONO; const p = e.pts[0], q = e.pts[1]; c.fillText(e.label, (p[0] + q[0]) / 2 + 4, (p[1] + q[1]) / 2 - 4); }
    }
    for (const b of fc.boxes) {
      const act = ev && b.node === ev.node && b.role === ev.role;
      const col = COL[b.kind] || COL.proc;
      c.fillStyle = act ? 'rgba(255,204,0,.18)' : COL.box; c.strokeStyle = act ? COL.act : col; c.lineWidth = act ? 2.6 : 1.4;
      c.beginPath();
      const x = b.x - b.w / 2, y = b.y;
      if (b.kind === 'dec') { c.moveTo(b.x, y); c.lineTo(b.x + b.w / 2, y + b.h / 2); c.lineTo(b.x, y + b.h); c.lineTo(b.x - b.w / 2, y + b.h / 2); c.closePath(); }
      else if (b.kind === 'term' || b.kind === 'loop') U.rr(c, x, y, b.w, b.h, b.h / 2);
      else c.rect(x, y, b.w, b.h);
      c.fill(); c.stroke();
      if (b.kind === 'call') { c.beginPath(); c.moveTo(x + 8, y); c.lineTo(x + 8, y + b.h); c.moveTo(x + b.w - 8, y); c.lineTo(x + b.w - 8, y + b.h); c.stroke(); }
      c.fillStyle = act ? '#fff' : COL.text; c.font = (act ? '700 ' : '') + '12px ' + MONO; c.textAlign = 'center';
      c.fillText(b.label, b.x, y + b.h / 2 + 4); c.textAlign = 'left';
      if (cnt && b.node && cnt.get(b.node) && cnt.get(b.node)[b.role] != null) {
        const n = cnt.get(b.node)[b.role];
        c.fillStyle = n ? '#ffcc00' : '#5d6470'; c.font = '10px ' + MONO; c.fillText('×' + n, b.x + b.w / 2 + 4, y + 10);
      }
      b.hit = { x, y, w: b.w, h: b.h };
    }
    if (this.lod === 'full') { c.fillStyle = '#7d8590'; c.font = '600 12px ' + MONO; c.fillText('C のフローチャート', 4, -2); }
  }
  drawCFG(c, sim) {
    const g = this.cfg, P = this.prog, ins = P.asm.instrs, pc = sim.aI.pc, cur = g.of[pc];
    if (this.fc) { c.fillStyle = '#7d8590'; c.font = '600 12px ' + MONO; c.fillText('アセンブリの基本ブロック（CFG）', g.bounds.x + 30, 10); }
    const lane0 = g.bounds.x + 30 + g.blocks[0].w + 30;
    for (const e of g.edges) {
      const a = g.blocks[e.from], b = g.blocks[e.to];
      const act = e.from === cur && pc === a.e;
      c.strokeStyle = act ? COL.act : e.kind === 'fall' ? COL.edge : e.kind === 'jmp' ? '#6b7f99' : e.kind === 'call' ? '#ff7edb' : '#9a6fa0'; c.lineWidth = act ? 2.4 : 1.2;
      c.beginPath();
      if (e.kind === 'fall') { c.moveTo(a.x + 30, a.y + a.h); c.lineTo(a.x + 30, b.y); c.stroke(); arrow(c, [a.x + 30, a.y + a.h], [a.x + 30, b.y], c.strokeStyle); }
      else {
        const lx = lane0 + e.lane * 12, y1 = a.y + a.h - 8, y2 = b.y + 8;
        const pts = [[a.x + a.w, y1], [lx, y1], [lx, y2], [b.x + b.w, y2]];
        pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); arrow(c, pts[2], pts[3], c.strokeStyle);
        c.fillStyle = c.strokeStyle; c.font = '9px ' + MONO; c.fillText(e.op, lx + 2, y1 - 2);
      }
    }
    g.blocks.forEach((b, k) => {
      c.fillStyle = k === cur ? 'rgba(255,204,0,.10)' : COL.box; c.strokeStyle = k === cur ? COL.act : '#4a525c'; c.lineWidth = k === cur ? 2 : 1;
      c.fillRect(b.x, b.y, b.w, b.h); c.strokeRect(b.x, b.y, b.w, b.h);
      for (let i = b.s; i <= b.e; i++) {
        const yy = b.y + 5 + (i - b.s) * g.LH;
        if (i === pc) { c.fillStyle = 'rgba(255,204,0,.25)'; c.fillRect(b.x + 1, yy, b.w - 2, g.LH); }
        c.fillStyle = i === pc ? '#fff' : '#c5c8ce'; c.font = '11px ' + MONO;
        c.fillText('@' + String(i).padStart(2, '0') + ' ' + CPU.disasm(P.words[i]), b.x + 6, yy + 11);
        if (this.lod !== 'overview') { c.fillStyle = '#5d6470'; c.font = '9px ' + MONO; c.fillText('×' + sim.aI.count[i], b.x + b.w - 30, yy + 11); }
      }
      b.hit = { x: b.x, y: b.y, w: b.w, h: b.h };
    });
  }
  hover(p) {
    if (!this.prog) return;
    const inside = h => h && p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h;
    if (this.fc) for (const b of this.fc.boxes) if (inside(b.hit) && b.node) {
      const def = { cond: b.node.k === 'while' ? 'C-WHILE' : 'C-IF', asg: 'C-ASG', brk: 'C-BREAK', call: 'C-CALL', ret: b.node.k === 'func' ? 'C-FEND' : 'C-RET', halt: b.node.k === 'main' ? 'C-END' : 'C-RET' }[b.role];
      const asm = this.prog.asm.instrs.filter(it => it.meta && it.meta.node === b.node && it.meta.role === b.role).map(it => '@' + it.addr + ' ' + CPU.disasm(this.prog.words[it.addr]));
      const d = U.def(def);
      return U.showTip(p.cx, p.cy, { level: 'flow', id: def, title: b.label, body: d.title + ': ' + d.body + (asm.length ? '\n\n翻訳された命令:\n' + asm.join('\n') : '') }, this);
    }
    for (const b of this.cfg.blocks) if (inside(b.hit)) return U.showTip(p.cx, p.cy, { level: 'flow', title: '基本ブロック @' + b.s + '〜@' + b.e, body: '途中に分岐の入口も出口も無い命令の並び。入口は先頭だけ、出口は末尾だけ。\n\n' + this.prog.asm.instrs.slice(b.s, b.e + 1).map(it => '@' + it.addr + ' ' + CPU.disasm(this.prog.words[it.addr])).join('\n') }, this);
    U.hideTip(this);
  }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok) return;
    const ev = sim.cI ? sim.cI.cur : null;
    const blocks = this.cfg.blocks.length;
    this.bar.innerHTML = (P.c ? '<span>C の構文木 → 構造化フローチャート</span>' : '<span>アセンブリ → 基本ブロック ' + blocks + ' 個</span>') +
      '<span class="mono">' + (ev ? ({ asg: '処理', cond: '判断', back: 'ループへ戻る', skip: '合流へ', brk: 'break', halt: '終了', call: '関数呼び出し', ret: '関数から戻る' }[ev.role]) : (sim.halted ? '停止' : '@' + sim.aI.pc)) + '</span>';
    if (this.lod === 'overview') return;
    let h = '';
    if (ev) {
      const n = ev.node;
      const asm = P.asm.instrs.filter(it => it.meta && it.meta.node === n && it.meta.role === ev.role);
      const cur = sim.aI.cur();
      h += '<h4>いまの箱</h4><div class="box"><div class="mono" style="color:#fff">' + U.esc(n.k === 'while' || n.k === 'if' ? (ev.role === 'cond' ? condText(n.c) + ' ?' : ev.role === 'back' ? '↩ ループの先頭へ' : '合流（else を飛ばす）') : n.k === 'asg' ? exprText(n) : n.k === 'main' ? '終了' : n.k) + '</div>';
      if (ev.role === 'cond') h += '<div class="mono" style="color:var(--warn);margin-top:4px">→ ' + (sim.cI.test(n.c) ? '真' : '偽') + ' の矢印へ進む</div>';
      h += '</div><h4>この箱の機械語</h4><div class="box mono" style="font-size:12px">' + asm.map(it => '<div style="' + (cur && it.addr === cur.addr ? 'color:#fff;background:var(--hl-active)' : 'color:#aab2bc') + '">@' + it.addr + ' ' + U.esc(CPU.disasm(P.words[it.addr])) + '</div>').join('') + '</div>';
    }
    h += '<h4>フローチャートの記号</h4><div class="box" style="font-size:12px;line-height:1.7"><span style="color:' + COL.term + '">⬭ 端子</span> 開始・終了<br><span style="color:' + COL.proc + '">▭ 処理</span> 代入・計算<br><span style="color:' + COL.dec + '">◇ 判断</span> 条件で分かれる（真 / 偽）<br><span style="color:' + COL.loop + '">⬭ 繰り返し</span> while (1)<br><span style="color:' + COL.brk + '">▭ break</span> ループの出口へ<br><span style="color:' + COL.call + '">⊏⊐ 定義済み処理</span> 関数呼び出し（右に関数のフローチャート）<br><span class="dim">×n = 通った回数</span></div>';
    if (P.c) h += '<h4>C → フローチャートの対応</h4><div class="box dim" style="font-size:12px">while (c) S → 判断 c、真なら S を実行して判断へ戻る、偽なら下へ。<br>if (c) A else B → 判断 c、真なら A、偽なら B、下で合流。<br>break → 一番内側のループの出口（偽の矢印）へ合流。</div>';
    this.side.innerHTML = h;
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim || !this.prog) return null;
    const ev = sim.cI ? sim.cI.cur : null;
    if (!ev) return { level: 'flow', title: sim.halted ? '終了' : '基本ブロック @' + this.cfg.blocks[this.cfg.of[sim.aI.pc]].s, body: '' };
    const n = ev.node;
    const t = ev.role === 'cond' ? '◇ ' + condText(n.c) + ' ? → ' + (sim.cI.test(n.c) ? '真' : '偽') : ev.role === 'asg' ? '▭ ' + exprText(n) : ev.role === 'back' ? '↩ ループの先頭へ' : ev.role === 'halt' ? '⬭ 終了' : ev.role === 'brk' ? '▭ break' : ev.role === 'call' ? '⊏⊐ ' + n.name + '()' : ev.role === 'ret' ? '⬭ 戻る' : '合流へ';
    return { level: 'flow', title: t, body: '' };
  }
}
function arrow(c, a, b, col) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  c.fillStyle = col; c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0] - ux * 7 - uy * 4, b[1] - uy * 7 + ux * 4); c.lineTo(b[0] - ux * 7 + uy * 4, b[1] - uy * 7 - ux * 4); c.fill();
}
window.FlowPanel = FlowPanel;
})();
