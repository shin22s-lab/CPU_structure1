/* 共通の小道具: DOM 生成, ツールチップ, キャンバス (DPR / カメラ), 定義の参照 */
(function () {
'use strict';
const CPU = window.CPU5;
const U = {};
U.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
U.el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
U.bin = CPU.bin;
U.bits = (v, n, cls) => { let s = ''; const b = CPU.bin(v, n); for (const c of b) s += '<span class="bitc b' + c + '">' + c + '</span>'; return s; };
U.fieldBits = w => {
  const b = CPU.bin(w, CPU.IW), op = (w >> 12) & 15, useS = [5, 6, 7, 12, 13].includes(op);
  return '<span class="k-op">' + b.slice(0, 4) + '</span> <span class="k-rr">' + b.slice(4, 7) + '</span> ' +
    (useS ? '<span class="k-ss">' + b.slice(7, 10) + '</span> <span class="faint">' + b.slice(10) + '</span>' : '<span class="k-ad">' + b.slice(7) + '</span>');
};
U.fmtBits = w => { const b = CPU.bin(w, 16), op = (w >> 12) & 15; return [5, 6, 7, 12, 13].includes(op) ? b.slice(0, 4) + ' ' + b.slice(4, 7) + ' ' + b.slice(7, 10) + ' ' + b.slice(10) : b.slice(0, 4) + ' ' + b.slice(4, 7) + ' ' + b.slice(7); };
U.hex = (w, n) => w.toString(16).toUpperCase().padStart(n || 4, '0');
U.LVNAME = { c: 'C', t: '翻訳', asm: 'ASM', mc: '機械語', circ: '回路', tm: 'TM', tmd: 'TM 設計', flow: 'フロー', math: '数学' };
U.LVCOLOR = { c: '#569cd6', t: '#569cd6', asm: '#c586c0', mc: '#ce9178', circ: '#4ec9b0', tm: '#dcdcaa', tmd: '#dcdcaa', flow: '#7fd4ff' };
U.PHCOLOR = { fetch: '#9aa0a6', decode: '#ce9178', operand: '#c792ea', mem: '#5fb3ff', alu: '#ffcf4d', test: '#4ec9b0', flag: '#ff9e64', clean: '#6b7380', adv: '#8fd16a', jump: '#f78c6c', call: '#ff7edb', halt: '#f14c4c' };

/* ---- ツールチップ ---- */
const tip = document.getElementById('tip');
let tipOwner = null;
U.showTip = (x, y, o, owner) => {
  // o: {level, title, body, value} or defId
  if (typeof o === 'string') o = U.defTip(o);
  if (!o) return U.hideTip();
  tipOwner = owner || null;
  tip.innerHTML = (o.level ? '<div class="tl">' + U.esc(U.LVNAME[o.level] || o.level) + (o.id ? ' · ' + U.esc(o.id) : '') + '</div>' : '') +
    '<div class="tt">' + U.esc(o.title) + '</div>' + (o.body ? '<pre>' + U.esc(o.body) + '</pre>' : '') + (o.value ? '<div class="tv">' + U.esc(o.value) + '</div>' : '');
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let tx = x + 14, ty = y + 16;
  if (tx + r.width > innerWidth - 8) tx = Math.max(8, x - r.width - 10);
  if (ty + r.height > innerHeight - 8) ty = Math.max(8, y - r.height - 10);
  tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
};
U.hideTip = (owner) => { if (owner && tipOwner !== owner) return; tip.hidden = true; tipOwner = null; };
U.defTip = (id, value) => { const d = CPU.DEFS[id]; if (!d) return null; return { level: d.level, id: d.id, title: d.title, body: d.body, value }; };
U.def = id => CPU.DEFS[id];

/* ---- キャンバス (ResizeObserver + DPR + パン/ズーム) ---- */
class CanvasView {
  constructor(parent, opts) {
    this.opts = opts || {};
    this.wrap = U.el('div', 'cv-wrap');
    this.cv = U.el('canvas');
    this.wrap.appendChild(this.cv);
    if (this.opts.hint) this.wrap.appendChild(U.el('div', 'cv-hint', this.opts.hint));
    parent.appendChild(this.wrap);
    this.ctx = this.cv.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.cam = { x: 0, y: 0, s: 1 };
    this.userCam = false;
    this.world = null;   // {x,y,w,h} を設定するとフィット
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.mouse = null;
    if (this.opts.pan) this.bindPan();
    this.cv.addEventListener('pointermove', e => { const p = this.local(e); this.mouse = p; this.opts.onMove && this.opts.onMove(p, e); });
    this.cv.addEventListener('pointerleave', () => { this.mouse = null; this.opts.onLeave && this.opts.onLeave(); });
    this.cv.addEventListener('click', e => { if (this.dragged) return; this.opts.onClick && this.opts.onClick(this.local(e), e); });
  }
  visible() { return this.wrap.offsetParent !== null && this.w > 2 && this.h > 2; }
  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    if (!this.userCam) this.fit();
    this.dirty = true;
  }
  setWorld(b, keep) { this.world = b; if (!keep) this.userCam = false; if (!this.userCam) this.fit(); }
  fit() {
    const b = this.world; if (!b) return;
    const pad = this.opts.pad != null ? this.opts.pad : 10;
    const s = Math.min((this.w - pad * 2) / b.w, (this.h - pad * 2) / b.h);
    this.cam.s = s > 0 ? s : 1;
    this.cam.x = b.x - (this.w / this.cam.s - b.w) / 2;
    this.cam.y = b.y - (this.h / this.cam.s - b.h) / 2;
  }
  local(e) { const r = this.cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, x: sx / this.cam.s + this.cam.x, y: sy / this.cam.s + this.cam.y, cx: e.clientX, cy: e.clientY }; }
  begin(worldSpace) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (worldSpace) c.setTransform(this.dpr * this.cam.s, 0, 0, this.dpr * this.cam.s, -this.cam.x * this.cam.s * this.dpr, -this.cam.y * this.cam.s * this.dpr);
    return c;
  }
  screen() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
  bindPan() {
    let drag = null;
    this.cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y }; this.dragged = false; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragged = true;
      if (this.dragged) { this.cam.x = drag.cx - dx / this.cam.s; this.cam.y = drag.cy - dy / this.cam.s; this.userCam = true; }
    });
    this.cv.addEventListener('pointerup', () => { drag = null; setTimeout(() => this.dragged = false, 0); });
    this.cv.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.local(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.max(0.05, Math.min(12, this.cam.s * k));
      this.cam.x = p.x - p.sx / ns; this.cam.y = p.y - p.sy / ns; this.cam.s = ns; this.userCam = true;
    }, { passive: false });
    this.cv.addEventListener('dblclick', () => { this.userCam = false; this.fit(); });
  }
}
U.CanvasView = CanvasView;

/* ---- 角丸 ---- */
U.rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

window.U = U;
})();
