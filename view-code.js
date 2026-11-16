/* VSCode 風エディタと、C / アセンブリの 2 つのパネル */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U;
const LH = 19;
const C_TYPES = new Set(['unsigned', 'char', 'int', 'void', 'uint8_t', 'uint16_t', 'register', 'signed', 'short', 'long', 'static', 'const']);
window.C_condText = null;

/* ------------------------------------------------------------------ */
class CodeView {
  constructor(parent, opts) {
    this.opts = opts;
    this.root = U.el('div', 'ed');
    this.inner = U.el('div', 'ed-inner');
    this.gutter = U.el('div', 'ed-gutter');
    this.code = U.el('div', 'ed-code');
    this.lines = U.el('div', 'ed-lines');
    this.pre = U.el('pre');
    this.ta = U.el('textarea');
    this.ta.spellcheck = false; this.ta.autocapitalize = 'off'; this.ta.setAttribute('autocomplete', 'off');
    this.ta.id = opts.id; this.ta.setAttribute('aria-label', opts.label || 'ソース');
    this.code.append(this.lines, this.pre, this.ta);
    this.inner.append(this.gutter, this.code);
    this.root.appendChild(this.inner);
    this.wrapEl = U.el('div', 'split');
    this.wrapEl.style.flex = '1';
    this.wrapEl.appendChild(this.root);
    this.mini = U.el('canvas', 'minimap'); this.mini.hidden = true;
    this.wrapEl.appendChild(this.mini);
    parent.appendChild(this.wrapEl);
    this.text = '';
    this.deco = {};
    this.ta.addEventListener('input', () => { this.text = this.ta.value; this.deco = { errLines: this.deco.errLines }; this.paint(); opts.onEdit && opts.onEdit(this.text); });
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = this.ta.selectionStart; this.ta.setRangeText('    ', s, this.ta.selectionEnd, 'end'); this.ta.dispatchEvent(new Event('input')); }
      e.stopPropagation();
    });
    this.ta.addEventListener('mousemove', e => this.hover(e));
    this.ta.addEventListener('mouseleave', () => U.hideTip(this));
    this.cw = 0;
  }
  measure() {
    if (this.cw) return;
    const s = U.el('span', null, 'MMMMMMMMMM'); s.style.visibility = 'hidden';
    this.pre.appendChild(s); this.cw = s.getBoundingClientRect().width / 10 || 7.8; s.remove();
  }
  setText(t) { this.text = t; this.ta.value = t; this.paint(); }
  setDeco(d) { this.deco = d || {}; this.paint(); }
  setMinimap(on) { this.mini.hidden = !on; this.paint(); }
  offsetAt(line, col) { const ls = this.text.split('\n'); let o = 0; for (let i = 0; i < line && i < ls.length; i++) o += ls[i].length + 1; return o + Math.min(col, (ls[line] || '').length); }
  hover(e) {
    this.measure();
    const r = this.ta.getBoundingClientRect();
    const line = Math.floor((e.clientY - r.top) / LH);
    const col = Math.floor((e.clientX - r.left - 6) / this.cw);
    const ls = this.text.split('\n');
    if (line < 0 || line >= ls.length || col < 0 || col >= (ls[line] || '').length) { U.hideTip(this); return; }
    const info = this.opts.onHover && this.opts.onHover(this.offsetAt(line, col), line, col);
    if (info) U.showTip(e.clientX, e.clientY, info, this); else U.hideTip(this);
  }
  paint() {
    const d = this.deco, src = this.text;
    const n = src.length;
    const base = this.opts.classify(src);
    const mk = new Array(n).fill('');
    for (const m of d.marks || []) for (let i = Math.max(0, m.s); i < Math.min(n, m.e); i++) if (src[i] !== '\n') mk[i] = mk[i] ? mk[i] + ' ' + m.cls : m.cls;
    const inl = d.inlays || {};
    let out = '', line = 0, i = 0;
    while (i <= n) {
      if (i === n || src[i] === '\n') { if (inl[line]) out += inl[line]; out += '\n'; line++; i++; continue; }
      let j = i; const c = base[i], m = mk[i];
      while (j < n && src[j] !== '\n' && base[j] === c && mk[j] === m) j++;
      out += '<span class="' + c + (m ? ' ' + m : '') + '">' + U.esc(src.slice(i, j)) + '</span>';
      i = j;
    }
    this.pre.innerHTML = out;
    const nl = src.split('\n').length;
    this.ta.style.height = (nl * LH + 8) + 'px';
    // ガター
    let g = '';
    for (let k = 0; k < nl; k++) {
      const cls = (k === d.curLine ? 'cur' : '') + (d.errLines && d.errLines.has(k) ? ' err' : '');
      const h = d.heat && d.heat[k] ? '<span class="heat" style="opacity:' + (0.15 + 0.85 * d.heat[k]).toFixed(2) + '"></span>' : '';
      g += '<div class="' + cls + '">' + h + (k + 1) + '</div>';
    }
    this.gutter.innerHTML = g;
    // 行の背景
    let lh = '';
    if (d.curLine != null && d.curLine >= 0) lh += '<div class="cl" style="top:' + d.curLine * LH + 'px"></div>';
    if (d.errLines) for (const k of d.errLines) lh += '<div class="el" style="top:' + k * LH + 'px"></div>';
    this.lines.innerHTML = lh;
    if (!this.mini.hidden) this.paintMini(base);
  }
  paintMini(base) {
    const cv = this.mini, r = cv.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const ls = this.text.split('\n');
    const lh = Math.min(4, r.height / Math.max(1, ls.length));
    const col = { 'tk-com': '#4d6e3d', 'tk-kw': '#8e5f8c', 'tk-type': '#3d6e99', 'tk-mn': '#8e5f8c', 'tk-num': '#7a8c6a' };
    let o = 0;
    ls.forEach((l, k) => {
      const d = this.deco;
      if (k === d.curLine) { c.fillStyle = 'rgba(255,204,0,.35)'; c.fillRect(0, k * lh, r.width, lh); }
      if (d.heat && d.heat[k]) { c.fillStyle = 'rgba(255,204,0,' + (0.1 + 0.4 * d.heat[k]) + ')'; c.fillRect(r.width - 6, k * lh, 6, lh); }
      const ind = l.length - l.trimStart().length;
      c.fillStyle = col[base[o + ind]] || '#5d6470';
      c.fillRect(4 + ind * 1.2, k * lh + 0.5, Math.min(r.width - 12, l.trim().length * 1.2), Math.max(1, lh - 1));
      o += l.length + 1;
    });
  }
}

