/* 全体の司令塔: プログラム読み込み, 同期実行ループ, 表示モード, 定義トレース, 定義一覧 */
(function () {
'use strict';
const CPU = window.CPU5, U = window.U, PROGRAMS = window.CPU5_PROGRAMS;
const $ = s => document.querySelector(s);
const LODNAME = { overview: '俯瞰', detail: '詳細', full: '全体' };

const app = {
  sim: null, prog: null, running: false, speed: 1, mode: 'overview', focus: 'circ',
  panels: {},
};
window.APP = app;

app.panels.c = new window.CPanel($('#c-body'), app);
app.panels.asm = new window.AsmPanel($('#asm-body'), app);
app.panels.mc = new window.McPanel($('#mc-body'), app);
app.panels.circ = new window.CircuitPanel($('#circ-body'), app);
app.panels.tm = new window.TMPanel($('#tm-body'), app);
app.panels.flow = new window.FlowPanel($('#flow-body'), app);
app.panels.math = new window.MathPanel($('#math-body'), app);
const ORDER = ['c', 'asm', 'mc', 'circ', 'flow', 'math', 'tm'];

/* ---------------- プログラム ---------------- */
const sel = $('#prog');
{ const groups = {}; PROGRAMS.forEach((p, i) => { let g = groups[p.group]; if (!g) { g = groups[p.group] = document.createElement('optgroup'); g.label = p.group; sel.appendChild(g); } const o = document.createElement('option'); o.value = i; o.textContent = p.name; g.appendChild(o); }); }
app.preset = null;
sel.onchange = () => { app.preset = PROGRAMS[+sel.value]; app.loadSource(app.preset.src, 'c', app.preset); };
const tmBox = $('#tm-on');
tmBox.onchange = () => { if (app.sim) { app.sim.setTM(tmBox.checked); app.panels.tm.setEnabled(tmBox.checked); app.refresh(true); } };

app.loadSource = (src, mode, preset) => {
  if (preset === undefined && mode === 'c' && app.preset && app.preset.src !== src) app.preset = null;
  const prog = CPU.buildProgram(src, mode);
  if (!prog.ok) {
    if (mode === 'c') app.panels.c.showErrors(prog.errors.filter(e => e.level === 'c').concat(prog.errors.filter(e => e.level === 'asm').map(e => ({ line: 0, msg: '（翻訳後のアセンブリ）' + e.msg }))));
    else app.panels.asm.load(prog);
    return false;
  }
  app.prog = prog;
  app.sim = new CPU.Sim(prog, { useTM: tmBox.checked });
  // TM が 1 命令に 500 万歩以上かかるなら自動で省略
  if (app.sim.useTM && app.sim.segN > 5e6) { tmBox.checked = false; app.sim.setTM(false); }
  app.panels.tm.setEnabled(app.sim.useTM);
  app.panels.math.attach(app.sim);
  app.panels.math.load(prog, mode === 'c' ? (preset || app.preset) : null);
  app.panels.c.load(prog, src);
  app.panels.asm.load(prog);
  app.panels.mc.load(prog);
  app.panels.circ.load(prog);
  app.panels.tm.load(prog);
  app.panels.flow.load(prog);
  app.setRunning(false);
  app.refresh(true);
  return true;
};
let editT = 0;
app.editSource = (t, mode) => { clearTimeout(editT); editT = setTimeout(() => app.loadSource(t, mode), 450); };

/* ---------------- 実行制御 ---------------- */
app.setRunning = r => {
  app.running = r && app.sim && !app.sim.halted;
  $('#b-play').textContent = app.running ? '⏸ 停止' : '▶ 実行';
};
$('#b-play').onclick = () => { if (app.sim && app.sim.halted) { app.sim.reset(); app.refresh(true); } app.setRunning(!app.running); };
$('#b-step').onclick = () => { app.setRunning(false); if (app.sim) { app.sim.stepInstr(); app.refresh(true); } };
$('#b-micro').onclick = () => { app.setRunning(false); if (app.sim) { const n = app.sim.instr; app.sim.microStep(); app.refresh(app.sim.instr !== n); } };
$('#b-end').onclick = () => { app.setRunning(false); if (app.sim) { app.sim.runToEnd(200000); app.refresh(true); } };
$('#b-reset').onclick = () => { app.setRunning(false); if (app.sim) { app.sim.reset(); app.refresh(true); } };
const sp = $('#speed'), spo = $('#speed-out');
const speedOf = v => 0.1 * Math.pow(10, v / 1000 * 3.6);
const setSpeed = () => { app.speed = speedOf(+sp.value); spo.textContent = (app.speed < 10 ? app.speed.toFixed(1) : Math.round(app.speed)) + ' 命令/秒'; };
sp.oninput = setSpeed; sp.value = 333; setSpeed();

/* ---------------- 表示モード ---------------- */
document.querySelectorAll('.seg-b').forEach(b => b.onclick = () => app.setMode(b.dataset.mode));
document.querySelectorAll('[data-focus]').forEach(b => b.onclick = e => { e.stopPropagation(); app.setMode('detail', b.dataset.focus); });
document.querySelectorAll('.panel').forEach(p => p.addEventListener('click', e => {
  if (app.mode === 'detail' && p.classList.contains('thumb') && e.target.closest('.ph')) app.setMode('detail', p.dataset.level);
}));
app.setMode = (mode, focus) => {
  app.mode = mode; if (focus) app.focus = focus;
  const g = $('#grid');
  g.className = 'mode-' + mode;
  document.querySelectorAll('.seg-b').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  let row = 1;
  ORDER.forEach(id => {
    const el = $('#p-' + id);
    el.style.gridColumn = el.style.gridRow = '';
    el.classList.remove('thumb');
    let lod = mode;
    if (mode === 'detail') {
      if (id === app.focus) { el.style.gridColumn = '1'; el.style.gridRow = '1 / 7'; lod = 'detail'; }
      else { el.style.gridColumn = '2'; el.style.gridRow = String(row++); el.classList.add('thumb'); lod = 'overview'; }
    }
    el.querySelector('.lod').textContent = LODNAME[lod];
    app.panels[id].setLOD(lod);
  });
  $('#sb-mode').textContent = LODNAME[mode] + (mode === 'detail' ? ' · ' + $('#p-' + app.focus + ' .tab').textContent : '');
  try { localStorage.setItem('cpu5-view', JSON.stringify({ mode, focus: app.focus })); } catch (e) {}
};

/* ---------------- 定義トレース ---------------- */
const trace = $('#trace');
const toggleTrace = on => { trace.hidden = on == null ? !trace.hidden : !on; $('#sb-trace').textContent = '定義トレース ' + (trace.hidden ? '▲' : '▼'); app.refreshTrace(); };
$('#sb-trace').onclick = () => toggleTrace();
$('#b-trace-x').onclick = () => toggleTrace(false);
app.refreshTrace = () => {
  if (trace.hidden || !app.sim) return;
  const rows = ORDER.map(id => app.panels[id].traceInfo()).filter(Boolean);
  $('#trace-rows').innerHTML = rows.map(r => '<div class="trow"><span class="lv lv-' + (r.level === 't' ? 'c' : r.level) + '">' + U.LVNAME[r.level] + '</span><span class="t" data-def="' + (r.id || '') + '">' + U.esc(r.title) + '</span><span class="b">' + U.esc(r.body || '') + '</span></div>').join('');
  $('#trace-rows').querySelectorAll('[data-def]').forEach(e => e.onclick = () => e.dataset.def && app.openDefs(e.dataset.def));
};

/* ---------------- 状態表示 ---------------- */
app.refresh = (instrChanged) => {
  const sim = app.sim; if (!sim) return;
  if (instrChanged) { app.panels.c.update(); app.panels.asm.update(); app.panels.mc.update(); app.panels.flow.update(); app.panels.math.update(); }
  app.panels.tm.update();
  const ck = sim.check;
  const cs = $('#consist');
  const n = ck.layers;
  cs.className = 'consist ' + (ck.ok ? 'ok' : 'ng');
  cs.textContent = ck.ok ? '一致 ✓ ' + n + '/' + n + (sim.cI && !ck.cSync ? '（C は命令の途中）' : '') : '不一致 ✗';
  cs.title = ck.ok ? '命令ごとに、C・ASM・機械語・回路・TM のレジスタ / PC / 停止状態を突き合わせています' : ck.bad.join('\n');
  const sb = $('#statusbar');
  sb.classList.toggle('ng', !ck.ok); sb.classList.toggle('halted', sim.halted);
  $('#sb-run').textContent = sim.halted ? '■ 停止（HALT）' : app.running ? '● 実行中' : '⏸ 一時停止';
  $('#sb-instr').textContent = '命令 ' + sim.instr;
  $('#sb-pc').textContent = 'PC ' + sim.mI.pc;
  $('#sb-tm').textContent = sim.useTM ? 'TM ' + sim.tm.steps.toLocaleString() + ' 歩' : 'TM 省略';
  $('#sb-clk').textContent = 'クロック ' + sim.ck.cycles;
  if (sim.halted && app.running) app.setRunning(false);
};

/* ---------------- メインループ ---------------- */
let lastT = performance.now(), lastDom = 0, lastTrace = 0, pendingInstr = false;
function loop(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const sim = app.sim;
  if (sim && app.running) {
    const c = sim.advance(dt * app.speed);
    if (c) pendingInstr = true;
  }
  if (sim) {
    // DOM は毎秒 30 回まで
    if (t - lastDom > (app.mode === 'full' ? 90 : 33) && (app.running || pendingInstr)) { app.refresh(pendingInstr); pendingInstr = false; lastDom = t; }
    app.panels.circ.frame(dt);
    app.panels.tm.frame(dt);
    app.panels.flow.frame(dt);
    app.panels.math.frame(dt);
    if (t - lastTrace > 120) { app.refreshTrace(); lastTrace = t; }
  }
  requestAnimationFrame(loop);
}

/* ---------------- 定義一覧 ---------------- */
const defs = $('#defs');
const CATS = [
  { id: 'c', name: 'C の意味論', f: d => d.level === 'c' },
  { id: 't', name: '翻訳規則 C→ASM', f: d => d.level === 't' },
  { id: 'asm', name: 'アセンブリ', f: d => d.level === 'asm' },
  { id: 'mc', name: '機械語（ISA）', f: d => d.level === 'mc' },
  { id: 'circ', name: '論理回路', f: d => d.level === 'circ' },
  { id: 'gates', name: '全ゲート', gates: true },
  { id: 'tm', name: 'TM の定義', f: d => d.level === 'tm' && !d.rule },
  { id: 'tmd', name: 'TM の設計（翻訳の考え方）', f: d => d.level === 'tmd' },
  { id: 'math', name: '数学（アルゴリズム）', f: d => d.level === 'math' },
  { id: 'code', name: 'TM の擬似コード', code: true },
  { id: 'states', name: 'TM の状態', states: true },
  { id: 'delta', name: 'TM の遷移 δ', f: d => !!d.rule },
];
let defCat = 'c';
function defItems(cat) {
  if (cat.gates) { const C = CPU.Circuit.netlist; return C.gates.map(g => ({ id: 'gate#' + g.id, title: g.role, body: CPU.DEFS[g.def].title + ' — ' + CPU.DEFS[g.def].body + '\nブロック: ' + CPU.BLOCKS.find(b => b.id === g.block).name })); }
  if (cat.code) return CPU.TM_CODE.map(l => ({ id: 'line ' + l.id, title: l.text.trim(), body: l.why + '\n状態: ' + CPU.TM.machine.states.filter(q => CPU.TM.machine.info[q].line === l.id).join(', ') }));
  if (cat.states) { const M = CPU.TM.machine; return M.states.map(q => ({ id: 'state ' + q, title: q, body: M.info[q].desc + '\n擬似コード: ' + CPU.TM_CODE.find(l => l.id === M.info[q].line).text.trim() + '\n' + CPU.PHASE[M.info[q].phase].name + '  ≙  CPU の ' + CPU.PHASE[M.info[q].phase].cpu })); }
  return Object.values(CPU.DEFS).filter(cat.f);
}
function renderDefs(hit) {
  const q = $('#defs-q').value.trim().toLowerCase();
  $('#defs-nav').innerHTML = CATS.map(c => '<button data-c="' + c.id + '" class="' + (c.id === defCat ? 'on' : '') + '">' + c.name + '<small>' + defItems(c).length + '</small></button>').join('');
  $('#defs-nav').querySelectorAll('button').forEach(b => b.onclick = () => { defCat = b.dataset.c; renderDefs(); });
  let items = q ? CATS.flatMap(defItems).filter(d => (d.id + d.title + d.body).toLowerCase().includes(q)) : defItems(CATS.find(c => c.id === defCat));
  const total = items.length;
  if (hit) { const k = items.findIndex(d => d.id === hit); if (k > 300) items = items.slice(k - 50, k + 250); }
  if (items.length > 600) items = items.slice(0, 600);
  const tm = app.sim && app.sim.tm;
  const intro = !q && defCat === 'delta' ? '<p class="dim">状態 ' + CPU.TM.machine.states.length + ' 個・遷移 ' + CPU.TM.machine.rules.length + ' 本。右の数字はこの実行で使われた回数。</p>' :
    !q && defCat === 'gates' ? '<p class="dim">ゲート ' + CPU.Circuit.netlist.gates.length + ' 個・ネット ' + CPU.Circuit.netlist.nets.length + ' 本・組合せ回路の最大深さ ' + CPU.Circuit.netlist.maxDepth + ' 段。</p>' : '';
  const more = total > items.length ? '<p class="dim">' + total + ' 件のうち ' + items.length + ' 件を表示しています。検索で絞り込めます（例: CNT_12, LI_, FA3）。</p>' : '';
  $('#defs-list').innerHTML = intro + more + items.map(d => '<div class="defi' + (d.id === hit ? ' hit' : '') + '" id="def-' + U.esc(d.id) + '">' +
    (d.rule && tm ? '<span class="cnt">×' + tm.ruleCount[d.rule.id] + '</span>' : '') +
    '<span class="t">' + U.esc(d.title) + '</span><span class="id">' + U.esc(d.id) + '</span><div class="b">' + U.esc(d.body) + '</div></div>').join('');
  if (hit) { const e = document.getElementById('def-' + hit); if (e) e.scrollIntoView({ block: 'center' }); }
}
app.openDefs = id => {
  const d = id && CPU.DEFS[id];
  if (d) { const c = CATS.find(c => c.f && c.f(d)); if (c) defCat = c.id; }
  $('#defs-q').value = '';
  defs.hidden = false; renderDefs(id);
};
$('#b-defs').onclick = () => app.openDefs();
$('#defs-x').onclick = () => defs.hidden = true;
defs.onclick = e => { if (e.target === defs) defs.hidden = true; };
$('#defs-q').oninput = () => renderDefs();

/* ---------------- キーボード ---------------- */
document.addEventListener('keydown', e => {
  if (e.target.matches('textarea, input, select')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') { defs.hidden = true; return; }
  if (!defs.hidden) return;
  if (e.key === ' ') { e.preventDefault(); $('#b-play').click(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); $('#b-micro').click(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('#b-step').click(); }
  else if (e.key === 'r' || e.key === 'R') $('#b-reset').click();
  else if (e.key === 'e' || e.key === 'E') $('#b-end').click();
  else if (e.key === '1') app.setMode('overview');
  else if (e.key === '2') app.setMode('detail');
  else if (e.key === '3') app.setMode('full');
  else if (e.key === 't' || e.key === 'T') toggleTrace();
  else if (e.key === 'd' || e.key === 'D') app.openDefs();
});

/* ---------------- 起動 ---------------- */
let v = null;
try { v = JSON.parse(localStorage.getItem('cpu5-view') || 'null'); } catch (e) {}
const hash = location.hash.replace('#', '');
{ const i = PROGRAMS.findIndex(p => p.id === 'newton'); app.preset = PROGRAMS[i]; sel.value = i; app.loadSource(app.preset.src, 'c', app.preset); }
app.setMode(['overview', 'detail', 'full'].includes(hash) ? hash : (v && v.mode) || 'overview', v && v.focus);
requestAnimationFrame(loop);
})();
