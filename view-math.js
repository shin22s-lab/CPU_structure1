/* 数学パネル（7 つ目のビュー）
 *   プログラムが「数学として何をしているか」を描く。
 *   C の変数の履歴（C の動作が 1 つ終わるたびに記録）から描くので、5 層の実行と同期する。
 *   ニュートン法: 接線と反復 / オイラー法: 厳密解・実数のオイラー法・CPU の値 / 互除法: 長方形の正方形分割
 *   フィボナッチ: 比 → 黄金比 / ソート: 配列の棒 / 篩: 数の表 / 素因数分解 / その他: 変数の時系列 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const MONO = '"JetBrains Mono", Consolas, Menlo, monospace';
const K = { bg: '#16181b', grid: '#262a30', axis: '#5d6470', text: '#9aa3ad', hi: '#ffcc00', a: '#4ec9b0', b: '#c586c0', c: '#569cd6', d: '#f78c6c', e: '#dcdcaa', soft: 'rgba(255,204,0,.35)' };
const PHI = (1 + Math.sqrt(5)) / 2;

const MD = (id, title, body) => { CPU.DEFS[id] = { id, level: 'math', title, body }; };
MD('X-NEWTON', 'ニュートン法', 'f(x) = 0 の解を、接線と x 軸の交点で近似していく: x_{n+1} = x_n − f(x_n)/f′(x_n)。\nf(x) = x² − N なら x_{n+1} = (x_n + N/x_n)/2（バビロニアの方法）。解の近くでは誤差がおよそ 2 乗ずつ小さくなる（2 次収束）。\n整数版は x が減らなくなったら止め、⌊√N⌋ を得る。');
MD('X-EULER', 'オイラー法', 'dy/dt = F(t, y) を、傾き F で Δt だけ進むことの繰り返しで近似する: y_{n+1} = y_n + Δt·F(t_n, y_n)。\n大域誤差は Δt に比例する（1 次の方法）。この CPU では整数で計算するので、さらに切り捨ての誤差が加わる。');
MD('X-GCD', 'ユークリッドの互除法', 'gcd(a, b) = gcd(b, a mod b)、gcd(a, 0) = a。\n図では a × b の長方形から一辺 b の正方形をできるだけ切り取り、残りの長方形で繰り返す。最後に残る正方形の一辺が最大公約数。');
MD('X-FIB', 'フィボナッチ数と黄金比', 'F(k+1) = F(k) + F(k−1)。隣どうしの比 F(k+1)/F(k) は黄金比 φ = (1 + √5)/2 ≈ 1.6180339887 に近づく（φ² = φ + 1 の正の解）。');
MD('X-SORT', 'バブルソート', '隣どうしを比べ、逆順なら入れ替える。1 周するごとに最大値が右端に決まる。n 個なら比較は n(n−1)/2 回（10 個で 45 回）。');
MD('X-SIEVE', 'エラトステネスの篩', '小さい順に、まだ消えていない数 i を素数とし、i·i, i·i+i, … を消していく。i·i より小さい倍数は、それより小さい素数ですでに消えている。');
MD('X-FACTOR', '素因数分解（試し割り）', 'd = 2, 3, 4, … で割れるだけ割る。割れる d は必ず素数（それより小さい素因数で割り切ってあるため）。n が 1 になったら終わり。');
MD('X-SERIES', '変数の時系列', 'C の動作が 1 つ終わるたびに変数の値を記録し、時間（C の動作の回数）に沿って並べる。コラッツ数列 n → n/2（偶数）/ 3n+1（奇数）は、どの n から始めても 1 に着くと予想されているが、証明されていない（コラッツ予想）。');

class MathPanel {
  constructor(body, app) {
    this.app = app; this.lod = 'overview';
    this.bar = U.el('div', 'bar'); body.appendChild(this.bar);
    const split = U.el('div', 'split'); body.appendChild(split);
    const left = U.el('div'); left.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0';
    split.appendChild(left);
    this.cv = new U.CanvasView(left, { onMove: p => this.hover(p), onLeave: () => U.hideTip(this) });
    this.side = U.el('div', 'side'); split.appendChild(this.side);
    this.hist = [];
    this.dirty = true;
  }
  attach(sim) {
    sim.on((kind, s) => {
      if (kind === 'reset') { this.hist = []; this.snap(s, true); }
      else if (kind === 'c' || (kind === 'instr' && !s.cI)) this.snap(s);
      this.dirty = true;
    });
    this.hist = []; this.snap(sim, true);
  }
  env(sim) {
    if (sim.cI) return { env: Object.assign({}, sim.cI.env), arr: Object.fromEntries(Object.entries(sim.cI.arr).map(([k, v]) => [k, v.slice()])) };
    const e = {}; CPU.REGN.forEach((r, i) => e[r] = sim.aI.R[i]);
    return { env: e, arr: { RAM: sim.aI.ram.slice() } };
  }
  snap(sim, force) {
    const s = this.env(sim), last = this.hist[this.hist.length - 1];
    const same = last && Object.keys(s.env).every(k => last.env[k] === s.env[k]) && Object.keys(s.arr).every(k => last.arr[k].every((v, i) => v === s.arr[k][i]));
    if (!force && same) return;
    s.k = sim.cSteps; s.instr = sim.instr;
    this.hist.push(s);
    if (this.hist.length > 6000) this.hist.splice(1, 1);
  }
  load(prog, meta) {
    this.prog = prog; this.meta = meta;
    this.viz = (meta && meta.viz) || { type: 'series' };
    if (!prog.c) this.viz = { type: 'series' };
    this.dirty = true;
  }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.dirty = true; this.update(); }
  frame() {
    if (!this.cv.visible() || !this.app.sim || !this.prog || !this.prog.ok) return;
    if (!this.dirty && !this.cv.dirty) return;
    this.dirty = false; this.cv.dirty = false;
    const c = this.cv.begin(false), W = this.cv.w, H = this.cv.h;
    c.fillStyle = K.bg; c.fillRect(0, 0, W, H);
    this.pts = [];
    const f = { newton: this.newton, ode: this.ode, gcd: this.gcd, fib: this.fib, array: this.array, sieve: this.sieve, factor: this.factor, series: this.series }[this.viz.type] || this.series;
    f.call(this, c, W, H);
  }
  /* ---------- 共通の小道具 ---------- */
  frameRect(W, H) { return { x: 62, y: 44, w: Math.max(40, W - 84), h: Math.max(40, H - 80) }; }
  scale(r, x0, x1, y0, y1, logY) {
    const ly = v => Math.log10(Math.max(1e-9, v));
    return {
      X: x => r.x + (x - x0) / (x1 - x0 || 1) * r.w,
      Y: logY ? y => r.y + r.h - (ly(y) - ly(y0)) / (ly(y1) - ly(y0) || 1) * r.h : y => r.y + r.h - (y - y0) / (y1 - y0 || 1) * r.h,
      x0, x1, y0, y1, logY,
    };
  }
  nice(a, b, n) {
    const span = b - a || 1, step0 = span / n, p = Math.pow(10, Math.floor(Math.log10(step0))), m = step0 / p;
    const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  axes(c, r, S, xl, yl) {
    c.strokeStyle = K.grid; c.lineWidth = 1; c.font = '10px ' + MONO; c.fillStyle = K.text;
    const xt = this.nice(S.x0, S.x1, Math.max(2, Math.floor(r.w / 80)));
    const yt = S.logY ? this.logTicks(S.y0, S.y1) : this.nice(S.y0, S.y1, Math.max(2, Math.floor(r.h / 40)));
    c.textAlign = 'center';
    for (const v of xt) { const x = S.X(v); c.beginPath(); c.moveTo(x, r.y); c.lineTo(x, r.y + r.h); c.stroke(); c.fillText(fmt(v), x, r.y + r.h + 13); }
    c.textAlign = 'right';
    for (const v of yt) { const y = S.Y(v); c.beginPath(); c.moveTo(r.x, y); c.lineTo(r.x + r.w, y); c.stroke(); c.fillText(fmt(v), r.x - 5, y + 3); }
    c.textAlign = 'left';
    c.strokeStyle = K.axis; c.strokeRect(r.x, r.y, r.w, r.h);
    if (xl) { c.fillStyle = K.text; c.fillText(xl, r.x + r.w - c.measureText(xl).width, r.y + r.h + 26); }
    if (yl) { c.fillStyle = K.text; c.fillText(yl, r.x - 40, r.y - 8); }
  }
  logTicks(a, b) { const o = []; for (let e = Math.floor(Math.log10(Math.max(a, 1e-9))); e <= Math.ceil(Math.log10(b)); e++) o.push(Math.pow(10, e)); return o.filter(v => v >= a * 0.999 && v <= b * 1.001); }
  dot(c, x, y, col, r, info) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r || 3.5, 0, 7); c.fill(); if (info) this.pts.push({ x, y, info }); }
  title(c, s, sub) { c.fillStyle = '#e6e6e6'; c.font = '600 12px ' + MONO; c.fillText(s, 12, 18); if (sub) { const w = c.measureText(s).width; c.fillStyle = K.text; c.font = '11px ' + MONO; c.fillText(sub, 24 + w, 18); } }
  legend(c, items, x, y) { c.font = '11px ' + MONO; items.forEach(([col, t], i) => { c.fillStyle = col; c.fillRect(x, y + i * 16 - 8, 10, 3); c.fillStyle = K.text; c.fillText(t, x + 16, y + i * 16 - 4); }); }
  cur() { return this.hist[this.hist.length - 1] || { env: {}, arr: {} }; }

  /* ---------- ニュートン法 ---------- */
  newtonData() {
    const v = this.viz, xs = [];
    for (const h of this.hist) { const x = h.env[v.x]; if (x !== undefined && xs[xs.length - 1] !== x) xs.push(x); }
    return { N: this.cur().env[v.N], xs };
  }
  newton(c, W, H) {
    const { N, xs } = this.newtonData(), v = this.viz, r = this.frameRect(W, H);
    const root = Math.sqrt(N), xn = xs[xs.length - 1];
    this.title(c, 'ニュートン法  f(x) = x² − ' + N, 'x_' + (xs.length - 1) + ' = ' + xn + (v.scale ? '  → ' + (xn / v.scale).toFixed(4) + '（√2 = 1.4142…）' : ''));
    const x1 = Math.max(root * 1.6, xn * 1.25), x0 = 0;
    const f = x => x * x - N;
    const y0 = -N, y1 = f(x1);
    const S = this.scale(r, x0, x1, y0, y1);
    this.axes(c, r, S, 'x', 'f(x)');
    c.strokeStyle = K.axis; c.lineWidth = 1.2; c.beginPath(); c.moveTo(r.x, S.Y(0)); c.lineTo(r.x + r.w, S.Y(0)); c.stroke();
    c.strokeStyle = K.c; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= 200; i++) { const x = x0 + (x1 - x0) * i / 200; const px = S.X(x), py = S.Y(f(x)); i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
    c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    xs.forEach((x, k) => {
      if (x > x1 * 1.5) return;
      const last = k === xs.length - 1, a = last ? 1 : Math.max(0.25, 1 - (xs.length - 1 - k) * 0.18);
      c.globalAlpha = a;
      c.setLineDash([3, 3]); c.strokeStyle = K.text; c.lineWidth = 1; c.beginPath(); c.moveTo(S.X(x), S.Y(0)); c.lineTo(S.X(x), S.Y(f(x))); c.stroke(); c.setLineDash([]);
      const xNext = (x + N / x) / 2;
      c.strokeStyle = last ? K.hi : K.d; c.lineWidth = last ? 2 : 1.4;
      const tx = t => f(x) + 2 * x * (t - x);
      c.beginPath(); c.moveTo(S.X(Math.min(x1, x * 1.15)), S.Y(tx(Math.min(x1, x * 1.15)))); c.lineTo(S.X(xNext * 0.9), S.Y(tx(xNext * 0.9))); c.stroke();
      this.dot(c, S.X(x), S.Y(f(x)), last ? K.hi : K.d, last ? 5 : 3.5, 'x_' + k + ' = ' + x + '\nf(x_' + k + ') = ' + f(x) + '\n接線と x 軸の交点 = (x + N/x)/2 = ' + xNext.toFixed(2));
      this.dot(c, S.X(x), S.Y(0), last ? K.hi : K.a, 3);
      c.globalAlpha = 1;
    });
    this.dot(c, S.X(root), S.Y(0), '#fff', 3, '√N = ' + root.toFixed(4));
    c.restore();
    c.fillStyle = '#fff'; c.font = '10px ' + MONO; c.fillText('√N', S.X(root) - 8, S.Y(0) + 16);
    this.legend(c, [[K.c, 'f(x) = x² − N'], [K.d, '接線（前の反復）'], [K.hi, 'いまの接線 → 次の x']], r.x + 10, r.y + 16);
  }
  /* ---------- オイラー法 ---------- */
  odeData() {
    const v = this.viz, pts = [];
    let lastN = null;
    for (const h of this.hist) { const n = h.env[v.t.n]; if (n !== lastN) { pts.push({ t: (v.t.n0 - n) * v.t.dt, y: h.env[v.y] }); lastN = n; } }
    if (pts.length) pts[pts.length - 1].y = this.cur().env[v.y];
    return pts;
  }
  exactFn() {
    const v = this.viz;
    if (v.exact === 'decay') return t => v.y0 * Math.exp(-v.k * t);
    if (v.exact === 'fall') return t => v.g * t * t / 2;
    if (v.exact === 'logistic') return t => v.K / (1 + (v.K - v.y0) / v.y0 * Math.exp(-v.r * t));
  }
  realEuler() {
    const v = this.viz, dt = v.t.dt, n0 = v.t.n0, o = [];
    if (v.exact === 'decay') { let y = v.y0; for (let i = 0; i <= n0; i++) { o.push({ t: i * dt, y }); y = y - dt * v.k * y; } }
    if (v.exact === 'fall') { let x = 0, vv = 0; for (let i = 0; i <= n0; i++) { o.push({ t: i * dt, y: x }); x += vv * dt; vv += v.g * dt; } }
    if (v.exact === 'logistic') { let y = v.y0; for (let i = 0; i <= n0; i++) { o.push({ t: i * dt, y }); y = y + dt * v.r * y * (1 - y / v.K); } }
    return o;
  }
  ode(c, W, H) {
    const v = this.viz, pts = this.odeData(), ex = this.exactFn(), re = this.realEuler(), r = this.frameRect(W, H);
    const T = v.t.n0 * v.t.dt, ys = re.map(p => p.y).concat(pts.map(p => p.y));
    for (let i = 0; i <= 50; i++) ys.push(ex(T * i / 50));
    const y0 = Math.min(0, ...ys), y1 = Math.max(...ys) * 1.08;
    const S = this.scale(r, 0, T, y0, y1);
    const last = pts[pts.length - 1] || { t: 0, y: 0 };
    this.title(c, 'オイラー法  ' + (v.title || ''), 't = ' + fmt(last.t) + '  CPU: ' + last.y + '  厳密解: ' + ex(last.t).toFixed(2));
    this.axes(c, r, S, 't', v.y);
    c.strokeStyle = K.a; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= 200; i++) { const t = T * i / 200, px = S.X(t), py = S.Y(ex(t)); i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
    c.strokeStyle = K.b; c.lineWidth = 1.2; c.setLineDash([4, 3]); c.beginPath();
    re.forEach((p, i) => { const px = S.X(p.t), py = S.Y(p.y); i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); c.setLineDash([]);
    re.forEach(p => this.dot(c, S.X(p.t), S.Y(p.y), K.b, 2.5, '実数のオイラー法\nt = ' + fmt(p.t) + '  y = ' + p.y.toFixed(3)));
    c.strokeStyle = K.hi; c.lineWidth = 1.5; c.beginPath();
    pts.forEach((p, i) => { const px = S.X(p.t), py = S.Y(p.y); i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke();
    pts.forEach((p, i) => this.dot(c, S.X(p.t), S.Y(p.y), K.hi, i === pts.length - 1 ? 5 : 3.5, 'CPU（整数）\nt = ' + fmt(p.t) + '  ' + v.y + ' = ' + p.y + '\n厳密解 ' + ex(p.t).toFixed(3) + '  誤差 ' + (p.y - ex(p.t)).toFixed(3)));
    this.legend(c, [[K.a, '厳密解'], [K.b, '実数で計算したオイラー法'], [K.hi, 'この CPU（16bit 整数）']], r.x + 10, r.y + 16);
  }
  /* ---------- 互除法 ---------- */
  gcd(c, W, H) {
    const v = this.viz, first = this.hist[0] ? this.hist[0].env : {}, A = first[v.a], B = first[v.b];
    const cur = this.cur().env, a = cur[v.a], b = cur[v.b];
    this.title(c, 'ユークリッドの互除法  gcd(' + A + ', ' + B + ')', 'いま (a, b) = (' + a + ', ' + b + ')' + (b === 0 ? '  → 答え ' + a : ''));
    const steps = []; { let x = A, y = B; while (y) { steps.push([x, y, Math.floor(x / y), x % y]); const t = x % y; x = y; y = t; } }
    const done = steps.findIndex(s => s[0] === a && s[1] === b);
    const nDone = b === 0 ? steps.length : done < 0 ? 0 : done;
    const r = { x: 20, y: 36, w: W - 40 - (this.lod === 'overview' ? 0 : 230), h: H - 50 };
    const sc = Math.min(r.w / A, r.h / B);
    let x = r.x, y = r.y, w = A, h = B, horiz = true;
    c.strokeStyle = K.axis; c.strokeRect(r.x, r.y, A * sc, B * sc);
    const cols = [K.c, K.b, K.a, K.d, K.e, '#9cdcfe', '#ff7edb'];
    steps.forEach((st, i) => {
      const side = st[1], q = st[2];
      for (let j = 0; j < q; j++) {
        const sx = horiz ? x + j * side * sc : x, sy = horiz ? y : y + j * side * sc;
        c.fillStyle = i < nDone ? cols[i % cols.length] + '55' : 'transparent';
        c.strokeStyle = i < nDone ? cols[i % cols.length] : '#30343a'; c.lineWidth = i === nDone - 1 ? 2 : 1;
        c.fillRect(sx, sy, side * sc, side * sc); c.strokeRect(sx, sy, side * sc, side * sc);
        if (side * sc > 26 && i < nDone) { c.fillStyle = '#e6e6e6'; c.font = '10px ' + MONO; c.fillText(String(side), sx + 4, sy + 13); }
        this.pts.push({ x: sx + side * sc / 2, y: sy + side * sc / 2, info: st[0] + ' = ' + q + '·' + side + ' + ' + st[3] + '\n一辺 ' + side + ' の正方形 ' + q + ' 個' });
      }
      if (horiz) { x += q * side * sc; w = st[3]; h = side; } else { y += q * side * sc; h = st[3]; w = side; }
      horiz = !horiz;
    });
    c.font = '11px ' + MONO; c.fillStyle = K.text;
    if (this.lod !== 'overview') steps.forEach((st, i) => { c.fillStyle = i < nDone ? '#e6e6e6' : K.text; c.fillText(st[0] + ' = ' + st[2] + ' × ' + st[1] + ' + ' + st[3], r.x + A * sc + 16, r.y + 14 + i * 16); });
  }
  /* ---------- フィボナッチ ---------- */
  fib(c, W, H) {
    const v = this.viz, pairs = [];
    for (const h of this.hist) { const p = [h.env[v.a], h.env[v.b]]; const l = pairs[pairs.length - 1]; if (!l || l[1] !== p[1]) pairs.push(p); }
    const r = this.frameRect(W, H), cur = this.cur().env, ratio = cur[v.a] ? cur[v.b] / cur[v.a] : NaN;
    this.title(c, 'フィボナッチ数の比 F(k+1)/F(k) → φ', 'いま ' + cur[v.b] + ' / ' + cur[v.a] + ' = ' + (isNaN(ratio) ? '—' : ratio.toFixed(8)) + '   φ = 1.61803399');
    const pts = pairs.filter(p => p[0] > 0).map((p, i) => ({ k: i + 1, q: p[1] / p[0] }));
    const S = this.scale(r, 0, Math.max(10, pts.length + 1), 0.9, 2.1);
    this.axes(c, r, S, 'k', '比');
    c.strokeStyle = K.a; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(r.x, S.Y(PHI)); c.lineTo(r.x + r.w, S.Y(PHI)); c.stroke(); c.setLineDash([]);
    c.strokeStyle = K.hi; c.lineWidth = 1.4; c.beginPath(); pts.forEach((p, i) => { i ? c.lineTo(S.X(p.k), S.Y(p.q)) : c.moveTo(S.X(p.k), S.Y(p.q)); }); c.stroke();
    pts.forEach((p, i) => this.dot(c, S.X(p.k), S.Y(p.q), K.hi, i === pts.length - 1 ? 5 : 3, 'F(' + (p.k + 1) + ')/F(' + p.k + ') = ' + p.q.toFixed(8) + '\nφ との差 ' + Math.abs(p.q - PHI).toExponential(2)));
    this.legend(c, [[K.a, 'φ = (1+√5)/2'], [K.hi, 'b / a']], r.x + r.w - 170, r.y + 16);
  }
  /* ---------- 配列（ソート） ---------- */
  array(c, W, H) {
    const v = this.viz, cur = this.cur(), arr = cur.arr[v.arr] || [], n = arr.length;
    let swaps = 0; for (let i = 1; i < this.hist.length; i++) { const a0 = this.hist[i - 1].arr[v.arr], a1 = this.hist[i].arr[v.arr]; if (a0 && a1 && a0.some((x, j) => x !== a1[j])) swaps++; }
    const sorted = arr.every((x, i) => i === 0 || arr[i - 1] <= x);
    this.title(c, 'バブルソート  ' + v.arr + '[' + n + ']', '書き換え ' + swaps + ' 回' + (sorted ? '  ✓ 整列済み' : ''));
    const r = { x: 30, y: 40, w: W - 60, h: H - 70 }, mx = Math.max(1, ...arr), bw = r.w / n;
    const idx = (v.idx || []).map(k => cur.env[k]), mark = cur.env[v.mark];
    arr.forEach((x, i) => {
      const h = x / mx * (r.h - 16), bx = r.x + i * bw + 3, by = r.y + r.h - h;
      const fixed = mark !== undefined && i > mark;
      c.fillStyle = idx.includes(i) ? K.hi : fixed ? K.a : K.c;
      c.fillRect(bx, by, bw - 6, h);
      c.fillStyle = '#e6e6e6'; c.font = '11px ' + MONO; c.textAlign = 'center'; c.fillText(String(x), bx + (bw - 6) / 2, by - 4);
      c.fillStyle = K.text; c.fillText('[' + i + ']', bx + (bw - 6) / 2, r.y + r.h + 14); c.textAlign = 'left';
      this.pts.push({ x: bx + bw / 2, y: by + h / 2, info: v.arr + '[' + i + '] = ' + x + (idx.includes(i) ? '\nいま比べている' : fixed ? '\n位置が確定' : '') });
    });
    this.legend(c, [[K.hi, '比べている 2 つ（j, k）'], [K.a, '確定した右側（i より右）']], r.x + 6, r.y + 6);
  }
  /* ---------- 篩 ---------- */
  sieve(c, W, H) {
    const v = this.viz, cur = this.cur(), p = cur.arr[v.arr] || [], N = v.N, i = cur.env[v.i], j = cur.env[v.j];
    const primes = []; for (let k = 2; k < Math.min(i, N); k++) if (!p[k]) primes.push(k);
    this.title(c, 'エラトステネスの篩  2〜' + (N - 1), '素数 ' + primes.length + ' 個見つかった' + (i >= N ? '（完了）' : '  いま i = ' + i));
    const cols = 10, rows = Math.ceil(N / cols), cw = Math.min(64, (W - 40) / cols), ch = Math.min(40, (H - 50) / rows);
    for (let k = 0; k < N; k++) {
      const x = 20 + (k % cols) * cw, y = 30 + Math.floor(k / cols) * ch;
      const comp = p[k] === 1, isP = k >= 2 && k < i && !comp, isI = k === i, isJ = k === j && j < N;
      c.fillStyle = isI ? 'rgba(255,204,0,.35)' : isJ ? 'rgba(247,140,108,.35)' : isP ? 'rgba(78,201,176,.22)' : comp ? '#1d2025' : '#22262c';
      c.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      c.fillStyle = k < 2 ? '#3a3f46' : comp ? '#5d6470' : isP ? '#4ec9b0' : '#d4d4d4';
      c.font = (isP ? '700 ' : '') + Math.round(Math.min(cw, ch) * 0.38) + 'px ' + MONO; c.textAlign = 'center';
      c.fillText(String(k), x + cw / 2, y + ch * 0.62); c.textAlign = 'left';
      if (comp) { c.strokeStyle = '#5d6470'; c.beginPath(); c.moveTo(x + 6, y + ch - 6); c.lineTo(x + cw - 6, y + 6); c.stroke(); }
      this.pts.push({ x: x + cw / 2, y: y + ch / 2, info: k + (k < 2 ? '（対象外）' : comp ? ' は合成数（' + v.arr + '[' + k + '] = 1）' : k < i ? ' は素数' : ' はまだ調べていない') });
    }
  }
  /* ---------- 素因数分解 ---------- */
  factor(c, W, H) {
    const v = this.viz, cur = this.cur(), f = cur.arr[v.arr] || [], k = cur.env[v.k], n = cur.env[v.n], d = cur.env[v.d];
    const fs = f.slice(0, k);
    this.title(c, '素因数分解  ' + v.n0, 'n = ' + n + '  d = ' + d);
    c.font = '600 22px ' + MONO; c.fillStyle = '#e6e6e6';
    c.fillText(v.n0 + ' = ' + (fs.length ? fs.join(' × ') : '') + (n > 1 ? (fs.length ? ' × ' : '') + n : ''), 20, 70);
    let x = 20, y = 120, m = v.n0;
    c.font = '13px ' + MONO;
    fs.forEach((p, i) => {
      c.fillStyle = K.text; c.fillText(m + ' ÷ ' + p + ' = ' + (m / p), x, y + i * 22);
      c.fillStyle = K.hi; c.fillText('素因数 ' + p, x + 220, y + i * 22);
      m = m / p;
    });
    if (n > 1) { c.fillStyle = K.c; c.fillText('いま ' + n + ' を ' + d + ' で割れるか調べている', x, y + fs.length * 22 + 8); }
  }
  /* ---------- 時系列 ---------- */
  series(c, W, H) {
    const v = this.viz, names = v.vars || Object.keys(this.cur().env).filter(k => !/^[a-h]$/.test(k) || !this.prog.c);
    const r = this.frameRect(W, H), hs = this.hist;
    let ymax = 1, ymin = v.log ? 1 : 0;
    for (const h of hs) for (const n of names) ymax = Math.max(ymax, h.env[n] || 0);
    const S = this.scale(r, 0, Math.max(10, hs.length - 1), ymin, ymax * 1.08, v.log);
    this.title(c, v.title || '変数の時系列', names.map(n => n + ' = ' + this.cur().env[n]).join('  '));
    this.axes(c, r, S, 'C の動作の回数', v.log ? '値（対数）' : '値');
    const cols = [K.hi, K.a, K.c, K.b, K.d, K.e, '#9cdcfe', '#ff7edb'];
    names.forEach((n, j) => {
      c.strokeStyle = cols[j % cols.length]; c.lineWidth = 1.6; c.beginPath();
      hs.forEach((h, i) => { const y = Math.max(ymin, h.env[n] || 0); i ? c.lineTo(S.X(i), S.Y(y)) : c.moveTo(S.X(i), S.Y(y)); });
      c.stroke();
      const step = Math.max(1, Math.floor(hs.length / 300));
      hs.forEach((h, i) => { if (i % step === 0 || i === hs.length - 1) this.pts.push({ x: S.X(i), y: S.Y(Math.max(ymin, h.env[n] || 0)), info: n + ' = ' + h.env[n] + '\n（' + i + ' 番目の記録）' }); });
    });
    this.legend(c, names.map((n, j) => [cols[j % cols.length], n]), r.x + 10, r.y + 16);
  }
  hover(p) {
    if (!this.pts) return;
    let best = null, bd = 100;
    for (const q of this.pts) { const d = (q.x - p.sx) ** 2 + (q.y - p.sy) ** 2; if (d < bd) { bd = d; best = q; } }
    if (best) U.showTip(p.cx, p.cy, { level: 'math', title: '数学ビュー', body: best.info }, this); else U.hideTip(this);
  }
  defId() { return { newton: 'X-NEWTON', ode: 'X-EULER', gcd: 'X-GCD', fib: 'X-FIB', array: 'X-SORT', sieve: 'X-SIEVE', factor: 'X-FACTOR' }[this.viz.type] || 'X-SERIES'; }
  update() {
    if (!this.prog || !this.prog.ok) return;
    this.dirty = true;
    const d = U.def(this.defId());
    this.bar.innerHTML = '<span><b>' + U.esc(d.title) + '</b></span><span class="dim">記録 ' + this.hist.length + ' 点</span>';
    if (this.lod === 'overview') return;
    let h = '<h4>数学の定義</h4><div class="box"><span class="deflink" data-def="' + d.id + '">' + U.esc(d.title) + '</span><pre class="def">' + U.esc(d.body) + '</pre></div>';
    if (this.viz.type === 'newton') {
      const { N, xs } = this.newtonData(), root = Math.sqrt(N);
      h += '<h4>式 ⇔ C</h4><div class="box"><pre class="def">x_{n+1} = (x_n + N / x_n) / 2\n   ⇔  y = N / x;  y = y + x;  y >>= 1;  x = y;</pre></div>';
      h += '<h4>反復（誤差がほぼ 2 乗ずつ縮む）</h4><div class="box"><table class="watch"><tr><td>n</td><td>x_n</td><td>x_n − √N</td></tr>' + xs.map((x, k) => '<tr><td>' + k + '</td><td>' + x + '</td><td>' + (x - root).toFixed(3) + '</td></tr>').join('') + '</table></div>';
      const sim = this.app.sim; if (sim && sim.cI) h += '<div class="box mono dim">計算中の y = ' + sim.cI.env.y + '</div>';
    } else if (this.viz.type === 'ode') {
      const pts = this.odeData(), ex = this.exactFn(), re = this.realEuler();
      h += '<h4>値の比較</h4><div class="box"><table class="watch"><tr><td>t</td><td>CPU</td><td>実数オイラー</td><td>厳密解</td></tr>' + pts.map((p, i) => '<tr><td>' + fmt(p.t) + '</td><td>' + p.y + '</td><td>' + (re[i] ? re[i].y.toFixed(2) : '') + '</td><td>' + ex(p.t).toFixed(2) + '</td></tr>').join('') + '</table></div>';
    } else if (this.viz.type === 'series' && this.lod === 'full') {
      h += '<h4>記録（新しい順 50 件）</h4><div class="box mono" style="font-size:11px;white-space:pre">' + this.hist.slice(-50).reverse().map(x => Object.entries(x.env).map(([k, v]) => k + '=' + v).join(' ')).join('\n') + '</div>';
    }
    this.side.innerHTML = h;
    this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
  }
  traceInfo() {
    if (!this.prog || !this.prog.ok) return null;
    const d = U.def(this.defId()), t = this.viz.type;
    let body = '';
    if (t === 'newton') { const { N, xs } = this.newtonData(), x = xs[xs.length - 1]; body = 'x_' + (xs.length - 1) + ' = ' + x + '  → 次の候補 (x + N/x)/2 = ' + ((x + N / x) / 2).toFixed(2) + '  √N = ' + Math.sqrt(N).toFixed(3); }
    else if (t === 'ode') { const p = this.odeData().slice(-1)[0]; if (p) body = 't = ' + fmt(p.t) + '  CPU ' + p.y + ' / 厳密解 ' + this.exactFn()(p.t).toFixed(2); }
    else body = '記録 ' + this.hist.length + ' 点';
    return { level: 'math', id: d.id, title: d.title, body };
  }
}
function fmt(v) { return Math.abs(v) >= 1e5 ? v.toExponential(1) : Number.isInteger(v) ? String(v) : (+v.toFixed(3)).toString(); }
window.MathPanel = MathPanel;
})();