function classifyC(src) {
  const cls = new Array(src.length).fill('tk-op');
  for (const t of CPU.cTokenize(src, true)) {
    let c = 'tk-op';
    if (t.t === 'kw') c = C_TYPES.has(t.v) ? 'tk-type' : 'tk-kw';
    else if (t.t === 'id') c = t.v === 'main' ? 'tk-fn' : 'tk-var';
    else if (t.t === 'num') c = 'tk-num';
    else if (t.t === 'com') c = 'tk-com';
    else if (t.t === 'pp') c = 'tk-pp';
    else if (t.t === 'ws') c = '';
    for (let i = t.s; i < t.e; i++) cls[i] = c;
  }
  return cls;
}
function classifyAsm(src) {
  const cls = new Array(src.length).fill('');
  let o = 0;
  for (const line of src.split('\n')) {
    const set = (a, b, c) => { for (let i = a; i < b; i++) cls[o + i] = c; };
    const ci = line.indexOf(';');
    const code = ci >= 0 ? line.slice(0, ci) : line;
    if (ci >= 0) set(ci, line.length, 'tk-com');
    let m, re = /([A-Za-z_]\w*)\s*:/g;
    let rest = 0;
    while ((m = re.exec(code)) && code.slice(rest, m.index).trim() === '') { set(m.index, m.index + m[1].length, 'tk-lab'); rest = m.index + m[0].length; }
    const tail = code.slice(rest);
    const tm = tail.match(/^(\s*)(\.?[A-Za-z]+)(.*)$/);
    if (tm) {
      const s0 = rest + tm[1].length;
      set(s0, s0 + tm[2].length, tm[2][0] === '.' ? 'tk-dir' : 'tk-mn');
      const argS = s0 + tm[2].length;
      const re2 = /[A-Za-z_]\w*|\d+/g; let a;
      while ((a = re2.exec(tm[3]))) {
        const c = /^\d+$/.test(a[0]) ? 'tk-num' : /^[a-hA-H]$/.test(a[0]) ? 'tk-reg' : 'tk-ref';
        set(argS + a.index, argS + a.index + a[0].length, c);
      }
    }
    o += line.length + 1;
  }
  return cls;
}

/* ------------------------------------------------------------------ */
/*  C パネル                                                           */
/* ------------------------------------------------------------------ */
function roleRange(ev, src) {
  if (!ev) return null;
  const n = ev.node;
  switch (ev.role) {
    case 'asg': case 'brk': case 'call': return [n.s, n.e];
    case 'cond': return n.head;
    case 'back': return n.close;
    case 'skip': return n.elseKw || n.close;
    case 'halt': return n.k === 'main' ? n.close : [n.s, n.e];
    case 'ret': return n.k === 'func' ? n.close : [n.s, n.e];
  }
  return [n.s, n.e];
}
const ROLE_JA = { asg: '代入・計算', cond: '条件を調べる', back: 'ループの先頭へ戻る', skip: 'else を飛ばす', brk: 'ループを抜ける (break)', halt: '停止', call: '関数を呼ぶ', ret: '呼び出し元へ戻る' };
const RULE_HERE = { 'T-WHILE': { cond: 0, back: 2 }, 'T-IF': { cond: 0 }, 'T-IFELSE': { cond: 0, skip: 2 } };
const opnd = o => !o ? '' : o.t === 'num' ? String(o.v) : o.t === 'var' ? o.v.name : o.a.name + '[' + opnd(o.i) + ']';
function condText(c) {
  if (!c) return '';
  const a = c.a && c.a.name, b = opnd(c.b);
  return { true: '1', nz: a, z: a + ' == 0', lt: a + ' < ' + b, gt: a + ' > ' + b, le: a + ' <= ' + b, ge: a + ' >= ' + b, eq: a + ' == ' + b, ne: a + ' != ' + b }[c.k];
}
const exprText = e => e.t === 'bin' ? opnd(e.a) + ' ' + e.op + ' ' + opnd(e.b) : opnd(e);
const dstText = d => d.t === 'var' ? d.v.name : opnd(d);
window.C_TXT = { condText, exprText, dstText, opnd };
function hl(body, k) { return body.split('\n').map((l, i) => i === k ? '<span class="here">' + U.esc(l) + '</span>' : U.esc(l)).join('\n'); }
function allFuncs(ast) { return [ast].concat(Object.values(ast.funcs || {}).filter(f => f.k === 'func')); }

class CPanel {
  constructor(body, app) {
    this.app = app;
    this.banner = U.el('div', 'banner'); this.banner.hidden = true;
    this.banner.innerHTML = '<span>アセンブリを直接編集しています。C との対応はありません。</span>';
    const rb = U.el('button', 'btn', 'C から作り直す'); rb.onclick = () => app.loadSource(this.lastC, 'c');
    this.banner.appendChild(rb);
    this.bar = U.el('div', 'bar');
    this.crumbs = U.el('div', 'crumbs'); this.bar.appendChild(this.crumbs);
    body.append(this.banner, this.bar);
    const split = U.el('div', 'split');
    body.appendChild(split);
    this.ed = new CodeView(split, { id: 'ed-c', label: 'C ソース', classify: classifyC, onEdit: t => app.editSource(t, 'c'), onHover: off => this.hover(off) });
    this.side = U.el('div', 'side'); split.appendChild(this.side);
    this.watchBar = U.el('div', 'bar'); body.appendChild(this.watchBar);
    this.prob = U.el('div', 'problems'); this.prob.hidden = true; body.appendChild(this.prob);
    this.lod = 'overview'; this.lastC = ''; this.prevEnv = {};
  }
  load(prog, src) {
    if (prog.mode === 'c') { this.lastC = src; if (this.ed.text !== src) this.ed.setText(src); }
    this.banner.hidden = prog.mode === 'c';
    this.prog = prog;
    this.showErrors(prog.errors.filter(e => e.level === 'c'));
  }
  showErrors(errs) {
    this.prob.hidden = !errs.length;
    this.prob.innerHTML = errs.map(e => '<div>main.c:' + (e.line + 1) + ':' + (e.col || 1) + '  ' + U.esc(e.msg) + '</div>').join('');
    if (errs.length) this.ed.setDeco({ errLines: new Set(errs.map(e => e.line)) });
  }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.watchBar.hidden = l !== 'overview'; this.ed.setMinimap(l === 'full'); this.update(); }
  lineOf(pos) { return CPU.lineCol(this.ed.text, pos).line - 1; }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok || !P.c) {
      this.crumbs.innerHTML = P && !P.c ? '<span class="dim">—</span>' : '';
      this.side.innerHTML = ''; this.watchBar.innerHTML = '';
      if (P && !P.c) this.ed.setDeco({});
      return;
    }
    const cI = sim.cI, ev = cI.cur, src = this.ed.text, ast = P.c.ast;
    const marks = [];
    if (ev) {
      for (const n of ev.stack) if (n.k === 'while' && n !== ev.node) marks.push({ s: n.head[0], e: n.head[1], cls: 'mk-outer' });
      const r = roleRange(ev, src); if (r) marks.push({ s: r[0], e: r[1], cls: 'mk-act' });
    }
    const curLine = ev ? this.lineOf(roleRange(ev, src)[0]) : -1;
    const deco = { marks, curLine };
    if (this.lod !== 'overview') {
      const byLine = {}, cnt = sim.aI.count;
      let maxc = 1;
      P.asm.instrs.forEach(it => {
        if (!it.meta) return;
        const ln = this.lineOf(roleRange({ node: it.meta.node, role: it.meta.role }, src)[0]);
        (byLine[ln] = byLine[ln] || { a: [], n: 0 }).a.push(it.addr);
        if (it.meta.idx === 0) byLine[ln].n += cnt[it.addr];
        maxc = Math.max(maxc, byLine[ln].n);
      });
      const inl = {}, heat = {}, vals = {};
      const add = (ln, x) => { (vals[ln] = vals[ln] || new Set()).add(x); };
      const walk = n => {
        if (!n) return;
        if (n.k === 'block') return n.body.forEach(walk);
        const ln = this.lineOf(n.s);
        if (n.k === 'asg') { if (n.dst.t === 'var') add(ln, n.dst.v.name); for (const o of [n.expr, n.expr.a, n.expr.b]) if (o && o.t === 'var') add(ln, o.v.name); }
        if (n.c) { if (n.c.a) add(ln, n.c.a.name); if (n.c.b && n.c.b.t === 'var') add(ln, n.c.b.v.name); }
        if (n.k === 'while') walk(n.body);
        if (n.k === 'if') { walk(n.then); walk(n.else); }
      };
      allFuncs(ast).forEach(f => walk(f.body));
      ast.vars.forEach(v => { const ln = this.lineOf(v.s); inl[ln] = (inl[ln] || '') + '<span class="inlay">' + v.name + ' → ' + CPU.REGN[v.reg] + '</span>'; });
      ast.arrays.forEach(a => { const ln = this.lineOf(a.s); inl[ln] = (inl[ln] || '') + '<span class="inlay">' + a.name + ' → RAM ' + a.base + '〜' + (a.base + a.len - 1) + '</span>'; });
      for (const ln in byLine) {
        const a = byLine[ln].a, s = a.length > 3 ? '@' + a[0] + '〜' + a[a.length - 1] : '@' + a.join(',');
        inl[ln] = (inl[ln] || '') + '<span class="inlay">' + s + (this.lod === 'full' ? '  ×' + byLine[ln].n : '') + '</span>';
        if (this.lod === 'full') heat[ln] = byLine[ln].n / maxc;
      }
      for (const ln in vals) inl[ln] = (inl[ln] || '') + '<span class="inlay val">' + [...vals[ln]].map(n => n + ' = ' + cI.env[n]).join(', ') + '</span>';
      deco.inlays = inl; deco.heat = heat;
    }
    this.ed.setDeco(deco);
    const parts = ['main()'];
    if (ev) for (const n of ev.stack) {
      if (n.k === 'func') parts.push(n.name + '()');
      else if (n.k === 'while' || n.k === 'if') parts.push(U.esc(src.slice(n.head[0], n.head[1]).replace(/\s+/g, ' ')));
    }
    this.crumbs.innerHTML = parts.map((p, i) => '<span class="' + (i === parts.length - 1 ? 'cur' : '') + '">' + p + '</span>').join('<span class="sep">›</span>') +
      '<span class="sep">›</span><span class="cur">' + (ev ? ROLE_JA[ev.role] : (cI.halted ? '停止' : '')) + '</span>';
    const changed = n => this.prevEnv[n] !== undefined && this.prevEnv[n] !== cI.env[n];
    const arrTxt = a => cI.arr[a.name].join(', ');
    if (this.lod === 'overview') {
      this.watchBar.innerHTML = '<div class="watch-inline">' + ast.vars.map(v => '<span class="' + (changed(v.name) ? 'flash' : '') + '"><b>' + v.name + '</b> = ' + cI.env[v.name] + '</span>').join('') +
        ast.arrays.map(a => '<span><b>' + a.name + '</b> = [' + U.esc(arrTxt(a)) + ']</span>').join('') + '</div>';
    } else {
      const a = sim.aI.cur(), m = a && a.meta, rule = m && U.def(m.rule);
      const rt = rule ? hl(rule.body, rule.id === 'T-MUL' || rule.id === 'T-DIV' ? -1 : m.idx) : '';
      let srt = '';
      if (m && (m.role === 'cond' || m.role === 'back' || m.role === 'skip')) {
        const sr = m.node.k === 'while' ? 'T-WHILE' : m.node.else ? 'T-IFELSE' : 'T-IF';
        if (sr !== m.rule) srt = '<span class="deflink" data-def="' + sr + '">' + U.esc(U.def(sr).title) + '</span><pre class="def">' + hl(U.def(sr).body, RULE_HERE[sr][m.role]) + '</pre>';
      }
      const cdef = ev && U.def(ev.def);
      let concrete = '';
      if (ev) {
        const n = ev.node;
        if (ev.role === 'cond') { const t = cI.test(n.c); concrete = condText(n.c) + ' → ' + (t ? '真' : '偽') + ' → ' + (n.k === 'while' ? (t ? '本体を実行' : 'ループを抜ける') : (t ? 'then 側' : (n.else ? 'else 側' : '何もしない'))); }
        else if (ev.role === 'asg') concrete = dstText(n.dst) + ' ← ' + exprText(n.expr) + ' = ' + cI.evalExpr(n.expr);
        else if (ev.role === 'call') concrete = n.name + '() の本体へ（戻り番地を LR に置く）';
        else concrete = ROLE_JA[ev.role];
        if (ev.cnt > 1 && m) concrete += '\n（この動作は命令 ' + ev.cnt + ' 個' + (m.rule === 'T-MUL' || m.rule === 'T-DIV' ? '・ループあり' : '') + '。いま ' + (m.idx + 1) + ' 個目）';
      }
      this.side.innerHTML =
        '<h4>変数（ウォッチ）</h4><div class="box"><table class="watch">' +
        ast.vars.map(v => '<tr class="' + (changed(v.name) ? 'flash' : '') + '"><td>' + v.name + '</td><td>' + cI.env[v.name] + '</td><td class="dim">' + CPU.REGN[v.reg] + '</td></tr>').join('') +
        ast.arrays.map(x => '<tr><td>' + x.name + '[]</td><td colspan="2" style="white-space:normal">' + U.esc(arrTxt(x)) + '</td></tr>').join('') + '</table></div>' +
        '<h4>いまの動作 — C の意味</h4><div class="box">' + (cdef ? '<span class="deflink" data-def="' + cdef.id + '">' + U.esc(cdef.title) + '</span><pre class="def">' + U.esc(cdef.body) + '</pre><div class="mono" style="margin-top:4px;color:var(--warn);white-space:pre-wrap">' + U.esc(concrete) + '</div>' : '<span class="dim">停止しました</span>') + '</div>' +
        (rule ? '<h4>翻訳規則 — どの命令になったか</h4><div class="box">' + srt + '<span class="deflink" data-def="' + rule.id + '">' + U.esc(rule.title) + '</span><pre class="def">' + rt + '</pre><div class="mono dim" style="margin-top:4px">この命令: @' + a.addr + '  ' + U.esc(CPU.disasm(P.words[a.addr])) + '</div></div>' : '') +
        (P.c.temps.length ? '<h4>作業用レジスタ</h4><div class="box mono dim">' + P.c.temps.map(t => CPU.REGN[t] + ' = ' + sim.aI.R[t]).join('  ') + '<br>（比較・掛け算・割り算・番地計算。C の変数ではない）</div>' : '');
      this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
    }
    this.prevEnv = Object.assign({}, cI.env);
  }
  hover(off) {
    const P = this.prog; if (!P) return null;
    const src = this.ed.text;
    const tok = CPU.cTokenize(src, true).find(t => off >= t.s && off < t.e);
    if (!tok || tok.t === 'ws') return null;
    const sim = this.app.sim, ast = P.c && P.c.ast;
    if (tok.t === 'id' && ast) {
      const v = ast.vars.find(x => x.name === tok.v);
      if (v) return { level: 'c', id: 'C-VAR', title: 'unsigned int ' + v.name + '  →  レジスタ ' + CPU.REGN[v.reg], body: U.def('C-VAR').body, value: sim && sim.cI ? v.name + ' = ' + sim.cI.env[v.name] + ' = ' + CPU.bin(sim.cI.env[v.name], 16) + '₂' : '' };
      const a = ast.arrays.find(x => x.name === tok.v);
      if (a) return { level: 'c', id: 'C-ARR', title: 'unsigned int ' + a.name + '[' + a.len + ']  →  RAM ' + a.base + '〜' + (a.base + a.len - 1), body: U.def('C-ARR').body, value: sim && sim.cI ? '[' + sim.cI.arr[a.name].join(', ') + ']' : '' };
      const f = ast.funcs[tok.v];
      if (f && f.k === 'func') return { level: 'c', id: 'C-CALL', title: 'void ' + f.name + '(void)', body: U.def('C-CALL').body + '\n\n翻訳: ' + U.def('T-CALL').body + ' / 末尾は ' + U.def('T-FRET').body };
    }
    const map = { while: 'C-WHILE', for: 'C-WHILE', if: 'C-IF', else: 'C-IF', return: 'C-RET', break: 'C-BREAK', '++': 'C-ARITH', '--': 'C-ARITH', '+=': 'C-ARITH', '-=': 'C-ARITH', '*=': 'C-ARITH', '/=': 'C-ARITH', '%=': 'C-ARITH', '>>=': 'C-ARITH', '<<=': 'C-ARITH', '>>': 'C-ARITH', '<<': 'C-ARITH', '+': 'C-ARITH', '-': 'C-ARITH', '*': 'C-ARITH', '/': 'C-ARITH', '%': 'C-ARITH', '<': 'C-COND', '>': 'C-COND', '<=': 'C-COND', '>=': 'C-COND', '==': 'C-COND', '!=': 'C-COND', '!': 'C-COND', unsigned: 'C-VAR', int: 'C-VAR', uint16_t: 'C-VAR', '=': 'C-ASG', '[': 'C-ARR', '}': 'C-END' };
    const id = map[tok.v];
    if (id) {
      const ar = { '>>=': 'T-SHR', '>>': 'T-SHR', '<<=': 'T-SHL', '<<': 'T-SHL', '+': 'T-ADD', '+=': 'T-ADD', '++': 'T-ADD', '-': 'T-SUB', '-=': 'T-SUB', '--': 'T-SUB', '*': 'T-MUL', '*=': 'T-MUL', '/': 'T-DIV', '/=': 'T-DIV', '%': 'T-DIV', '%=': 'T-DIV' };
      const tr = { 'C-WHILE': 'T-WHILE', 'C-IF': 'T-IFELSE', 'C-RET': 'T-RET', 'C-BREAK': 'T-BREAK', 'C-ASG': 'T-MOV', 'C-ARR': 'T-LOAD', 'C-ARITH': ar[tok.v], 'C-COND': { '<': 'T-LT', '>': 'T-GT', '<=': 'T-LE', '>=': 'T-GE', '==': 'T-EQ', '!=': 'T-NE', '!': 'T-Z' }[tok.v] }[id];
      const d = U.def(id);
      return { level: 'c', id, title: d.title, body: d.body + (tr ? '\n\n翻訳: ' + U.def(tr).title + '\n' + U.def(tr).body : '') };
    }
    return null;
  }
  traceInfo() {
    const sim = this.app.sim;
    if (!sim || !sim.cI) return { level: 'c', title: '（C なし）', body: 'アセンブリを直接実行中' };
    const ev = sim.cI.cur;
    if (!ev) return { level: 'c', title: '停止', body: '' };
    const d = U.def(ev.def), a = sim.aI.cur(), m = a && a.meta;
    return { level: 'c', id: d.id, title: d.title, body: ROLE_JA[ev.role] + (ev.role === 'cond' ? '  (' + condText(ev.node.c) + ' → ' + (sim.cI.test(ev.node.c) ? '真' : '偽') + ')' : ev.role === 'asg' ? '  (' + dstText(ev.node.dst) + ' ← ' + exprText(ev.node.expr) + ')' : '') + (m ? '   ⇒ 翻訳規則 ' + m.rule + (ev.cnt > 1 ? '（' + (m.idx + 1) + '/' + ev.cnt + ' 命令目）' : '') : '') };
  }
}

/* ------------------------------------------------------------------ */
/*  アセンブリ パネル                                                   */
/* ------------------------------------------------------------------ */
const A_DEF = {}; Object.keys(CPU.MN).forEach(k => A_DEF[k] = 'A-' + k);
class AsmPanel {
  constructor(body, app) {
    this.app = app;
    this.bar = U.el('div', 'bar'); body.appendChild(this.bar);
    const split = U.el('div', 'split'); body.appendChild(split);
    this.ed = new CodeView(split, { id: 'ed-asm', label: 'アセンブリ', classify: classifyAsm, onEdit: t => app.editSource(t, 'asm'), onHover: (o, l, c) => this.hover(o, l, c) });
    this.side = U.el('div', 'side'); split.appendChild(this.side);
    this.prob = U.el('div', 'problems'); this.prob.hidden = true; body.appendChild(this.prob);
    this.lod = 'overview';
  }
  load(prog) {
    this.prog = prog;
    if (prog.asmText != null && this.ed.text !== prog.asmText && !(prog.mode === 'asm' && document.activeElement === this.ed.ta)) this.ed.setText(prog.asmText);
    const errs = prog.errors.filter(e => e.level === 'asm');
    this.prob.hidden = !errs.length;
    this.prob.innerHTML = errs.map(e => '<div>main.s:' + (e.line + 1) + '  ' + U.esc(e.msg) + '</div>').join('');
    if (errs.length) this.ed.setDeco({ errLines: new Set(errs.map(e => e.line)) });
  }
  setLOD(l) { this.lod = l; this.side.hidden = l === 'overview'; this.ed.setMinimap(l === 'full'); this.update(); }
  explain(it, A) {
    if (!it) return '';
    const R = A.R, C = A.C, r = CPU.REGN[it.r], q = CPU.REGN[it.s], v = R[it.r], w = R[it.s], M = 65535;
    const to = () => it.targetText + ' (@' + it.target + ') へ';
    switch (it.op) {
      case 'INC': return r + ' : ' + v + ' → ' + ((v + 1) & M);
      case 'DEC': return r + ' : ' + v + ' → ' + ((v - 1) & M);
      case 'ADD': return r + ' : ' + v + ' + ' + w + ' = ' + (v + w) + (v + w > M ? ' → ' + ((v + w) & M) + '、C = 1' : '、C = 0');
      case 'SUB': return r + ' : ' + v + ' − ' + w + ' = ' + ((v - w) & M) + (v < w ? '（借り）C = 1' : '、C = 0');
      case 'MOV': return r + ' ← ' + q + ' = ' + w;
      case 'SHR': return r + ' : ' + v + ' >> 1 = ' + (v >>> 1) + '、C = ' + (v & 1);
      case 'LDI': return r + ' ← ' + it.imm;
      case 'LD': return r + ' ← RAM[' + q + ' = ' + (w & 63) + '] = ' + A.ram[w & 63];
      case 'ST': return 'RAM[' + q + ' = ' + (w & 63) + '] ← ' + r + ' = ' + v;
      case 'JZ': return r + ' = ' + v + (v === 0 ? ' = 0 → ' + to() : ' ≠ 0 → 次の行');
      case 'JNZ': return r + ' = ' + v + (v !== 0 ? ' ≠ 0 → ' + to() : ' = 0 → 次の行');
      case 'JC': return 'C = ' + C + (C ? ' → ' + to() : ' → 次の行');
      case 'JNC': return 'C = ' + C + (!C ? ' → ' + to() : ' → 次の行');
      case 'JMP': return to();
      case 'CALL': return 'LR ← ' + (it.addr + 1) + '、' + to();
      case 'RET': return 'LR = ' + A.LR + ' へ戻る';
      case 'HALT': return '停止';
    }
  }
  update() {
    const sim = this.app.sim, P = this.prog;
    if (!sim || !P || !P.ok) { this.bar.innerHTML = ''; this.side.innerHTML = ''; return; }
    const a = sim.aI, it = a.cur();
    const deco = { curLine: it ? it.line : -1, marks: [] };
    if (this.lod !== 'overview') {
      const inl = {}, heat = {}, maxc = Math.max(1, ...a.count);
      P.asm.instrs.forEach(x => {
        if (x.line < 0) return;
        inl[x.line] = '<span class="inlay">@' + String(x.addr).padStart(3, '0') + '  ' + U.fmtBits(P.words[x.addr]) + (this.lod === 'full' ? '  ×' + a.count[x.addr] : '') + '</span>';
        if (this.lod === 'full') heat[x.line] = a.count[x.addr] / maxc;
      });
      deco.inlays = inl; deco.heat = heat;
    }
    this.ed.setDeco(deco);
    this.bar.innerHTML = '<span><b>' + P.words.length + '</b> / 256 語</span><span>ラベル <b>' + Object.keys(P.asm.labels).length + '</b></span>' +
      (P.asm.implicitHalt && P.mode === 'asm' ? '<span>末尾に暗黙の HALT</span>' : '') +
      '<span class="mono">' + CPU.REGN.map((r, i) => r + '=' + a.R[i]).join(' ') + '  C=' + a.C + ' LR=' + a.LR + '</span>';
    if (this.lod !== 'overview') {
      const d = it && U.def(A_DEF[it.op]), m = it && it.meta, sig = it ? CPU.MN[it.op][1] : '';
      this.side.innerHTML =
        '<h4>いまの命令 — ニーモニックの意味</h4><div class="box">' + (d ? '<span class="deflink" data-def="' + d.id + '">' + U.esc(d.title) + '</span><pre class="def">' + U.esc(d.body) + '</pre><div class="mono" style="margin-top:4px;color:var(--warn)">' + U.esc(a.halted ? '停止しました' : this.explain(it, a)) + '</div>' : '') + '</div>' +
        '<h4>アセンブル（→ 機械語）</h4><div class="box mono">' + (it ? '@' + it.addr + '  ' + U.fieldBits(P.words[it.addr]) + '  <span class="dim">0x' + U.hex(P.words[it.addr]) + '</span>' : '') + '</div>' +
        (m ? '<h4>出どころ（C）</h4><div class="box"><span class="deflink" data-def="' + m.rule + '">' + U.esc(U.def(m.rule).title) + '</span> <span class="dim">· ' + m.role + (m.cnt > 1 ? ' · ' + (m.idx + 1) + '/' + m.cnt : '') + '</span></div>' : '') +
        '<h4>記号表</h4><div class="box"><div class="kv">' + Object.entries(P.asm.labels).map(([k, v]) => '<span>' + U.esc(k) + '</span><span>@' + v + '</span>').join('') + '</div></div>' +
        '<h4>レジスタ・C・LR</h4><div class="box"><div class="regs-bin">' + CPU.REGN.map((r, i) => '<span class="' + (it && ((sig.includes('r') && it.r === i) || (/[sm]/.test(sig) && it.s === i)) ? 'on' : 'dim') + '">' + r + '</span><span>' + U.bits(a.R[i], 16) + '</span><span>' + a.R[i] + '</span>').join('') +
        '<span>C</span><span>' + U.bits(a.C, 1) + '</span><span>' + a.C + '</span><span>LR</span><span>' + U.bits(a.LR, 8) + '</span><span>' + a.LR + '</span></div></div>';
      this.side.querySelectorAll('[data-def]').forEach(e => e.onclick = () => this.app.openDefs(e.dataset.def));
    }
  }
  hover(off, line) {
    const P = this.prog; if (!P || !P.asm) return null;
    const src = this.ed.text;
    let s = off, e = off;
    while (s > 0 && /[\w.]/.test(src[s - 1])) s--;
    while (e < src.length && /[\w.]/.test(src[e])) e++;
    const w = src.slice(s, e);
    if (!w) return null;
    const up = w.toUpperCase(), sim = this.app.sim;
    if (A_DEF[up]) {
      const d = U.def(A_DEF[up]), ad = P.asm.lineAddr[line];
      return { level: 'asm', id: d.id, title: d.title, body: d.body + (ad >= 0 ? '\n\n→ 機械語 @' + ad + ' = ' + U.fmtBits(P.words[ad]) + ' (' + U.def('M-' + CPU.bin(CPU.OPC[up], 4)).title + ')' : '') };
    }
    if (w === '.reg') return U.defTip('A-REG');
    if (w === '.ram') return U.defTip('A-RAM');
    if (P.asm.labels[w] !== undefined) return { level: 'asm', id: 'A-LABEL', title: w + ' = @' + P.asm.labels[w], body: U.def('A-LABEL').body };
    if (/^[a-h]$/i.test(w) && sim) { const i = CPU.REGN.indexOf(w.toLowerCase()); return { level: 'asm', title: 'レジスタ ' + w, body: '16bit 汎用レジスタ（番号 ' + CPU.bin(i, 3) + '）', value: w + ' = ' + sim.aI.R[i] + ' = ' + CPU.bin(sim.aI.R[i], 16) + '₂' }; }
    return null;
  }
  traceInfo() {
    const sim = this.app.sim; if (!sim) return null;
    const it = sim.aI.cur();
    if (!it || sim.aI.halted) return { level: 'asm', title: '停止', body: '' };
    const d = U.def(A_DEF[it.op]);
    return { level: 'asm', id: d.id, title: d.title, body: this.explain(it, sim.aI) };
  }
}

window.CodeView = CodeView;
window.CPanel = CPanel;
window.AsmPanel = AsmPanel;
})();
