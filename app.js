'use strict';
/* Huddle Playbook — offline sideline app for 5v5 flag football.
   Everything is stored on the device (IndexedDB). No network needed after install. */

const APP_VERSION = '1.9.1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const lsGet = k => { try { return localStorage.getItem('huddle.' + k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('huddle.' + k, v); } catch { /* ignore */ } };

const LEGACY_COLORS = { red: '#a3142b', gold: '#c9a458', blue: '#1d4f91', green: '#1f6b3a', black: '#1c1c1c', orange: '#d9641c' };
// Team color presets (colors only, no marks). Primary drives the top bar and buttons; secondary drives LOG.
const PRESETS = [
  ['49ers', '#AA0000', '#B3995D'], ['Bengals', '#FB4F14', '#000000'], ['Cardinals', '#97233F', '#FFB612'],
  ['Buccaneers', '#D50A0A', '#34302B'], ['Colts', '#002C5F', '#A2AAAD'], ['Packers', '#203731', '#FFB612'],
  ['Lions', '#0076B6', '#B0B7BC'], ['Vikings', '#4F2683', '#FFC62F'], ['Bills', '#00338D', '#C60C30'],
  ['Chiefs', '#E31837', '#FFB81C'], ['Bears', '#0B162A', '#C83803'], ['Seahawks', '#002244', '#69BE28'],
  ['Cowboys', '#041E42', '#869397'], ['Steelers', '#101820', '#FFB612'], ['Eagles', '#004C54', '#A5ACAF'],
  ['Raiders', '#000000', '#A5ACAF'], ['Broncos', '#FB4F14', '#002244'], ['Dolphins', '#008E97', '#FC4C02']
];
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return L > 0.36 ? '#15120a' : '#ffffff';
}
const gstyle = g => `--gc:${g.color};--gc-ink:${inkFor(g.color)}`;
function applyTheme() {
  const r = document.documentElement.style; const c = S.colors || {};
  const p = c.primary || '#AA0000', s = c.secondary || '#B3995D';
  r.setProperty('--brand', p); r.setProperty('--on-brand', inkFor(p));
  r.setProperty('--gold', s); r.setProperty('--on-gold', inkFor(s));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', p);
  document.title = (S.team ? S.team + ' · ' : '') + 'Huddle';
}
const DEFAULT_TAGS = ['Run', 'Pass', 'RPO', 'Short yardage', 'Goal line', 'Trick', 'Man beater', 'Zone beater'];
// Fallback spot layouts used when a position can't be found in the drawing
const SPOT_GUESS = {
  C: [50, 53], Q: [50, 70], F: [37, 70], X: [62, 68], Z: [18, 53], QB: [50, 70], RB: [50, 80], WR1: [14, 52], WR2: [86, 52],
  R: [50, 55], CB: [18, 52], CB2: [82, 52], S: [35, 28], S2: [65, 28], LB: [50, 40]
};
const DEFAULT_POSITIONS = { O: ['C', 'Q', 'F', 'X', 'Z'], D: ['R', 'CB', 'CB', 'S', 'S'] };
function spotsFor(labels) {
  const seen = {};
  return labels.map((label, i) => {
    seen[label] = (seen[label] || 0) + 1;
    const key = seen[label] > 1 ? label + seen[label] : label;
    const g = SPOT_GUESS[key] || SPOT_GUESS[label] || [10 + (i * 80) / Math.max(1, labels.length - 1), 50];
    return { key, label, x: g[0], y: g[1] };
  });
}
const posList = side => (S && S.positions && S.positions[side]) || DEFAULT_POSITIONS[side];
const DEFAULT_SPOTS = { get O() { return spotsFor(posList('O')); }, get D() { return spotsFor(posList('D')); } };
const labelOfKey = k => String(k).replace(/\d+$/, '') || k;
const DEFAULT_ACTIONS = {
  O: [['Run', 0], ['Pass', 0], ['Target', 0], ['Catch', 0], ['Runner 2', 0], ['Runner 3', 0]],
  D: [['Flag pull', 0], ['Contain', 1], ['PBU', 0], ['INT', 0], ['Chase-down', 1]]
};
const DEFAULT_RESULTS = { O: ['TD', '1-pt', '2-pt', '1st down', 'Turnover'], D: ['Stop', 'Takeaway', '1st down', 'TD allowed', '1-pt allowed', '2-pt allowed'] };
const DEFAULT_GAINS = ['Loss', 'No gain', 'Small', 'Medium', 'Big'];
// results that put points on the board: [team, points]
function pointsFor(side, result) {
  const r = String(result || '').toLowerCase();
  if (side === 'O') { if (/^td\b|touchdown/.test(r)) return ['us', 6]; if (/\b1.?pt|one.?point/.test(r)) return ['us', 1]; if (/\b2.?pt|two.?point/.test(r)) return ['us', 2]; }
  else {
    if (/td allowed|touchdown allowed/.test(r)) return ['them', 6]; if (/\b1.?pt/.test(r)) return ['them', 1]; if (/\b2.?pt/.test(r)) return ['them', 2];
    if (/safety/.test(r)) return ['us', 2]; if (/pick.?six|def.*td/.test(r)) return ['us', 6];
  }
  return null;
}
function addPoints(g, team, n, logId) { g.score ||= { us: 0, them: 0, ev: [] }; g.score[team] += n; g.score.ev.push([team, n, logId || null]); }
function removeLogPoints(entry) {
  const g = S.games.find(x => x.id === entry.gameId); if (!g?.score || !entry.pts) return;
  const i = g.score.ev.findIndex(e => e[2] === entry.id); if (i >= 0) g.score.ev.splice(i, 1);
  g.score[entry.pts[0]] = Math.max(0, g.score[entry.pts[0]] - entry.pts[1]);
}
const TOUCH_RX = /^(run|catch|runner)/i;

/* ---------------- storage ---------------- */
const DB = (() => {
  let dbp = null, mem = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('huddle', 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('blobs'); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => { mem = { kv: new Map(), blobs: new Map() }; return null; });
    return dbp;
  }
  async function run(store, mode, fn) {
    const d = await open();
    if (!d) return fn(null, mem[store]);
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    get: (st, k) => run(st, 'readonly', (s, m) => m ? m.get(k) : s.get(k)),
    put: (st, k, v) => run(st, 'readwrite', (s, m) => { if (m) m.set(k, v); else s.put(v, k); }),
    del: (st, k) => run(st, 'readwrite', (s, m) => { if (m) m.delete(k); else s.delete(k); }),
    keys: st => run(st, 'readonly', (s, m) => m ? [...m.keys()] : s.getAllKeys()),
    clear: st => run(st, 'readwrite', (s, m) => { if (m) m.clear(); else s.clear(); }),
    isMemory: () => !!mem
  };
})();

const blobUrls = new Map();
async function putBlob(blob) {
  const id = uid();
  await DB.put('blobs', id, { t: blob.type, b: await blob.arrayBuffer() });
  blobUrls.set(id, URL.createObjectURL(blob));
  return id;
}
async function getBlob(id) {
  if (!id) return null;
  const r = await DB.get('blobs', id);
  return r ? new Blob([r.b], { type: r.t }) : null;
}
async function blobUrl(id) {
  if (!id) return '';
  if (blobUrls.has(id)) return blobUrls.get(id);
  const b = await getBlob(id); if (!b) return '';
  const u = URL.createObjectURL(b); blobUrls.set(id, u); return u;
}
const urlOf = id => (id && blobUrls.get(id)) || '';
async function delBlob(id) {
  if (!id) return;
  await DB.del('blobs', id);
  const u = blobUrls.get(id); if (u) { URL.revokeObjectURL(u); blobUrls.delete(id); }
}

/* ---------------- state ---------------- */
let S = null;
function mkActions(list) { return list.map(([label, multi]) => ({ id: uid(), label, multi: !!multi })); }
function defaultState() {
  const players = Array.from({ length: 12 }, (_, i) => ({
    id: uid(), name: `Player ${i + 1}`, initials: '', number: '', photoId: null, groupId: i < 6 ? 'g1' : 'g2', out: false
  }));
  return {
    v: 4, team: '49ers',
    groups: [{ id: 'g1', name: 'Montana', color: '#AA0000' }, { id: 'g2', name: 'Rice', color: '#B3995D' }],
    colors: { primary: '#AA0000', secondary: '#B3995D' },
    offense: 'g1', players, plays: [], tags: [...DEFAULT_TAGS],
    actions: { O: mkActions(DEFAULT_ACTIONS.O), D: mkActions(DEFAULT_ACTIONS.D) },
    results: { O: [...DEFAULT_RESULTS.O], D: [...DEFAULT_RESULTS.D] }, gains: [...DEFAULT_GAINS],
    games: [], gameId: null, logs: [],
    positions: { O: [...DEFAULT_POSITIONS.O], D: [...DEFAULT_POSITIONS.D] }, lineupMode: 'balanced'
  };
}
/* teams: each team's whole state lives at kv "team:<id>"; kv "teams" is the index */
let TEAMS = { list: [], current: null };
const teamKey = () => 'team:' + TEAMS.current;
function syncTeamIndex() {
  const t = TEAMS.list.find(x => x.id === TEAMS.current); if (!t || !S) return;
  const next = { id: t.id, name: S.team, primary: S.colors?.primary, secondary: S.colors?.secondary };
  if (JSON.stringify(t) !== JSON.stringify(next)) { Object.assign(t, next); DB.put('kv', 'teams', TEAMS).catch(() => { }); }
}
function writeState() { syncTeamIndex(); return DB.put('kv', teamKey(), S); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; return writeState().catch(err => toast('Could not save: ' + err.message)); }, 150);
}
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeState().catch(() => { }); } }
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
function saveNow() { clearTimeout(saveTimer); saveTimer = null; return writeState(); }

const group = id => S.groups.find(g => g.id === id) || S.groups[0];
const otherGroup = () => S.groups.find(g => g.id !== S.offense) || S.groups[1];
const groupForSide = side => side === 'O' ? group(S.offense) : otherGroup();
const player = id => S.players.find(p => p.id === id);
const playById = id => S.plays.find(p => p.id === id);
const firstName = p => { const n = (p?.name || '').trim(); return /^(new )?player\b/i.test(n) ? n : (n.split(/\s+/)[0] || '?'); };
function initials(p) {
  if (!p) return '';
  if (p.initials) return p.initials.slice(0, 3).toUpperCase();
  const parts = (p.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (/^player$/i.test(parts[0]) && parts[1]) return 'P' + parts[1];
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}
function disc(p, extra = '') {
  if (!p) return `<span class="disc ${extra}"></span>`;
  const g = group(p.groupId);
  const inner = p.photoId && urlOf(p.photoId) ? `<img src="${urlOf(p.photoId)}" alt="">` : esc(initials(p));
  return `<span class="disc ${p.qb ? 'qb ' : ''}${extra}" style="${gstyle(g)}">${inner}</span>`;
}
function scoreOf(g) { g ||= currentGame(); return g?.score || { us: 0, them: 0, ev: [] }; }
function renderScore() {
  const el = $('#scorebox'); if (!el) return; const g = currentGame(); const sc = scoreOf(g);
  el.innerHTML = `<b>${sc.us}</b><span class="dash">–</span><b>${sc.them}</b><span class="opp">${esc(g?.opp || 'Opp')}</span>`;
}
function openScore() {
  const g = ensureGame(); g.score ||= { us: 0, them: 0, ev: [] }; const sc = g.score;
  const col = (side, name, val) => `<div class="score-col">
      ${side === 'us' ? `<div class="score-name">${esc(S.team)}</div>` : `<input type="text" id="scoreOpp" class="score-name-input" value="${esc(g.opp)}" placeholder="Opponent" aria-label="Opponent name">`}
      <div class="score-big" aria-live="polite">${val}</div>
      <div class="score-btns">${[6, 7, 8, 2].map(n => `<button type="button" class="btn score-add" data-act="addScore" data-side="${side}" data-n="${n}">+${n}</button>`).join('')}</div>
      <div class="score-fix"><button type="button" class="btn small" data-act="addScore" data-side="${side}" data-n="-1" aria-label="Minus one">−1</button><button type="button" class="btn small" data-act="addScore" data-side="${side}" data-n="1" aria-label="Plus one">+1</button></div>
    </div>`;
  $('#sheetCard').innerHTML = `
    <div class="sheet-head"><h3>Score</h3><span class="muted">${esc(g.date)}</span></div>
    <div class="score-grid">${col('us', S.team, sc.us)}${col('them', g.opp, sc.them)}</div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-act="undoScore" ${sc.ev.length ? '' : 'disabled'}>Undo last</button>
      <button type="button" class="btn primary" data-act="closeSheet">Done</button>
    </div>`;
  $('#sheet').hidden = false;
}
function currentGame() { return S.games.find(g => g.id === S.gameId) || null; }
function ensureGame() {
  const g = currentGame();
  if (g && g.date === todayStr()) return g;
  const ng = { id: uid(), date: todayStr(), opp: '' };
  S.games.push(ng); S.gameId = ng.id;
  S.players.forEach(p => { p.out = false; });
  save();
  return ng;
}
function snapCounts(side, gameId = S.gameId) {
  const c = {};
  for (const l of S.logs) if (l.gameId === gameId && l.side === side) for (const pid of Object.values(l.lineup || {})) c[pid] = (c[pid] || 0) + 1;
  return c;
}
function callCounts(gameId = S.gameId) {
  const c = {};
  for (const l of S.logs) if (l.gameId === gameId && l.playId) c[l.playId] = (c[l.playId] || 0) + 1;
  return c;
}

/* ---------------- lineup logic ---------------- */
function fillLineup(play, gid) {
  const present = S.players.filter(p => p.groupId === gid && !p.out);
  const def = (play.assign && play.assign[gid]) || {};
  const lineup = {}; const used = new Set();
  for (const sp of play.spots) {
    const pid = def[sp.key];
    if (pid && present.some(p => p.id === pid) && !used.has(pid)) { lineup[sp.key] = pid; used.add(pid); }
  }
  const open = play.spots.filter(sp => !lineup[sp.key]);
  if (!open.length) return lineup;
  // who plays: fewest snaps this game, ties broken randomly
  const snaps = snapCounts(play.side); const rnd = new Map(present.map(p => [p.id, Math.random()]));
  const pool = present.filter(p => !used.has(p.id))
    .sort((a, b) => (snaps[a.id] || 0) - (snaps[b.id] || 0) || rnd.get(a.id) - rnd.get(b.id))
    .slice(0, open.length);
  // always have a thrower out there: swap in the QB with the fewest snaps for the last pick
  if (![...used].some(id => player(id)?.qb) && !pool.some(p => p.qb)) {
    const qb = present.filter(p => p.qb && !used.has(p.id)).sort((a, b) => (snaps[a.id] || 0) - (snaps[b.id] || 0) || rnd.get(a.id) - rnd.get(b.id))[0];
    if (qb && pool.length) pool[pool.length - 1] = qb; else if (qb) pool.push(qb);
  }
  // where they play: depends on the roster's lineup mode
  const mode = S.lineupMode || 'balanced'; const pc = positionCounts(play.side);
  const cost = (p, sp) => {
    const played = pc[p.id]?.[sp.label] || 0;
    if (mode === 'random') return Math.random();
    if (mode === 'preferred') {
      const pref = p.pos?.[play.side] || [];
      return (pref.length ? (pref.includes(sp.label) ? 0 : 10) : 1) + played * 0.1 + Math.random() * 0.05;
    }
    return played + Math.random() * 0.5;
  };
  const best = bestAssignment(pool, open, cost);
  best.forEach((p, i) => { if (p) lineup[open[i].key] = p.id; });
  return lineup;
}
function positionCounts(side, gameId = S.gameId) {
  const c = {};
  for (const l of S.logs) if (l.gameId === gameId && l.side === side) for (const [k, pid] of Object.entries(l.lineup || {})) {
    const lab = labelOfKey(k); (c[pid] ||= {})[lab] = (c[pid][lab] || 0) + 1;
  }
  return c;
}
// lowest-total-cost assignment of players to open spots (tiny sizes, so try every permutation)
function bestAssignment(pool, spots, cost) {
  const n = spots.length; const C = pool.map(p => spots.map(sp => cost(p, sp)));
  let best = null, bestCost = Infinity; const pick = new Array(n).fill(-1); const usedP = new Array(pool.length).fill(false);
  (function go(i, acc) {
    if (acc >= bestCost) return;
    if (i === n) { bestCost = acc; best = pick.slice(); return; }
    let any = false;
    for (let j = 0; j < pool.length; j++) if (!usedP[j]) { any = true; usedP[j] = true; pick[i] = j; go(i + 1, acc + C[j][i]); usedP[j] = false; }
    if (!any) { pick[i] = -1; go(i + 1, acc); }
  })(0, 0);
  return (best || []).map(j => (j >= 0 ? pool[j] : null));
}

/* ---------------- ui state ---------------- */
const ui = {
  view: 'library', side: lsGet('side') === 'D' ? 'D' : 'O', tags: new Set(), q: '',
  playId: null, live: new Map(), book: lsGet('book') === 'plan' ? 'plan' : 'all', editing: false, selected: new Set(), shownIds: [], navIds: [], navBook: 'all', showOther: false, sel: null, benchSel: null,
  edit: null, statsScope: 'game', statsGame: null, logDraft: null, importState: null, photoFor: null,
  lastLineup: {}, flips: new Set(), draw: { on: false, erase: false, color: '#e0161f', arrow: true }
};

function showView(v) {
  ui.view = v;
  for (const s of $$('#views > .view')) {
    s.hidden = s.id !== 'view-' + v;
    if (s.hidden && s.classList.contains('view-full')) s.innerHTML = ''; // stage ids must be unique
  }
  const tabView = ['play', 'edit'].includes(v) ? 'library' : v;
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === tabView));
  if (v === 'play') wake(true); else wake(false);
}
function render() {
  $('#teamName').textContent = S.team || 'Team'; applyTheme(); renderScore();
  ({ library: renderLibrary, play: renderPlay, edit: renderEdit, roster: renderRoster, stats: renderStats, setup: renderSetup })[ui.view]?.();
}
function go(v) { showView(v); render(); $('#view-' + v).scrollTop = 0; }

/* ---------------- toast / confirm ---------------- */
let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" id="toastBtn">${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) $('#toastBtn').onclick = () => { t.hidden = true; action.fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 2600);
}
// two-tap confirm for destructive buttons (browser dialogs are unreliable in home-screen apps)
function armed(btn, label = 'Tap again to confirm') {
  if (btn.dataset.armed === '1') return true;
  const orig = btn.innerHTML; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = orig; } }, 3500);
  return false;
}

/* ---------------- wake lock ---------------- */
let wakeLock = null;
async function wake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ui.view === 'play') wake(true); });

/* ================= LIBRARY ================= */
function renderLibrary() {
  const el = $('#view-library'); const oG = group(S.offense), dG = otherGroup();
  const planN = S.plays.filter(p => p.inPlan).length;
  el.innerHTML = `
  <div class="lib-head">
    <div class="seg seg-book">
      <button type="button" class="${ui.book === 'all' ? 'on' : ''}" data-act="book" data-b="all">Playbook</button>
      <button type="button" class="${ui.book === 'plan' ? 'on' : ''}" data-act="book" data-b="plan">Game Plan <span class="count">${planN}</span></button>
    </div>
    <div class="seg seg-side">
      <button type="button" class="${ui.side === 'O' ? 'on' : ''}" data-act="side" data-side="O"><b>Offense</b><small class="gdot" style="${gstyle(oG)}">${esc(oG.name)}</small></button>
      <button type="button" class="${ui.side === 'D' ? 'on' : ''}" data-act="side" data-side="D"><b>Defense</b><small class="gdot" style="${gstyle(dG)}">${esc(dG.name)}</small></button>
    </div>
    <button type="button" class="btn ghost" data-act="swapGroups">⇄ Swap groups</button>
    <div class="spacer"></div>
    <input id="q" class="search" type="search" placeholder="Search plays" value="${esc(ui.q)}" autocomplete="off">
    ${ui.editing ? '' : `<button type="button" class="btn" data-act="editLib">Edit</button>
         <button type="button" class="btn" data-act="quickLog">Quick log</button>
         <button type="button" class="btn primary" data-act="openImport">Import plays</button>`}
  </div>
  ${ui.editing ? `<div class="editbar" id="editbar"></div>` : ''}
  <div id="tagbar" class="tagbar"></div>
  <div id="grid" class="grid"></div>`;
  renderGrid();
}
// game plan keeps its own order; plays added later go to the end
function planSorted(plays) {
  const ord = S.planOrder || []; const at = id => { const i = ord.indexOf(id); return i < 0 ? 1e6 : i; };
  return plays.slice().sort((a, b) => at(a.id) - at(b.id));
}
function movePlay(id, targetId, after) {
  if (id === targetId) return;
  if (ui.book === 'plan') {
    const ids = planSorted(S.plays.filter(p => p.inPlan)).map(p => p.id).filter(x => x !== id);
    ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, id); S.planOrder = ids;
  } else {
    const p = playById(id); S.plays = S.plays.filter(x => x.id !== id);
    S.plays.splice(S.plays.findIndex(x => x.id === targetId) + (after ? 1 : 0), 0, p);
  }
  save(); renderGrid();
}
/* reorder: press & hold (touch) or click & drag (mouse) a thumbnail, drop it before/after another */
let dragState = null;
function bindGridDrag() {
  const grid = $('#grid'); if (!grid || grid.dataset.bound) return; grid.dataset.bound = '1';
  grid.addEventListener('contextmenu', e => { if (e.target.closest('.card')) e.preventDefault(); });
  grid.addEventListener('touchmove', e => { if (dragState?.on) e.preventDefault(); }, { passive: false });
  grid.addEventListener('pointerdown', e => {
    const card = e.target.closest('.card'); if (!card || ui.editing || e.button > 0) return;
    const st = dragState = { on: false, id: card.dataset.id, sx: e.clientX, sy: e.clientY, target: null, after: false, timer: null, ghost: null, raf: null };
    const begin = () => {
      st.on = true; try { navigator.vibrate?.(12); } catch { /* ignore */ }
      const r = card.getBoundingClientRect(); st.dx = st.sx - r.left; st.dy = st.sy - r.top;
      const g = card.cloneNode(true); g.classList.add('drag-ghost'); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
      document.body.appendChild(g); st.ghost = g; card.classList.add('lifted'); grid.classList.add('reordering');
    };
    if (e.pointerType === 'mouse') { /* starts on movement */ } else st.timer = setTimeout(begin, 420);
    const view = $('#view-library');
    const autoScroll = y => {
      cancelAnimationFrame(st.raf);
      const vr = view.getBoundingClientRect(); const v = y < vr.top + 70 ? -14 : y > vr.bottom - 70 ? 14 : 0;
      if (v) { view.scrollTop += v; st.raf = requestAnimationFrame(() => autoScroll(y)); }
    };
    const move = ev => {
      const dist = Math.hypot(ev.clientX - st.sx, ev.clientY - st.sy);
      if (!st.on) {
        if (e.pointerType === 'mouse' && dist > 8) begin();
        else if (dist > 10) { clearTimeout(st.timer); end(); return; }   // finger moved first: it's a scroll
        if (!st.on) return;
      }
      ev.preventDefault();
      st.ghost.style.left = ev.clientX - st.dx + 'px'; st.ghost.style.top = ev.clientY - st.dy + 'px';
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#grid .card');
      $$('#grid .drop-before, #grid .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      st.target = t && t !== card ? t : null;
      if (st.target) { const r = st.target.getBoundingClientRect(); st.after = ev.clientX > r.left + r.width / 2; st.target.classList.add(st.after ? 'drop-after' : 'drop-before'); }
      autoScroll(ev.clientY);
    };
    const end = () => {
      clearTimeout(st.timer); cancelAnimationFrame(st.raf);
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel);
      st.ghost?.remove(); card.classList.remove('lifted'); grid.classList.remove('reordering');
      $$('#grid .drop-before, #grid .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      dragState = null;
    };
    const up = () => {
      const was = st.on, tgt = st.target?.dataset.id, after = st.after; end();
      if (was) { ui.suppressClick = true; setTimeout(() => { ui.suppressClick = false; }, 80); if (tgt) movePlay(st.id, tgt, after); }
    };
    const cancel = () => { if (!st.on) end(); };   // iOS cancels the pointer once a drag is under way; ignore that
    addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
  });
}
function renderEditBar() {
  const bar = $('#editbar'); if (!bar) return;
  const sel = [...ui.selected].map(playById).filter(Boolean); const n = sel.length;
  bar.innerHTML = `<b class="editcount">${n ? `${n} selected` : 'Tap plays to select them'}</b>
    <button type="button" class="btn small ghost" data-act="selectAll">Select all</button>
    <div class="spacer"></div>
    ${ui.book === 'all' ? `<button type="button" class="btn primary" data-act="planAdd" ${n ? '' : 'disabled'}>Add to game plan</button>` : ''}
    ${sel.some(p => p.inPlan) ? `<button type="button" class="btn" data-act="planRemove">Remove from game plan</button>` : ''}
    <button type="button" class="btn danger" data-act="deleteSel" ${n ? '' : 'disabled'}>Delete${n ? ` ${n}` : ''}</button>
    <button type="button" class="btn" data-act="cancelEdit">Cancel</button>`;
}
function renderGrid() {
  renderEditBar();
  let plays = S.plays.filter(p => p.side === ui.side && (ui.book === 'all' || p.inPlan));
  if (ui.book === 'plan') plays = planSorted(plays);
  const tagsHere = [...new Set(plays.flatMap(p => p.tags))].sort((a, b) => a.localeCompare(b));
  for (const t of [...ui.tags]) if (!tagsHere.includes(t)) ui.tags.delete(t);
  $('#tagbar').innerHTML = tagsHere.map(t => `<button type="button" class="tagchip ${ui.tags.has(t) ? 'on' : ''}" data-act="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')
    + (ui.tags.size ? `<button type="button" class="tagchip" data-act="clearTags">Clear</button>` : '');
  const q = ui.q.trim().toLowerCase();
  const shown = plays.filter(p => [...ui.tags].every(t => p.tags.includes(t)) &&
    (!q || p.name.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q))));
  const calls = callCounts();
  const grid = $('#grid');
  if (!plays.length && ui.book === 'plan' && S.plays.some(p => p.side === ui.side)) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Nothing in the game plan yet</h3>
      <p class="muted">Pick the ${ui.side === 'O' ? 'plays' : 'formations'} you want for this game from the full playbook.</p>
      <button type="button" class="btn primary" data-act="startPicking">Choose plays from the playbook</button></div>`;
    return;
  }
  if (!plays.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No ${ui.side === 'O' ? 'offensive plays' : 'defensive formations'} yet</h3>
      <p class="muted">Import your Google Doc playbook, play images, or a PDF.</p>
      <button type="button" class="btn primary" data-act="openImport">Import plays</button></div>`;
    return;
  }
  ui.shownIds = shown.map(p => p.id);
  if (!shown.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No plays match</h3><button type="button" class="btn" data-act="clearTags">Clear filters</button></div>`; return; }
  bindGridDrag();
  grid.innerHTML = shown.map(p => `
    <button type="button" class="card${ui.editing ? ' picking' + (ui.selected.has(p.id) ? ' selected' : '') : ''}${p.inPlan && ui.book === 'all' ? ' in-plan' : ''}" data-act="${ui.editing ? 'toggleSel' : 'openPlay'}" data-id="${p.id}">
      <div class="thumb"><img src="${urlOf(p.thumbId)}" alt="" loading="lazy">${ui.editing ? `<span class="check" aria-label="${ui.selected.has(p.id) ? 'Selected' : 'Not selected'}">${ui.selected.has(p.id) ? '✓' : ''}</span>` : ''}${p.inPlan && ui.book === 'all' ? '<span class="gp-badge">Game plan</span>' : ''}</div>
      <div class="card-body">
        <div class="card-row"><span class="card-name">${esc(p.name)}</span>${p.ink?.length ? '<span class="called" title="Has drawings">✎</span>' : ''}${calls[p.id] ? `<span class="called" title="Called this game">${calls[p.id]}×</span>` : ''}</div>
        ${p.tags.length ? `<div class="pills">${p.tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </button>`).join('');
}

/* ================= PLAY (game) VIEW ================= */
function liveFor(play) {
  const gid = groupForSide(play.side).id;
  let L = ui.live.get(play.id);
  if (!L || L.groupId !== gid) { L = { groupId: gid, lineup: fillLineup(play, gid), pos: {} }; ui.live.set(play.id, L); }
  const keys = new Set(play.spots.map(s => s.key));
  for (const k of Object.keys(L.lineup)) if (!keys.has(k) || !player(L.lineup[k])) delete L.lineup[k];
  return L;
}
function openPlay(id, keepNav) {
  if (!keepNav) { ui.navIds = (ui.shownIds || []).slice(); ui.navBook = ui.book; }
  ui.playId = id; ui.sel = null; ui.benchSel = null; ui.draw.on = false; go('play');
}
function stepPlay(dir) {
  const ids = ui.navIds.filter(id => playById(id)); const i = ids.indexOf(ui.playId); const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  openPlay(ids[j], true);
}
function renderPlay() {
  const p = playById(ui.playId); if (!p) return go('library');
  const L = liveFor(p); const g = group(L.groupId);
  const el = $('#view-play');
  el.innerHTML = `
  <div class="play-top">
    <button type="button" class="btn ghost" data-act="back">‹ Plays</button>
    <div class="play-title"><h2>${esc(p.name)}</h2>
      <div class="play-sub"><span class="gdot" style="${gstyle(g)}">${p.side === 'O' ? 'Offense' : 'Defense'} · ${esc(g.name)}</span>${p.tags.length ? ' · ' + p.tags.map(esc).join(', ') : ''}</div></div>
    <div class="play-tools">
      <button type="button" class="btn" data-act="rotate" title="Everyone moves one spot; next bench player comes in">Rotate</button>
      <button type="button" class="btn ${ui.flips.has(p.id) ? 'toggled' : ''}" data-act="flip" title="Mirror the play left/right">Flip</button>
      <button type="button" class="btn ${ui.draw.on ? 'toggled' : ''}" data-act="drawMode" title="Draw on the play">Draw</button>
      <button type="button" class="btn" data-act="resetLive" title="Default lineup and spots; un-flip">Reset</button>
      <button type="button" class="btn" data-act="saveDefault" title="Make this the default lineup for this play">Save lineup</button>
      <button type="button" class="btn" data-act="editPlay">Edit</button>
    </div>
    <button type="button" class="btn log" data-act="openLog">LOG</button>
  </div>
  <div class="hint" id="hint"></div>
  <div class="stage-wrap" id="stageWrap">${navArrows(p)}<div class="stage${ui.flips.has(p.id) ? ' flipped' : ''}${ui.draw.on ? ' drawing' : ''}${ui.draw.erase ? ' erasing' : ''}" id="stage"><img id="stageImg" alt=""><svg id="ink" class="ink" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div id="tokens"></div></div></div>
  <div class="bench" id="bench"></div>`;
  setupStage(p, 'live');
  renderBench();
  renderHint();
}
function navArrows(p) {
  const ids = ui.navIds.filter(id => playById(id)); const i = ids.indexOf(p.id);
  if (i < 0 || ids.length < 2) return '';
  const lbl = ui.navBook === 'plan' ? 'game plan' : 'playbook';
  return `<button type="button" class="navarrow prev" data-act="prevPlay" ${i === 0 ? 'disabled' : ''} aria-label="Previous play in ${lbl}">‹</button>
    <button type="button" class="navarrow next" data-act="nextPlay" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="Next play in ${lbl}">›</button>
    <span class="navpos">${i + 1} / ${ids.length} · ${lbl}</span>`;
}
async function setupStage(p, mode) {
  const img = $('#stageImg');
  img.onload = () => { fitStage(); renderTokens(); renderInk(); };
  img.src = await blobUrl(p.imgId);
  bindStage(mode);
}
function fitStage() {
  const wrap = $('#stageWrap'), stage = $('#stage'), img = $('#stageImg');
  if (!wrap || !stage || !img || !img.naturalWidth) return;
  const cs = getComputedStyle(wrap);
  const W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const r = img.naturalWidth / img.naturalHeight;
  let w = Math.min(W, H * r); let h = w / r;
  w = Math.max(w, 100); h = Math.max(h, 60);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  stage.style.setProperty('--tk', clamp(Math.round(w * 0.062), 36, 76) + 'px');
}
window.addEventListener('resize', () => { if (ui.view === 'play' || ui.view === 'edit') { fitStage(); renderTokens(); } });

function renderTokens() {
  const box = $('#tokens'); if (!box) return;
  if (ui.view === 'edit') return renderSpotTokens();
  const p = playById(ui.playId); const L = liveFor(p); const fl = ui.flips.has(p.id);
  box.innerHTML = p.spots.map(sp => {
    const raw = L.pos[sp.key] || sp; const pos = { x: fl ? 100 - raw.x : raw.x, y: raw.y }; const pl = player(L.lineup[sp.key]);
    const tk = tokenSize(p, sp);
    const sel = ui.sel === sp.key ? ' sel' : '';
    if (!pl) return `<div class="token empty${sel}" data-spot="${sp.key}" style="left:${pos.x}%;top:${pos.y}%;${tk}"><span class="disc">${esc(sp.label)}</span></div>`;
    return `<div class="token${sel}" data-spot="${sp.key}" style="left:${pos.x}%;top:${pos.y}%;${tk}">${disc(pl)}<span class="tpos">${esc(sp.label)}</span>${pl.qb ? '<span class="tqb" title="Thrower">QB</span>' : ''}</div>`;
  }).join('');
}
// player circles match the markers found in the drawing (sp.d = diameter as % of drawing width)
function tokenSize(p, sp) {
  const stage = $('#stage'); const w = stage ? stage.clientWidth : 0; if (!w) return '';
  let d = sp.d; if (!d) { const ds = p.spots.map(x => x.d).filter(Boolean).sort((a, b) => a - b); d = ds[Math.floor(ds.length / 2)]; }
  if (!d) return '';
  return `--tk:${Math.max(26, Math.round(w * d / 100))}px`;
}
function renderBench() {
  const p = playById(ui.playId); const L = liveFor(p); const bench = $('#bench'); if (!bench) return;
  const onField = new Set(Object.values(L.lineup));
  const snaps = snapCounts(p.side);
  const mine = S.players.filter(x => x.groupId === L.groupId && !onField.has(x.id)).sort((a, b) => a.out - b.out);
  const others = ui.showOther ? S.players.filter(x => x.groupId !== L.groupId && !onField.has(x.id) && !x.out) : [];
  const og = S.groups.find(g2 => g2.id !== L.groupId);
  const chip = x => `<div class="pchip${ui.benchSel === x.id ? ' sel' : ''}${x.out ? ' out' : ''}" data-pid="${x.id}">${disc(x)}<b>${esc(firstName(x))}</b><span class="snaps">${x.out ? 'OUT' : (snaps[x.id] || 0) + ' snaps'}</span></div>`;
  bench.innerHTML = `<span class="bench-label">Bench</span>` + (mine.length ? mine.map(chip).join('') : '<span class="muted">Everyone is on the field</span>')
    + others.map(chip).join('')
    + `<button type="button" class="btn small ghost" data-act="toggleOther">${ui.showOther ? 'Hide ' : '+ '}${esc(og?.name || 'others')}</button>`;
  bindBench();
}
function renderHint() {
  const h = $('#hint'); if (!h) return;
  const p = playById(ui.playId); const L = liveFor(p);
  if (ui.draw.on) {
    h.className = 'hint active';
    h.innerHTML = `<div class="inkbar">${INK_COLORS.map(c => `<button type="button" class="inkc ${!ui.draw.erase && ui.draw.color === c ? 'on' : ''}" style="background:${c}" data-act="inkColor" data-c="${c}" aria-label="Pen color"></button>`).join('')}
      <button type="button" class="btn small ${ui.draw.arrow ? 'toggled' : ''}" data-act="inkArrow">Arrow</button>
      <button type="button" class="btn small ${ui.draw.erase ? 'toggled' : ''}" data-act="inkErase">Eraser</button>
      <button type="button" class="btn small" data-act="inkUndo" ${(p.ink || []).length ? '' : 'disabled'}>Undo</button>
      <button type="button" class="btn small danger" data-act="inkClear" ${(p.ink || []).length ? '' : 'disabled'}>Clear all</button>
      <span class="muted">${ui.draw.erase ? 'Tap a line to erase it.' : 'Drawings stay on this play until you clear them.'}</span>
      <button type="button" class="btn small primary" data-act="drawMode">Done</button></div>`;
    return;
  }
  if (ui.sel) {
    const pl = player(L.lineup[ui.sel]);
    h.className = 'hint active';
    h.innerHTML = `<span><b>${esc(pl ? pl.name : 'Empty spot')}</b> selected. Tap a bench player to sub in, or another player to swap spots.</span>
      ${pl ? `<button type="button" class="btn small" data-act="benchIt">Take out</button><button type="button" class="btn small danger" data-act="sitOut">Out for today</button>` : ''}
      <button type="button" class="btn small ghost" data-act="clearSel">Cancel</button>`;
  } else if (ui.benchSel) {
    h.className = 'hint active';
    h.innerHTML = `<span><b>${esc(player(ui.benchSel)?.name)}</b> is going in. Tap the player coming out.</span><button type="button" class="btn small ghost" data-act="clearSel">Cancel</button>`;
  } else {
    h.className = 'hint';
    h.textContent = 'Tap a player to sub or swap. Drag a player onto another to swap them, or anywhere else to show where they go.';
  }
}
function refreshLive() { renderTokens(); renderBench(); renderHint(); }

function subIn(spotKey, pid) {
  const p = playById(ui.playId); const L = liveFor(p);
  for (const k of Object.keys(L.lineup)) if (L.lineup[k] === pid) delete L.lineup[k];
  L.lineup[spotKey] = pid;
  const pl = player(pid); if (pl && pl.out) { pl.out = false; save(); }
  ui.sel = null; ui.benchSel = null; refreshLive();
}
// dropped one player on another: they trade spots; the dragged circle snaps back to its spot
function swapSpots(a, b) {
  const L = liveFor(playById(ui.playId));
  delete L.pos[a];
  const pa = L.lineup[a], pb = L.lineup[b];
  if (pb) L.lineup[a] = pb; else delete L.lineup[a];
  if (pa) L.lineup[b] = pa; else delete L.lineup[b];
  ui.sel = null; ui.benchSel = null; refreshLive();
}
function tapToken(key) {
  const L = liveFor(playById(ui.playId));
  if (ui.benchSel) return subIn(key, ui.benchSel);
  if (!ui.sel) ui.sel = key;
  else if (ui.sel === key) ui.sel = null;
  else { const a = L.lineup[ui.sel], b = L.lineup[key]; if (b) L.lineup[ui.sel] = b; else delete L.lineup[ui.sel]; if (a) L.lineup[key] = a; else delete L.lineup[key]; ui.sel = null; }
  refreshLive();
}
function tapBench(pid) {
  if (ui.sel) return subIn(ui.sel, pid);
  ui.benchSel = ui.benchSel === pid ? null : pid; refreshLive();
}

/* pointer handling on the stage: tap vs drag */
function bindStage(mode) {
  const stage = $('#stage');
  stage.onpointerdown = e => {
    if (mode === 'edit' && ui.edit?.crop) return startCrop(e);
    if (mode === 'live' && ui.draw.on) return ui.draw.erase ? eraseAt(e) : startStroke(e);
    const tk = e.target.closest('.token');
    if (!tk) { if (mode === 'live' && (ui.sel || ui.benchSel)) { ui.sel = null; ui.benchSel = null; refreshLive(); } return; }
    e.preventDefault();
    const key = tk.dataset.spot; const rect = stage.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY; let dragging = false; let hot = null;
    try { tk.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { dragging = true; tk.classList.add('dragging'); }
      if (!dragging) return;
      if (mode === 'live') { // is the finger over another player? (swap target)
        tk.style.pointerEvents = 'none';
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.token');
        tk.style.pointerEvents = '';
        const nh = t && t !== tk ? t : null;
        if (nh !== hot) { hot?.classList.remove('drop-hot'); hot = nh; hot?.classList.add('drop-hot'); }
      }
      const x = clamp((ev.clientX - rect.left) / rect.width * 100, 0, 100), y = clamp((ev.clientY - rect.top) / rect.height * 100, 0, 100);
      tk.style.left = x + '%'; tk.style.top = y + '%';
      if (mode === 'live') liveFor(playById(ui.playId)).pos[key] = { x: ui.flips.has(ui.playId) ? 100 - x : x, y };
      else { const sp = playById(ui.edit.playId).spots.find(s => s.key === key); if (sp) { sp.x = +x.toFixed(2); sp.y = +y.toFixed(2); } }
    };
    const up = () => {
      tk.removeEventListener('pointermove', move); tk.removeEventListener('pointerup', up); tk.removeEventListener('pointercancel', up);
      tk.classList.remove('dragging');
      if (mode === 'live' && hot) { hot.classList.remove('drop-hot'); swapSpots(key, hot.dataset.spot); return; }
      if (mode === 'live') { if (!dragging) tapToken(key); }
      else { if (dragging) save(); else { ui.edit.selSpot = ui.edit.selSpot === key ? null : key; renderSpotTokens(); renderEditPanel(); } }
    };
    tk.addEventListener('pointermove', move); tk.addEventListener('pointerup', up); tk.addEventListener('pointercancel', up);
  };
}
/* ---- marker (ink) layer: strokes stored per play in unflipped % coordinates ---- */
const INK_COLORS = ['#e0161f', '#1f5fd6', '#111111', '#12a150', '#f08c00'];
function inkPts(pts, fl) { return pts.map(([x, y]) => `${(fl ? 100 - x : x).toFixed(2)},${y.toFixed(2)}`).join(' '); }
function renderInk() {
  const svg = $('#ink'); if (!svg) return;
  const p = playById(ui.playId); const fl = ui.flips.has(p.id);
  svg.innerHTML = (p.ink || []).map((st, i) => `<g data-i="${i}">
    <polyline class="ink-hit" points="${inkPts(st.pts, fl)}"/>
    <polyline points="${inkPts(st.pts, fl)}" fill="none" stroke="${st.c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${st.head ? `<polygon points="${inkPts(st.head, fl)}" fill="${st.c}" stroke="${st.c}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}</g>`).join('');
}
function arrowHead(pts, rect) {
  if (pts.length < 2) return null;
  const px = ([x, y]) => [x / 100 * rect.width, y / 100 * rect.height];
  const tip = px(pts[pts.length - 1]); let back = null;
  for (let i = pts.length - 2; i >= 0; i--) { const q = px(pts[i]); if (Math.hypot(tip[0] - q[0], tip[1] - q[1]) > 14) { back = q; break; } }
  if (!back) return null;
  const a = Math.atan2(tip[1] - back[1], tip[0] - back[0]); const L = 20;
  const pt = ang => [tip[0] - L * Math.cos(a + ang), tip[1] - L * Math.sin(a + ang)];
  const tipX = [tip[0] + 4 * Math.cos(a), tip[1] + 4 * Math.sin(a)];
  return [pt(0.45), tipX, pt(-0.45)].map(([x, y]) => [x / rect.width * 100, y / rect.height * 100]);
}
function startStroke(e) {
  e.preventDefault();
  const stage = $('#stage'); const rect = stage.getBoundingClientRect(); const p = playById(ui.playId);
  const fl = ui.flips.has(p.id);
  const at = ev => { const x = clamp((ev.clientX - rect.left) / rect.width * 100, 0, 100), y = clamp((ev.clientY - rect.top) / rect.height * 100, 0, 100); return [fl ? 100 - x : x, y]; };
  const st = { c: ui.draw.color, pts: [at(e)], head: null };
  p.ink ||= []; p.ink.push(st);
  try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const move = ev => {
    const q = at(ev); const last = st.pts[st.pts.length - 1];
    if (Math.hypot((q[0] - last[0]) * rect.width, (q[1] - last[1]) * rect.height) / 100 < 3) return;
    st.pts.push(q); renderInk();
  };
  const up = () => {
    stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up);
    if (st.pts.length < 2) { p.ink.pop(); renderInk(); return; }
    st.pts = st.pts.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
    if (ui.draw.arrow) {
      const fr = { width: rect.width, height: rect.height };
      st.head = arrowHead(st.pts, fr); if (st.head) st.head = st.head.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
    }
    save(); renderInk(); renderHint();
  };
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
}
function eraseAt(e) {
  e.preventDefault();
  const g = e.target.closest('#ink g[data-i]'); if (!g) return;
  const p = playById(ui.playId); p.ink.splice(+g.dataset.i, 1); save(); renderInk(); renderHint();
}
/* bench chips: tap to select, or drag onto a player on the field */
function bindBench() {
  for (const chip of $$('#bench .pchip')) {
    chip.onpointerdown = e => {
      e.preventDefault();
      const pid = chip.dataset.pid; const sx = e.clientX, sy = e.clientY; let ghost = null, hot = null;
      try { chip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) {
          ghost = document.createElement('div'); ghost.className = 'ghost-chip';
          ghost.innerHTML = disc(player(pid)); ghost.style.setProperty('--tk', '56px'); document.body.appendChild(ghost);
        }
        if (!ghost) return;
        ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.token');
        if (hot !== t) { hot?.classList.remove('drop-hot'); hot = t; hot?.classList.add('drop-hot'); }
      };
      const up = () => {
        chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
        if (ghost) { ghost.remove(); hot?.classList.remove('drop-hot'); if (hot) subIn(hot.dataset.spot, pid); }
        else tapBench(pid);
      };
      chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
    };
  }
}

function rotateLive() {
  const p = playById(ui.playId); const L = liveFor(p);
  const keys = p.spots.map(s => s.key);
  const onField = keys.map(k => L.lineup[k]).filter(Boolean);
  const snaps = snapCounts(p.side);
  const bench = S.players.filter(x => x.groupId === L.groupId && !x.out && !onField.includes(x.id))
    .sort((a, b) => (snaps[a.id] || 0) - (snaps[b.id] || 0));
  const seq = keys.map(k => L.lineup[k] || null);
  if (bench.length) seq.push(bench[0].id);
  if (seq.filter(Boolean).length < 2) return;
  const shifted = seq.slice(1).concat(seq.slice(0, 1));
  L.lineup = {};
  keys.forEach((k, i) => { if (shifted[i]) L.lineup[k] = shifted[i]; });
  ui.sel = null; ui.benchSel = null; refreshLive();
}

/* ================= LOG SHEET ================= */
function openLog(play, lineup, groupId) {
  ui.logDraft = { play, side: play.side, groupId, lineup: { ...lineup }, marks: {}, result: null };
  renderLog(); $('#sheet').hidden = false;
}
function renderLog() {
  const d = ui.logDraft; const g = group(d.groupId);
  const kids = d.play.spots.map(sp => ({ sp, p: player(d.lineup[sp.key]) })).filter(k => k.p);
  const acts = S.actions[d.side];
  $('#sheetCard').innerHTML = `
    <div class="sheet-head"><h3>${esc(d.play.name)}</h3><span class="muted">${d.side === 'O' ? 'Offense' : 'Defense'} · ${esc(g.name)}</span></div>
    <div class="log-rows" style="--n:${Math.max(kids.length, 1)}">
      ${acts.map(a => `<div class="log-row"><div class="log-label">${esc(a.label)}</div>
        ${kids.map(k => `<button type="button" class="kid ${(d.marks[a.id] || []).includes(k.p.id) ? 'on' : ''}" data-act="mark" data-a="${a.id}" data-p="${k.p.id}">${disc(k.p)}<span class="kname">${esc(firstName(k.p))}</span></button>`).join('')}
      </div>`).join('')}
    </div>
    <div class="results"><span class="label">Yards</span>
      ${(S.gains || DEFAULT_GAINS).map(gn => `<button type="button" class="tagchip ${d.gain === gn ? 'on' : ''}" data-act="gain" data-g="${esc(gn)}">${esc(gn)}</button>`).join('')}
    </div>
    <div class="results"><span class="label">Result</span>
      ${S.results[d.side].map(r => { const pt = pointsFor(d.side, r); return `<button type="button" class="tagchip ${d.result === r ? 'on' : ''}" data-act="result" data-r="${esc(r)}">${esc(r)}${pt ? `<span class="pts ${pt[0]}">+${pt[1]}</span>` : ''}</button>`; }).join('')}
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-act="closeSheet">Cancel</button>
      <button type="button" class="btn primary" data-act="saveLog">Save</button>
    </div>`;
}
function saveLog() {
  const d = ui.logDraft; const g = ensureGame();
  const entry = { id: uid(), t: Date.now(), gameId: g.id, playId: d.play.id || null, flip: !!(d.play.id && ui.flips.has(d.play.id)), side: d.side, groupId: d.groupId, lineup: d.lineup, marks: d.marks, result: d.result, gain: d.gain || null };
  const pts = pointsFor(d.side, d.result);
  if (pts) { entry.pts = pts; addPoints(g, pts[0], pts[1], entry.id); }
  S.logs.push(entry); save(); renderScore();
  ui.lastLineup[d.side + d.groupId] = d.lineup;
  if (d.play.id) ui.live.delete(d.play.id);
  closeSheet(); ui.logDraft = null; ui.sel = null; ui.benchSel = null; ui.draw.on = false;
  go('library');
  const sc = scoreOf(g);
  toast(`Logged ${d.play.name}${pts ? ` · +${pts[1]} ${pts[0] === 'us' ? S.team : (g.opp || 'Opp')} (${sc.us}–${sc.them})` : ''}`, { label: 'Undo', fn: () => { removeLogPoints(entry); S.logs = S.logs.filter(l => l.id !== entry.id); save(); render(); renderScore(); toast('Log removed'); } });
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetCard').innerHTML = ''; ui.importState = null; }

function quickLog() {
  const g = groupForSide(ui.side);
  const pseudo = { id: null, name: 'Quick log', side: ui.side, spots: DEFAULT_SPOTS[ui.side], assign: {} };
  const lineup = ui.lastLineup[ui.side + g.id] || fillLineup(pseudo, g.id);
  const keys = Object.keys(lineup);
  pseudo.spots = keys.length && !keys.every(k => pseudo.spots.some(s => s.key === k)) ? keys.map(k => ({ key: k, label: k })) : pseudo.spots;
  openLog(pseudo, lineup, g.id);
}

/* ================= EDIT PLAY ================= */
function editPlay(id) { ui.edit = { playId: id, selSpot: null, crop: null }; go('edit'); }
function renderEdit() {
  const p = playById(ui.edit?.playId); if (!p) return go('library');
  const others = S.plays.filter(o => o.id !== p.id && o.side === p.side);
  $('#view-edit').innerHTML = `
  <div class="edit-top">
    <button type="button" class="btn primary" data-act="doneEdit">Done</button>
    <input id="ename" class="name-input" type="text" value="${esc(p.name)}" aria-label="Play name">
    <div class="seg">
      <button type="button" class="${p.side === 'O' ? 'on' : ''}" data-act="setSide" data-side="O">Offense</button>
      <button type="button" class="${p.side === 'D' ? 'on' : ''}" data-act="setSide" data-side="D">Defense</button>
    </div>
    <button type="button" class="btn danger" data-act="deletePlay">Delete play</button>
  </div>
  <div class="edit-body">
    <div class="edit-col">
      <div class="hint">${ui.edit.crop ? 'Drag across the drawing to pick the area to keep.' : 'Drag each circle onto the matching player in the drawing. Tap a circle to rename or remove it.'}</div>
      <div class="stage-wrap" id="stageWrap"><div class="stage" id="stage"><img id="stageImg" alt=""><div id="tokens"></div><div id="cropBox" class="crop-box" hidden></div></div></div>
      <div class="edit-tools">
        ${ui.edit.crop
          ? `<button type="button" class="btn primary" data-act="applyCrop">Apply crop</button><button type="button" class="btn" data-act="cancelCrop">Cancel</button>`
          : `<button type="button" class="btn primary" data-act="findPlayers">Find players</button>
             <button type="button" class="btn" data-act="fixProportions">Fix proportions</button>
             <button type="button" class="btn" data-act="narrower" aria-label="Make drawing narrower">↔ Narrower</button>
             <button type="button" class="btn" data-act="wider" aria-label="Make drawing wider">↔ Wider</button>
             <button type="button" class="btn" data-act="addSpot">+ Add spot</button>
             <button type="button" class="btn" data-act="startCrop">Crop</button>
             <button type="button" class="btn" data-act="rotateImg">Rotate 90°</button>
             <button type="button" class="btn" data-act="flipImg">Flip image</button>
             <button type="button" class="btn" data-act="replaceImg">Replace image</button>
             ${others.length ? `<select id="copySpots" aria-label="Copy spots from another play"><option value="">Copy spots from…</option>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : ''}`}
      </div>
    </div>
    <aside class="edit-panel" id="editPanel"></aside>
  </div>`;
  setupStage(p, 'edit');
  renderEditPanel();
}
function renderSpotTokens() {
  const p = playById(ui.edit.playId); const box = $('#tokens'); if (!box) return;
  box.hidden = !!ui.edit.crop;
  box.innerHTML = p.spots.map(sp => `<div class="token spot${ui.edit.selSpot === sp.key ? ' sel' : ''}" data-spot="${sp.key}" style="left:${sp.x}%;top:${sp.y}%;${tokenSize(p, sp)}"><span class="disc">${esc(sp.label)}</span></div>`).join('');
}
function renderEditPanel() {
  const p = playById(ui.edit.playId); const panel = $('#editPanel'); if (!panel) return;
  const sp = p.spots.find(s => s.key === ui.edit.selSpot);
  const allTags = [...new Set([...S.tags, ...S.plays.flatMap(x => x.tags)])].sort((a, b) => a.localeCompare(b));
  panel.innerHTML = `
    ${sp ? `<section><h4 class="label">Selected spot</h4>
      <div class="row-wrap"><input id="spotLabel" type="text" value="${esc(sp.label)}" maxlength="4" style="width:100px" aria-label="Spot name">
      <button type="button" class="btn danger" data-act="removeSpot">Remove spot</button></div></section>` : ''}
    <section><h4 class="label">Tags</h4>
      <div class="pills" style="gap:8px">${allTags.map(t => `<button type="button" class="tagchip ${p.tags.includes(t) ? 'on' : ''}" data-act="toggleTag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="row-wrap"><input id="newTag" type="text" placeholder="New tag" style="flex:1"><button type="button" class="btn" data-act="addTag">Add</button></div>
    </section>
    ${S.groups.map(g => `<section><h4 class="label"><span class="gdot" style="${gstyle(g)}">${esc(g.name)}</span> default players</h4>
      ${p.spots.map(s => {
        const cur = p.assign?.[g.id]?.[s.key] || '';
        return `<label class="assign-row"><span>${esc(s.label)}</span><select data-assign="${g.id}" data-spot="${s.key}">
          <option value="">Auto (fewest snaps)</option>
          ${S.players.filter(x => x.groupId === g.id).map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>`;
      }).join('')}
    </section>`).join('')}`;
}

/* crop & rotate */
function startCrop(e) {
  e.preventDefault();
  const stage = $('#stage'); const rect = stage.getBoundingClientRect(); const box = $('#cropBox');
  const x0 = clamp((e.clientX - rect.left) / rect.width, 0, 1), y0 = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const move = ev => {
    const x1 = clamp((ev.clientX - rect.left) / rect.width, 0, 1), y1 = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
    const c = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    ui.edit.crop = c; box.hidden = false;
    Object.assign(box.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
  };
  const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
}
async function transformImage(p, fn, mapSpot) {
  const blob = await getBlob(p.imgId); const img = await loadImg(blob);
  const canvas = fn(img); if (!canvas) return; const img0w = img.naturalWidth;
  const nb = await canvasBlob(canvas, 'image/png');
  const oldImg = p.imgId, oldThumb = p.thumbId;
  p.imgId = await putBlob(nb); p.thumbId = await putBlob(await makeThumb(nb));
  const ow = img0w, nw = canvas.width;
  p.spots.forEach(s => { const m = mapSpot(s); s.x = +clamp(m.x, 2, 98).toFixed(2); s.y = +clamp(m.y, 2, 98).toFixed(2); if (s.d) s.d = +(s.d * ow / nw).toFixed(2); });
  const mp = ([x, y]) => { const m = mapSpot({ x, y }); return [+m.x.toFixed(2), +m.y.toFixed(2)]; };
  (p.ink || []).forEach(st => { st.pts = st.pts.map(mp); if (st.head) st.head = st.head.map(mp); });
  await delBlob(oldImg); await delBlob(oldThumb);
  ui.live.delete(p.id); save();
}
async function applyCrop() {
  const p = playById(ui.edit.playId); const c = ui.edit.crop;
  if (!c || c.w < 0.05 || c.h < 0.05) { toast('Drag across the drawing to choose an area first'); return; }
  await transformImage(p, img => {
    const sx = c.x * img.naturalWidth, sy = c.y * img.naturalHeight, sw = c.w * img.naturalWidth, sh = c.h * img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = Math.round(sw); cv.height = Math.round(sh);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }, s => ({ x: (s.x / 100 - c.x) / c.w * 100, y: (s.y / 100 - c.y) / c.h * 100 }));
  ui.edit.crop = null; renderEdit(); toast('Cropped');
}
async function flipImg() {
  const p = playById(ui.edit.playId);
  await transformImage(p, img => {
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const x = cv.getContext('2d'); x.translate(cv.width, 0); x.scale(-1, 1); x.drawImage(img, 0, 0);
    return cv;
  }, s => ({ x: 100 - s.x, y: s.y }));
  renderEdit(); toast('Image flipped');
}
async function rotateImg() {
  const p = playById(ui.edit.playId);
  await transformImage(p, img => {
    const cv = document.createElement('canvas'); cv.width = img.naturalHeight; cv.height = img.naturalWidth;
    const x = cv.getContext('2d'); x.translate(cv.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0);
    return cv;
  }, s => ({ x: 100 - s.y, y: s.x }));
  renderEdit();
}

/* ================= IMPORT ================= */
function openImport() {
  ui.importState = { side: ui.side, trim: true, items: [] };
  renderImportChoice(); $('#sheet').hidden = false;
}
function renderImportChoice() {
  const st = ui.importState;
  $('#sheetCard').innerHTML = `
    <div class="sheet-head"><h3>Import plays</h3></div>
    <div class="row-wrap">
      <span class="label">Import as</span>
      <div class="seg"><button type="button" class="${st.side === 'O' ? 'on' : ''}" data-act="impSide" data-side="O">Offense</button><button type="button" class="${st.side === 'D' ? 'on' : ''}" data-act="impSide" data-side="D">Defense</button></div>
      <label class="row-wrap"><input type="checkbox" id="impTrim" ${st.trim ? 'checked' : ''} style="width:22px;height:22px"> Trim white borders</label>
    </div>
    <div class="opt-grid">
      <button type="button" class="opt" data-act="pickFiles" data-kind="zip"><b>Google Doc</b><span>In Google Docs choose File → Download → Web page (.html, zipped), then pick that .zip. Each drawing becomes a play named after the heading above it.</span></button>
      <button type="button" class="opt" data-act="pickFiles" data-kind="img"><b>Images</b><span>Pick one or more screenshots or photos. Each image becomes one play.</span></button>
      <button type="button" class="opt" data-act="pickFiles" data-kind="pdf"><b>PDF</b><span>Each page becomes a play. Use Crop afterwards if a page holds more than one play.</span></button>
    </div>
    <div class="sheet-foot"><button type="button" class="btn" data-act="closeSheet">Cancel</button></div>`;
}
function pickFiles(kind) {
  const inp = $('#fileInput');
  inp.value = ''; inp.multiple = kind === 'img';
  inp.accept = { zip: '.zip,application/zip,application/x-zip-compressed', img: 'image/*', pdf: 'application/pdf,.pdf' }[kind];
  inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    ui.importState.trim = $('#impTrim')?.checked ?? true;
    $('#sheetCard').innerHTML = `<div class="sheet-head"><h3>Reading…</h3></div><p id="impProgress" class="muted">Starting</p>`;
    try {
      let items = [];
      if (kind === 'zip') items = await readGoogleZip(files[0]);
      else if (kind === 'pdf') items = await readPdf(files[0]);
      else for (const [i, f] of files.entries()) { progress(`Image ${i + 1} of ${files.length}`); items.push({ name: f.name.replace(/\.[^.]+$/, ''), blob: await normalize(f) }); }
      items = items.filter(Boolean);
      if (!items.length) throw new Error('No play drawings were found in that file.');
      for (const [i, it] of items.entries()) { progress(`Checking proportions ${i + 1} of ${items.length}`); const f = await fixAspect(it.blob); if (f) { it.blob = f.blob; it.fixed = true; } }
      ui.importState.items = items.map(it => ({ ...it, side: ui.importState.side, include: true, tags: suggestTags(it.name), url: URL.createObjectURL(it.blob) }));
      await markDuplicates(ui.importState.items);
      renderImportReview();
    } catch (err) {
      $('#sheetCard').innerHTML = `<div class="sheet-head"><h3>Import failed</h3></div><p>${esc(err.message || err)}</p><div class="sheet-foot"><button type="button" class="btn" data-act="closeSheet">Close</button><button type="button" class="btn primary" data-act="openImport">Try again</button></div>`;
    }
  };
  inp.click();
}
const progress = msg => { const el = $('#impProgress'); if (el) el.textContent = msg; };

/* Google Docs stores each drawing at one size and shows it at another (and may crop it).
   Rebuild the picture exactly as the Doc displays it, using the sizes in the exported HTML. */
async function asShownInDoc(blob, imgNode) {
  try {
    const px = (st, k) => { const m = new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*(-?[\\d.]+)px').exec(st || ''); return m ? parseFloat(m[1]) : null; };
    const ist = imgNode.getAttribute('style'); const pst = imgNode.parentElement?.getAttribute('style');
    const iw = px(ist, 'width'), ih = px(ist, 'height'); if (!iw || !ih) return blob;
    const bw = px(pst, 'width') || iw, bh = px(pst, 'height') || ih;
    const ml = px(ist, 'margin-left') || 0, mt = px(ist, 'margin-top') || 0;
    const img = await loadImg(blob);
    const natural = img.naturalWidth / img.naturalHeight, displayed = iw / ih;
    if (Math.abs(natural / displayed - 1) < 0.02 && Math.abs(bw - iw) < 1 && Math.abs(bh - ih) < 1 && !ml && !mt) return blob;
    const k = Math.min(4, img.naturalWidth / iw);
    const cv = document.createElement('canvas'); cv.width = Math.round(bw * k); cv.height = Math.round(bh * k);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(img, ml * k, mt * k, iw * k, ih * k);
    return canvasBlob(cv, 'image/png');
  } catch { return blob; }
}
/* C is always drawn as a square. If it comes out as a rectangle, the whole drawing is stretched:
   resize it until the C box is square again. Returns null when nothing needs fixing. */
async function fixAspect(blob) {
  let marks; try { marks = await detectMarkers(blob); } catch { return null; }
  const c = marks.find(m => m.label === 'C'); if (!c) return null;
  const r = c.w / c.h; if (r > 0.95 && r < 1.05 || r < 0.6 || r > 1.65) return null;
  const img = await loadImg(blob);
  const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth / r); cv.height = img.naturalHeight;
  const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
  return { blob: await canvasBlob(cv, 'image/png'), ratio: r };
}
async function fixPlayAspect(p) {
  const f = await fixAspect(await getBlob(p.imgId)); if (!f) return false;
  await scaleWidth(p, 1 / f.ratio); return true;
}
async function scaleWidth(p, f) {
  await transformImage(p, img => {
    const cv = document.createElement('canvas'); cv.width = Math.max(50, Math.round(img.naturalWidth * f)); cv.height = img.naturalHeight;
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height); return cv;
  }, s => ({ x: s.x, y: s.y }));
}
async function readGoogleZip(file) {
  if (!window.JSZip) throw new Error('The zip reader did not load. Reload the app and try again.');
  const zip = await JSZip.loadAsync(file);
  const htmlName = Object.keys(zip.files).find(n => /\.html?$/i.test(n) && !zip.files[n].dir);
  const byBase = new Map(Object.keys(zip.files).map(n => [n.split('/').pop(), n]));
  const items = [];
  if (htmlName) {
    const doc = new DOMParser().parseFromString(await zip.file(htmlName).async('string'), 'text/html');
    let heading = ''; let count = 0; const nodes = $$('h1,h2,h3,h4,img', doc.body);
    let n = 0; const total = nodes.filter(x => x.tagName === 'IMG').length;
    for (const node of nodes) {
      if (node.tagName !== 'IMG') { const t = node.textContent.replace(/\s+/g, ' ').trim(); if (t) { heading = t; count = 0; } continue; }
      n++; progress(`Drawing ${n} of ${total}`);
      const src = decodeURIComponent(node.getAttribute('src') || '');
      const path = zip.file(src) ? src : byBase.get(src.split('/').pop());
      if (!path || !zip.file(path)) continue;
      const raw = await zip.file(path).async('blob');
      const shown = await asShownInDoc(new Blob([raw], { type: mimeOf(path) }), node);
      const blob = await normalize(shown, true);
      if (!blob) continue;
      count++;
      items.push({ name: (heading || `Play ${items.length + 1}`) + (count > 1 ? ` (${count})` : ''), blob });
    }
  } else {
    const imgs = Object.keys(zip.files).filter(n => /\.(png|jpe?g|gif|webp)$/i.test(n)).sort();
    for (const [i, n] of imgs.entries()) {
      progress(`Image ${i + 1} of ${imgs.length}`);
      const blob = await normalize(new Blob([await zip.file(n).async('blob')], { type: mimeOf(n) }), true);
      if (blob) items.push({ name: n.split('/').pop().replace(/\.[^.]+$/, ''), blob });
    }
  }
  return items;
}
const mimeOf = n => /\.png$/i.test(n) ? 'image/png' : /\.gif$/i.test(n) ? 'image/gif' : /\.webp$/i.test(n) ? 'image/webp' : 'image/jpeg';

async function readPdf(file) {
  if (!window.pdfjsLib) throw new Error('The PDF reader did not load. Reload the app and try again.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const items = []; const base = file.name.replace(/\.pdf$/i, '');
  for (let i = 1; i <= pdf.numPages; i++) {
    progress(`Page ${i} of ${pdf.numPages}`);
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 1600 / vp1.width });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await normalize(await canvasBlob(cv, 'image/png'));
    if (blob) items.push({ name: pdf.numPages > 1 ? `${base} p${i}` : base, blob });
  }
  return items;
}

function loadImg(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(u), 1000); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read an image')); };
    img.src = u;
  });
}
function canvasBlob(cv, type = 'image/png', q = 0.9) {
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Image encode failed')), type, q));
}
// scale down, flatten onto white, optionally trim white borders
async function normalize(blob, skipTiny = false) {
  let img; try { img = await loadImg(blob); } catch { return null; }
  if (skipTiny && (img.naturalWidth < 120 || img.naturalHeight < 80)) return null;
  const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
  if (ui.importState?.trim !== false) {
    const d = x.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let yy = 0; yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) {
      const i = (yy * w + xx) * 4;
      if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    }
    if (x1 > x0 && y1 > y0) {
      const pad = Math.round(Math.max(w, h) * 0.02);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
      if (x1 - x0 < w - 4 || y1 - y0 < h - 4) {
        const c2 = document.createElement('canvas'); c2.width = x1 - x0; c2.height = y1 - y0;
        c2.getContext('2d').drawImage(cv, x0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
        return canvasBlob(c2, 'image/png');
      }
    } else if (skipTiny) return null; // blank image
  }
  return canvasBlob(cv, 'image/png');
}
async function makeThumb(blob) {
  const img = await loadImg(blob);
  const s = Math.min(480 / img.naturalWidth, 360 / img.naturalHeight, 1);
  const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
  const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
  return canvasBlob(cv, 'image/jpeg', 0.85);
}
function formationOf(name) {
  const m = name.split(/\s[-–]\s/);
  if (m.length < 2 || m[0].length > 24) return null;
  const f = m[0].trim().toLowerCase(); return f.charAt(0).toUpperCase() + f.slice(1);
}
function suggestTags(name) {
  const t = new Set(); const n = name.toLowerCase();
  if (/\brpo\b/.test(n)) t.add('RPO');
  if (/flea|throwback|reverse|double pass|trick|hook and lateral/.test(n)) t.add('Trick');
  if (/sweep|option|power|pitch|dive|counter|draw|\brun\b/.test(n)) t.add('Run');
  if (/slant|mesh|flood|sail|vert|wheel|post|corner|screen|\bins\b|slip|curl|out\b|cross|pass/.test(n)) t.add('Pass');
  const f = formationOf(name); if (f) t.add(f);
  return [...t];
}
function labelComps(on, W, H) {
  const N = W * H; const lab = new Int32Array(N).fill(-1); const stack = new Int32Array(N); const comps = [];
  for (let i = 0; i < N; i++) {
    if (!on[i] || lab[i] >= 0) continue;
    const c = { id: comps.length, n: 0, x0: W, y0: H, x1: 0, y1: 0, edge: false }; comps.push(c);
    let sp = 0; stack[sp++] = i; lab[i] = c.id;
    while (sp) {
      const j = stack[--sp]; const px = j % W, py = (j / W) | 0; c.n++;
      if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
      if (px === 0 || py === 0 || px === W - 1 || py === H - 1) c.edge = true;
      if (px > 0 && on[j - 1] && lab[j - 1] < 0) { lab[j - 1] = c.id; stack[sp++] = j - 1; }
      if (px < W - 1 && on[j + 1] && lab[j + 1] < 0) { lab[j + 1] = c.id; stack[sp++] = j + 1; }
      if (py > 0 && on[j - W] && lab[j - W] < 0) { lab[j - W] = c.id; stack[sp++] = j - W; }
      if (py < H - 1 && on[j + W] && lab[j + W] < 0) { lab[j + W] = c.id; stack[sp++] = j + W; }
    }
  }
  return { lab, comps };
}
// erase anything thinner than 2r+1 px (route lines, text) but keep solid shapes
function morphOpen(m, W, H, r) {
  const pass = (src, horiz, needAll) => {
    const out = new Uint8Array(W * H); const len = horiz ? W : H, lines = horiz ? H : W; const pre = new Int32Array(len + 1); const k = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      for (let t = 0; t < len; t++) pre[t + 1] = pre[t] + src[horiz ? l * W + t : t * W + l];
      for (let t = 0; t < len; t++) {
        const a = Math.max(0, t - r), b = Math.min(len, t + r + 1); const sum = pre[b] - pre[a];
        out[horiz ? l * W + t : t * W + l] = needAll ? (sum === k ? 1 : 0) : (sum > 0 ? 1 : 0);
      }
    }
    return out;
  };
  return pass(pass(pass(pass(m, true, true), false, true), true, false), false, false);
}
// fill gaps thinner than 2r+1 px (the strokes of letters printed inside a marker)
function morphClose(m, W, H, r) {
  const pass = (src, horiz, needAll) => {
    const out = new Uint8Array(W * H); const len = horiz ? W : H, lines = horiz ? H : W; const pre = new Int32Array(len + 1);
    for (let l = 0; l < lines; l++) {
      for (let t = 0; t < len; t++) pre[t + 1] = pre[t] + src[horiz ? l * W + t : t * W + l];
      for (let t = 0; t < len; t++) {
        const a = Math.max(0, t - r), b = Math.min(len, t + r + 1); const sum = pre[b] - pre[a];
        out[horiz ? l * W + t : t * W + l] = needAll ? (sum === b - a ? 1 : 0) : (sum > 0 ? 1 : 0);
      }
    }
    return out;
  };
  return pass(pass(pass(pass(m, true, false), false, false), true, true), false, true);
}
/* ---- find the player markers in a drawing ----
   Looks for shapes walled in by a dark outline, and for solid filled shapes (ovals/squares),
   then names them: the square is C, every other shape is named by the letter inside it (any color). */
async function detectMarkers(blob, side) {
  const img = await loadImg(blob);
  const W = Math.min(1400, img.naturalWidth); const H = Math.round(img.naturalHeight * W / img.naturalWidth);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data; const N = W * H;
  const lum = new Uint8Array(N); const open = new Uint8Array(N); const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const sat = Math.max(r, g, b) - Math.min(r, g, b);
    lum[i] = r * 0.299 + g * 0.587 + b * 0.114;
    open[i] = lum[i] < 100 && sat < 60 ? 0 : 1;          // method A: areas walled in by a dark outline
    ink[i] = lum[i] < 228 || sat > 50 ? 1 : 0;            // method B: solid filled shapes (thin lines removed below)
  }
  const out = [];
  const consider = (lab, c, allowEdge, src) => {
    if (c.edge && !allowEdge) return;
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (w < W * 0.03 || h < W * 0.03 || w > W * 0.14 || h > W * 0.14 || w / h < 0.5 || w / h > 2.2) return;
    let spanArea = 0;
    for (let y = c.y0; y <= c.y1; y++) { let a = -1, b = -1; for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) { if (a < 0) a = x; b = x; } if (a >= 0) spanArea += b - a + 1; }
    const fill = spanArea / (w * h);
    if (fill < 0.6 || c.n < spanArea * 0.45) return;
    // fill color of the shape = per-channel median of its own pixels
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * W + x; if (lab[i] === c.id) { hr[d[i * 4]]++; hg[d[i * 4 + 1]]++; hb[d[i * 4 + 2]]++; } }
    const med = h => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= c.n / 2) return v; } return 255; };
    const br = med(hr), bgG = med(hg), bb = med(hb);
    // the letter = anything inside the shape that stands out from that background (light-on-dark or dark-on-light)
    // only look well inside the shape's own outline, row by row, so the border never counts as part of the letter
    const ix0 = c.x0 + Math.round(w * 0.08), ix1 = c.x1 - Math.round(w * 0.08), iy0 = c.y0 + Math.round(h * 0.12), iy1 = c.y1 - Math.round(h * 0.12);
    const mw = ix1 - ix0 + 1, mh = iy1 - iy0 + 1; if (mw < 4 || mh < 4) return;
    const mask = new Uint8Array(mw * mh); let cnt = 0; const pad = Math.max(2, Math.round(w * 0.05));
    for (let y = iy0; y <= iy1; y++) {
      let a = -1, b = -1; for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) { if (a < 0) a = x; b = x; }
      if (a < 0) continue;
      for (let x = Math.max(ix0, a + pad); x <= Math.min(ix1, b - pad); x++) { const i = (y * W + x) * 4; const dr = d[i] - br, dg = d[i + 1] - bgG, db = d[i + 2] - bb; if (dr * dr + dg * dg + db * db > 85 * 85) { mask[(y - iy0) * mw + (x - ix0)] = 1; cnt++; } }
    }
    const m = { x: (c.x0 + c.x1 + 1) / 2 / W * 100, y: (c.y0 + c.y1 + 1) / 2 / H * 100, w, h, fill, label: null, square: fill > 0.87, src, box: [c.x0, c.y0, c.x1, c.y1] };
    // outer size: outlined shapes were measured inside the outline, so add its thickness back
    let t = 0; if (src === 'A') { const my = (c.y0 + c.y1) >> 1; for (let x = c.x0 - 1; x >= 0 && t < 30 && !open[my * W + x]; x--) t++; }
    const ow = w + 2 * t, oh = h + 2 * t;
    m.d = +((m.square ? Math.min(ow, oh) * 0.95 : (ow + oh) / 2 * 1.04) / W * 100).toFixed(2);
    if (cnt > mw * mh * 0.04) { const cm = cleanMask(mask, mw, mh); m.glyph = glyphGrid(cm, mw, mh); m.glyphs = splitGlyphs(cm, mw, mh); } else m.glyph = null;
    out.push(m);
  };
  const A = labelComps(open, W, H); for (const c of A.comps) consider(A.lab, c, false, 'A');
  const r = Math.max(2, Math.round(W * 0.0035));
  // solid shapes, read twice: as drawn, and with letter strokes filled in (letters can split a small marker apart)
  const B = labelComps(morphOpen(ink, W, H, r), W, H); for (const c of B.comps) consider(B.lab, c, true, 'B');
  const B2 = labelComps(morphOpen(morphClose(ink, W, H, Math.max(2, Math.round(W * 0.003))), W, H, r), W, H); for (const c of B2.comps) consider(B2.lab, c, true, 'B');
  // a shape found both ways: keep the outlined version (its inside is cleaner for reading the letter)
  for (let i = out.length - 1; i >= 0; i--) {
    const o = out[i]; if (o.src !== 'B') continue;
    if (out.some(a => a.src === 'A' && a.x * W / 100 >= o.box[0] && a.x * W / 100 <= o.box[2] && a.y * H / 100 >= o.box[1] && a.y * H / 100 <= o.box[3])) out.splice(i, 1);
  }
  // ignore shapes sitting inside another shape (e.g. the hole in a letter)
  for (let i = out.length - 1; i >= 0; i--) if (out.some(o => o !== out[i] && Math.abs(o.x - out[i].x) * W / 100 < o.w / 2 && Math.abs(o.y - out[i].y) * H / 100 < o.h / 2 && o.w * o.h > out[i].w * out[i].h)) out.splice(i, 1);
  // read every shape's letter against the whole alphabet and digits, so route numbers (1, 2, 3),
  // labels and banner text are recognised as "not a position" instead of being forced onto one
  const sides = side ? [side] : ['O', 'D'];
  const posL = [...new Set(sides.flatMap(sd => posList(sd)).filter(l => /^[A-Z0-9]{1,4}$/.test(l)))];
  const wantC = posL.includes('C');
  const ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
  const T = letterTemplates(ALL);
  const pairs = [];
  for (const m of out) {
    if (!m.glyph) continue;
    m.scores = {}; for (const ch of ALL) m.scores[ch] = Math.max(...T[ch].map(t => gridIoU(m.glyph, t)));
    m.best = ALL.reduce((a, b) => (m.scores[b] > m.scores[a] ? b : a));
    // multi-letter labels (OLB, MLB, WR1…): read each character and compare the whole word
    const gl = m.glyphs || [];
    if (gl.length >= 2) {
      const cs = gl.map(g => { const o = {}; for (const ch of ALL) o[ch] = Math.max(...T[ch].map(t => gridIoU(g, t))); return o; });
      m.text = cs.map(o => ALL.reduce((a, b) => (o[b] > o[a] ? b : a))).join('');
      const alt = cs.reduce((a, o) => a + Math.max(...Object.values(o)), 0) / cs.length;
      for (const L of posL) {
        if (L.length !== cs.length) continue;
        const sc = [...L].reduce((a, ch, i) => a + (cs[i][ch] || 0), 0) / L.length;
        if (sc >= 0.6 && sc >= alt - 0.08) pairs.push({ sc, m, L });
      }
      continue;
    }
    for (const L of posL) {
      if (L.length !== 1) continue;
      // letters that a small, blurry Q or C is easily confused with don't count against it
      const look = { Q: 'O0DG', C: 'O0GQ', O: '0Q', Z: '', X: 'K', F: 'PE' }[L] || '';
      const maxOther = Math.max(...ALL.filter(ch => !posL.includes(ch) && !look.includes(ch)).map(ch => m.scores[ch]));
      // shape is a hint, not a rule: C is usually the square, but some playbooks draw everyone as squares
      const sc = m.scores[L] + (L === 'C' ? (m.square ? 0.08 : -0.2) : (m.square ? -0.05 : 0));
      if (m.scores[L] >= 0.65 && m.scores[L] >= maxOther - 0.06) pairs.push({ sc, m, L });
    }
  }
  const room = {}; for (const L of posL) room[L] = Math.max(1, ...sides.map(sd => posList(sd).filter(x => x === L).length));
  pairs.sort((a, b) => b.sc - a.sc);
  for (const p of pairs) if (!p.m.label && room[p.L] > 0) { p.m.label = p.L; p.m.score = p.sc; room[p.L]--; }
  // markers in one drawing are all about the same size
  const ds = out.filter(m => m.label).map(m => m.d).sort((a, b) => a - b);
  const md = ds.length ? ds[Math.floor(ds.length / 2)] : null;
  for (const m of out) m.okSize = !md || (m.d >= md * 0.6 && m.d <= md * 1.7);
  for (const m of out) if (m.label && md && m.d < md * 0.75) m.label = null;           // too small: text or a route number, not a marker
  // the center lines up with the QB
  const qb = out.find(m => m.label === 'Q');
  if (wantC) for (const m of out) if (m.label === 'C' && qb && Math.abs(m.x - qb.x) > 15) m.label = null;
  // C: a square reading "C" (or unreadable), marker-sized, and lined up with the QB when the QB was found
  const q = out.find(m => m.label === 'Q');
  const cCands = !wantC || out.some(m => m.label === 'C') ? [] : out.filter(m => !m.label && m.square && (!m.glyph || m.scores.C >= 0.6)
    && (!md || (m.d >= md * 0.7 && m.d <= md * 1.5)) && (!q || Math.abs(m.x - q.x) < 15));
  if (cCands.length) {
    cCands.sort((a, b) => q ? Math.hypot(a.x - q.x, (a.y - q.y) / 2) - Math.hypot(b.x - q.x, (b.y - q.y) / 2) : (b.scores?.C || 0) - (a.scores?.C || 0));
    cCands[0].label = 'C';
  }
  // keep circle sizes sensible even when a marker's outline ran into a route line
  if (md) for (const m of out) if (m.label) m.d = +Math.min(Math.max(m.d, md * 0.8), md * 1.3).toFixed(2);
  return out;
}
// move a play's spots onto the markers found in its drawing; returns how many spots moved
/* letter matching: shrink a mask to a small grid and compare with letters drawn in a few fonts */
const GW = 12, GH = 14;
// drop specks (edge anti-aliasing, bits of outline) so only the letter's own strokes remain
// split a cleaned letter mask into separate characters, left to right (null if it doesn't look like 1-4 letters)
function splitGlyphs(mask, mw, mh) {
  const lab = new Int32Array(mask.length).fill(-1); const boxes = []; const st = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const b = { x0: mw, y0: mh, x1: -1, y1: -1, n: 0, ids: [boxes.length] }; lab[i] = boxes.length; st.push(i);
    while (st.length) {
      const j = st.pop(); const x = j % mw, y = (j / mw) | 0; b.n++;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
        const k = ny * mw + nx; if (mask[k] && lab[k] < 0) { lab[k] = lab[i]; st.push(k); }
      }
    }
    boxes.push(b);
  }
  // merge pieces that sit in the same column (a broken stroke, the dot of an i)
  boxes.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const b of boxes) {
    const prev = merged[merged.length - 1];
    const ov = prev ? Math.min(prev.x1, b.x1) - Math.max(prev.x0, b.x0) : -1;
    if (prev && ov > 0.5 * Math.min(prev.x1 - prev.x0 + 1, b.x1 - b.x0 + 1)) {
      prev.x0 = Math.min(prev.x0, b.x0); prev.x1 = Math.max(prev.x1, b.x1); prev.y0 = Math.min(prev.y0, b.y0); prev.y1 = Math.max(prev.y1, b.y1); prev.n += b.n; prev.ids.push(...b.ids);
    } else merged.push({ ...b, ids: [...b.ids] });
  }
  const H = Math.max(...merged.map(b => b.y1 - b.y0 + 1));
  let chars = merged.filter(b => b.y1 - b.y0 + 1 >= H * 0.55);
  // bold letters often touch ("LB"): cut a too-wide piece at its thinnest columns
  chars = chars.flatMap(b => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1; const n = Math.round(w / (h * 0.8));
    if (n < 2 || w < h * 1.45) return [b];
    const col = x => { let c = 0; for (let y = b.y0; y <= b.y1; y++) { const k = y * mw + x; if (mask[k] && b.ids.includes(lab[k])) c++; } return c; };
    const cuts = []; for (let i = 1; i < n; i++) {
      const c0 = b.x0 + Math.round(w * i / n), span = Math.round(w / (2.5 * n)); let best = c0, bv = Infinity;
      for (let x = c0 - span; x <= c0 + span; x++) { const v = col(x); if (v < bv) { bv = v; best = x; } }
      cuts.push(best);
    }
    const edges = [b.x0 - 1, ...cuts, b.x1];
    return edges.slice(1).map((x1, i) => ({ ...b, x0: edges[i] + 1, x1 }));
  });
  if (!chars.length || chars.length > 4) return null;
  return chars.map(b => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1; const sub = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (b.y0 + y) * mw + b.x0 + x; if (mask[k] && b.ids.includes(lab[k])) sub[y * w + x] = 1; }
    return glyphGrid(sub, w, h); // glyphGrid trims to the ink, so a cut piece is re-measured on its own
  });
}
function cleanMask(mask, mw, mh) {
  const lab = new Int32Array(mask.length).fill(-1); const sizes = []; const st = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const id = sizes.length; let n = 0; st.push(i); lab[i] = id;
    while (st.length) {
      const j = st.pop(); n++; const x = j % mw, y = (j / mw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
        const k = ny * mw + nx; if (mask[k] && lab[k] < 0) { lab[k] = id; st.push(k); }
      }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes); const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (lab[i] >= 0 && sizes[lab[i]] >= big * 0.2) out[i] = 1;
  return out;
}
function glyphGrid(mask, mw, mh) {
  let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (mask[y * mw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1; const g = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const sx0 = x0 + Math.floor(gx * bw / GW), sx1 = x0 + Math.max(Math.floor((gx + 1) * bw / GW), Math.floor(gx * bw / GW) + 1);
    const sy0 = y0 + Math.floor(gy * bh / GH), sy1 = y0 + Math.max(Math.floor((gy + 1) * bh / GH), Math.floor(gy * bh / GH) + 1);
    let on = 0, all = 0; for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { all++; on += mask[y * mw + x]; }
    g[gy * GW + gx] = on / all >= 0.3 ? 1 : 0;
  }
  return g;
}
function gridIoU(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 0; }
const _tpl = {};
function letterTemplates(letters) {
  const fonts = ['bold 80px Arial, Helvetica, sans-serif', '900 80px "Arial Black", Impact, sans-serif', 'bold 80px Verdana, sans-serif', 'bold 80px Georgia, serif', 'bold 80px "Barlow Condensed", sans-serif', '80px Arial, Helvetica, sans-serif'];
  const out = {};
  for (const l of letters) {
    if (!_tpl[l]) {
      _tpl[l] = [];
      for (const f of fonts) {
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 120; const x = cv.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#000'; x.fillRect(0, 0, 120, 120); x.fillStyle = '#fff'; x.font = f; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(l, 60, 62);
        const d = x.getImageData(0, 0, 120, 120).data; const m = new Uint8Array(120 * 120); for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 128 ? 1 : 0;
        const g = glyphGrid(m, 120, 120); if (!g) continue;
        _tpl[l].push(g);
        const mir = new Uint8Array(g.length); for (let yy = 0; yy < GH; yy++) for (let xx = 0; xx < GW; xx++) mir[yy * GW + xx] = g[yy * GW + (GW - 1 - xx)];
        _tpl[l].push(mir); // flipped drawings
      }
    }
    out[l] = _tpl[l];
  }
  return out;
}
async function autoPlace(play) {
  let marks; try { marks = await detectMarkers(await getBlob(play.imgId), play.side); } catch { return 0; }
  if (!marks.length || (!marks.some(m => m.label) && marks.length > play.spots.length + 3)) return 0;
  const used = new Set(); const done = new Set(); let n = 0;
  for (const sp of play.spots) {
    const i = marks.findIndex((m, j) => !used.has(j) && m.label && m.label === sp.label);
    if (i >= 0) { used.add(i); done.add(sp.key); sp.x = +marks[i].x.toFixed(2); sp.y = +marks[i].y.toFixed(2); sp.d = marks[i].d; n++; }
  }
  // anything left over (unlabeled markers, other playbooks): nearest spot wins
  const rest = marks.map((m, j) => ({ m, j })).filter(o => !used.has(o.j) && !o.m.label && !o.m.glyph && o.m.okSize !== false && !o.m.square);
  for (const sp of play.spots.filter(s => !done.has(s.key))) {
    let bi = -1, bd = Infinity;
    rest.forEach((o, k) => { if (o.taken) return; const dd = Math.hypot(o.m.x - sp.x, o.m.y - sp.y); if (dd < bd) { bd = dd; bi = k; } });
    if (bi >= 0) { rest[bi].taken = true; sp.x = +rest[bi].m.x.toFixed(2); sp.y = +rest[bi].m.y.toFixed(2); sp.d = rest[bi].m.d; n++; }
  }
  if (n) play.spotsSet = true;
  return n;
}
/* spot mirrored / repeated drawings: compare a coarse "ink mask" of each drawing with the one before it */
const SW = 48, SH = 32;
async function inkMask(blob) {
  const img = await loadImg(blob); const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
  const x = cv.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, SW, SH); x.drawImage(img, 0, 0, SW, SH);
  const d = x.getImageData(0, 0, SW, SH).data; const m = new Uint8Array(SW * SH);
  for (let i = 0; i < m.length; i++) m[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < 232 ? 1 : 0;
  return m;
}
function mirrorMask(m) { const o = new Uint8Array(m.length); for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) o[y * SW + x] = m[y * SW + (SW - 1 - x)]; return o; }
function iou(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 0; }
async function markDuplicates(items) {
  progress('Checking for flipped copies');
  const masks = []; for (const it of items) masks.push(await inkMask(it.blob));
  let ref = 0; // last drawing that is being kept
  for (let i = 1; i < items.length; i++) {
    const prev = masks[ref], cur = masks[i];
    const same = iou(prev, cur), mirrored = iou(mirrorMask(prev), cur);
    if (same > 0.9) { items[i].include = false; items[i].note = `Looks like a repeat of "${items[ref].name}"`; }
    else if (mirrored > 0.6 && mirrored > same + 0.1) { items[i].include = false; items[i].note = `Looks like a flipped copy of "${items[ref].name}". Use Flip instead.`; }
    else ref = i;
  }
}
function renderImportReview() {
  const st = ui.importState; const n = st.items.filter(i => i.include).length;
  $('#sheetCard').innerHTML = `
    <div class="sheet-head"><h3>Review ${st.items.length} plays</h3><span class="muted">Uncheck blanks or anything you don't want. Flipped copies are unchecked for you; tap Flip on the play instead.</span></div>
    <div class="imp-list">${st.items.map((it, i) => `
      <div class="imp-row ${it.include ? '' : 'off'}">
        <input type="checkbox" data-imp-inc="${i}" ${it.include ? 'checked' : ''} aria-label="Include">
        <img src="${it.url}" alt="">
        <div style="display:grid;gap:4px;min-width:0"><input class="imp-name" type="text" data-imp-name="${i}" value="${esc(it.name)}">
          <div class="pills">${it.tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>${it.note ? `<div class="imp-note">${esc(it.note)}</div>` : ''}${it.fixed ? '<div class="muted" style="font-size:13px">Proportions fixed (C was not square)</div>' : ''}</div>
        <select data-imp-side="${i}" aria-label="Offense or defense"><option value="O" ${it.side === 'O' ? 'selected' : ''}>Offense</option><option value="D" ${it.side === 'D' ? 'selected' : ''}>Defense</option></select>
      </div>`).join('')}</div>
    <div class="sheet-foot"><button type="button" class="btn" data-act="closeSheet">Cancel</button><button type="button" class="btn primary" data-act="commitImport" id="commitBtn">Import ${n} plays</button></div>`;
}
async function commitImport() {
  const st = ui.importState; const items = st.items.filter(i => i.include);
  $('#commitBtn').disabled = true;
  let n = 0, placed = 0;
  for (const it of items) {
    $('#commitBtn').textContent = `Saving ${++n} of ${items.length}…`;
    const f = formationOf(it.name);
    const mate = f && S.plays.find(p => p.side === it.side && p.tags.includes(f) && p.spotsSet);
    const spots = (mate ? mate.spots : DEFAULT_SPOTS[it.side]).map(s => ({ ...s }));
    S.plays.push({
      id: uid(), name: it.name.trim() || 'Untitled play', side: it.side, tags: it.tags,
      imgId: await putBlob(it.blob), thumbId: await putBlob(await makeThumb(it.blob)),
      spots, spotsSet: !!mate, assign: {}, created: Date.now()
    });
    if (await autoPlace(S.plays[S.plays.length - 1])) placed++;
  }
  st.items.forEach(i => URL.revokeObjectURL(i.url));
  await saveNow(); closeSheet();
  ui.side = items[0]?.side || ui.side; lsSet('side', ui.side);
  go('library'); toast(`Imported ${items.length} plays. Found the players on ${placed}. For the rest, open the play and tap Edit.`);
}

/* ================= ROSTER ================= */
function renderRoster() {
  $('#view-roster').innerHTML = `
  <div class="page">
    <div class="page-head"><h2>Roster</h2></div>
    <div class="panel"><h3>Filling lineups</h3>
      <div class="seg seg-wrap">
        ${[['balanced', 'Spread positions'], ['random', 'Random'], ['preferred', 'Set positions']].map(([k, v]) => `<button type="button" class="${(S.lineupMode || 'balanced') === k ? 'on' : ''}" data-act="lineupMode" data-m="${k}">${v}</button>`).join('')}
      </div>
      <p class="help" style="margin:0">${{
        balanced: 'Kids with the fewest snaps go in, and each kid gets the position they have played least this game. Tap Reset on a play for a new mix.',
        random: 'Kids with the fewest snaps go in, placed at random. Tap Reset on a play to reshuffle.',
        preferred: 'Each kid plays one of the positions you tick below when possible. Kids with no ticks can play anywhere.'
      }[S.lineupMode || 'balanced']} Kids marked QB are your throwers: every lineup gets one QB when one is available (they take turns), at whatever spot, and they wear a yellow ring. A lineup saved on a play with Save lineup always wins.</p>
    </div>
    <p class="help">Tap a circle to add a photo. Initials show until a photo is added. Mark a player "Out" to skip them in lineups for today; everyone comes back automatically at the next game.</p>
    <div class="two">
      ${S.groups.map(g => {
        const ps = S.players.filter(p => p.groupId === g.id); const og = S.groups.find(x => x.id !== g.id);
        return `<div class="panel">
          <div class="group-head"><span class="gdot" style="${gstyle(g)}"></span><input type="text" data-gname="${g.id}" value="${esc(g.name)}" aria-label="Group name">
            <input type="color" class="swatch-input" data-gcolor="${g.id}" value="${esc(g.color)}" aria-label="Group color">
            <span class="muted">${ps.length} players</span></div>
          ${ps.map(p => `<div class="prow ${p.out ? 'is-out' : ''}">
            <span data-act="photo" data-pid="${p.id}" title="Add photo">${disc(p)}</span>
            <input type="text" data-pname="${p.id}" value="${esc(p.name)}" aria-label="Name">
            <input type="text" data-pinit="${p.id}" value="${esc(p.initials)}" placeholder="${esc(initials({ ...p, initials: '' }))}" maxlength="3" aria-label="Initials">
            <div class="prow-actions">
              <button type="button" class="btn small qbtoggle ${p.qb ? 'on' : ''}" data-act="toggleQB" data-pid="${p.id}" aria-pressed="${!!p.qb}">QB</button>
              <button type="button" class="btn small" data-act="toggleOut" data-pid="${p.id}">${p.out ? 'Out' : 'In'}</button>
              <button type="button" class="btn small" data-act="moveGroup" data-pid="${p.id}" title="Move to ${esc(og.name)}">→ ${esc(og.name)}</button>
              <button type="button" class="btn small danger" data-act="delPlayer" data-pid="${p.id}" aria-label="Remove">✕</button>
            </div>
            ${S.lineupMode === 'preferred' ? `<div class="prefs">${['O', 'D'].map(side => `<span class="label">${side === 'O' ? 'Off' : 'Def'}</span>${[...new Set(posList(side))].map(l => `<button type="button" class="posc ${(p.pos?.[side] || []).includes(l) ? 'on' : ''}" data-act="togglePos" data-pid="${p.id}" data-side="${side}" data-l="${esc(l)}">${esc(l)}</button>`).join('')}`).join('<span class="sep"></span>')}</div>` : ''}
            </div>`).join('')}
          <button type="button" class="btn" data-act="addPlayer" data-gid="${g.id}">+ Add player</button>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}
async function setPhoto(pid, file) {
  const img = await loadImg(file); const pl = player(pid); if (!pl) return;
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) * 0.3; // bias up toward faces
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
  const old = pl.photoId; pl.photoId = await putBlob(await canvasBlob(cv, 'image/jpeg', 0.85));
  await delBlob(old); save(); render();
}

/* ================= STATS ================= */
function renderStats() {
  if (!ui.statsGame || !S.games.some(g => g.id === ui.statsGame)) ui.statsGame = S.gameId;
  const logs = ui.statsScope === 'game' ? S.logs.filter(l => l.gameId === ui.statsGame) : S.logs;
  const games = S.games.filter(g => g.id === S.gameId || S.logs.some(l => l.gameId === g.id)).slice().reverse();
  const gcur = currentGame();
  const st = {}; S.players.forEach(p => { st[p.id] = { O: 0, D: 0, a: {}, touch: 0 }; });
  const touchIds = new Set(S.actions.O.filter(a => TOUCH_RX.test(a.label)).map(a => a.id));
  for (const l of logs) {
    for (const pid of Object.values(l.lineup || {})) if (st[pid]) st[pid][l.side]++;
    for (const [aid, pids] of Object.entries(l.marks || {})) for (const pid of pids) if (st[pid]) {
      st[pid].a[aid] = (st[pid].a[aid] || 0) + 1; if (touchIds.has(aid)) st[pid].touch++;
    }
  }
  const cell = v => `<td class="${v ? '' : 'zero'}">${v || '·'}</td>`;
  const plays = {}; for (const l of logs) if (l.playId) { const r = plays[l.playId] ||= { n: 0, res: {} }; r.n++; if (l.result) r.res[l.result] = (r.res[l.result] || 0) + 1; if (l.gain) r.res['g:' + l.gain] = (r.res['g:' + l.gain] || 0) + 1; }
  const resCols = S.results.O; const gainCols = S.gains || DEFAULT_GAINS;
  const recent = logs.slice().sort((a, b) => b.t - a.t).slice(0, 40);
  const order = S.groups.map(g => g.id);
  const roster = S.players.slice().sort((a, b) => order.indexOf(a.groupId) - order.indexOf(b.groupId));
  $('#view-stats').innerHTML = `
  <div class="page">
    <div class="page-head"><h2>Stats</h2><div class="spacer"></div>
      <div class="seg"><button type="button" class="${ui.statsScope === 'game' ? 'on' : ''}" data-act="statsScope" data-s="game">Game</button><button type="button" class="${ui.statsScope === 'season' ? 'on' : ''}" data-act="statsScope" data-s="season">Season</button></div>
      ${ui.statsScope === 'game' ? `<select id="statsGame" aria-label="Game">${games.map(g => `<option value="${g.id}" ${g.id === ui.statsGame ? 'selected' : ''}>${esc(g.date)}${g.opp ? ' vs ' + esc(g.opp) : ''}${g.score ? ` (${g.score.us}–${g.score.them})` : ''}</option>`).join('')}</select>` : ''}
    </div>
    <div class="panel"><div class="row-wrap"><h3 style="flex:1">Today's game <span class="muted">${scoreOf(gcur).us}–${scoreOf(gcur).them}</span></h3>
      <button type="button" class="btn" data-act="score">Score</button>
      <label class="row-wrap"><span class="label">Opponent</span><input type="text" id="oppName" value="${esc(gcur?.opp || '')}" placeholder="e.g. Chargers" style="width:200px"></label>
      <button type="button" class="btn" data-act="newGame">Start new game</button></div>
      <p class="help" style="margin:0">A new game starts automatically each day. Snap counts on the bench and "fewest snaps" lineups use the current game.</p></div>
    <div class="panel"><h3>Players</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>O snaps</th><th>Touches</th>${S.actions.O.map(a => `<th>${esc(a.label)}</th>`).join('')}<th>D snaps</th>${S.actions.D.map(a => `<th>${esc(a.label)}</th>`).join('')}</tr></thead>
        <tbody>${roster.map(p => { const s = st[p.id]; return `<tr><td><span class="who">${disc(p)}${esc(p.name)}</span></td>${cell(s.O)}${s.touch ? `<td class="hi">${s.touch}</td>` : cell(0)}${S.actions.O.map(a => cell(s.a[a.id])).join('')}${cell(s.D)}${S.actions.D.map(a => cell(s.a[a.id])).join('')}</tr>`; }).join('')}</tbody>
      </table></div>
      <p class="help" style="margin:0">Touches = ${S.actions.O.filter(a => TOUCH_RX.test(a.label)).map(a => esc(a.label)).join(' + ') || 'none'}.</p>
    </div>
    <div class="panel"><h3>Plays called</h3>
      ${Object.keys(plays).length ? `<div class="table-wrap"><table><thead><tr><th>Play</th><th>Calls</th>${gainCols.map(r => `<th>${esc(r)}</th>`).join('')}${resCols.map(r => `<th>${esc(r)}</th>`).join('')}</tr></thead>
      <tbody>${Object.entries(plays).sort((a, b) => b[1].n - a[1].n).map(([id, r]) => `<tr><td>${esc(playById(id)?.name || 'Deleted play')}</td><td class="hi">${r.n}</td>${gainCols.map(c => cell(r.res['g:' + c])).join('')}${resCols.map(c => cell(r.res[c])).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">No plays logged yet.</p>'}
    </div>
    <div class="panel"><h3>Log</h3>
      ${recent.length ? `<div class="loglist">${recent.map(l => {
        const acts = S.actions[l.side]; const d = new Date(l.t);
        const parts = acts.filter(a => l.marks?.[a.id]?.length).map(a => `${esc(a.label)}: ${l.marks[a.id].map(pid => esc(firstName(player(pid)))).join(', ')}`);
        return `<div class="logitem"><span class="muted">${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}</span><span class="side-badge">${l.side}</span>
          <div style="min-width:0"><b>${esc(l.playId ? (playById(l.playId)?.name || 'Deleted play') : 'Quick log')}</b>${l.gain ? ` · ${esc(l.gain)}${/^(small|medium|big)$/i.test(l.gain) ? ' gain' : ''}` : ''}${l.result ? ` · ${esc(l.result)}` : ''}<div class="muted">${parts.join(' · ') || 'No marks'}</div></div>
          <button type="button" class="btn small danger" data-act="delLog" data-id="${l.id}">Delete</button></div>`;
      }).join('')}</div>` : '<p class="muted">Nothing logged yet. Tap LOG on a play during the game.</p>'}
    </div>
  </div>`;
}

/* ================= SETUP ================= */
function renderSetup() {
  const list = side => S.actions[side].map(a => a.label).join(', ');
  $('#view-setup').innerHTML = `
  <div class="page">
    <div class="page-head"><h2>Setup</h2></div>
    <div class="panel"><h3>Team</h3>
      <div class="row-wrap">
        <label class="field"><span class="label">Team name</span><input type="text" data-team value="${esc(S.team)}" style="width:220px"></label>
        <label class="field"><span class="label">Primary</span><input type="color" class="swatch-input" data-tcolor="primary" value="${esc(S.colors.primary)}"></label>
        <label class="field"><span class="label">Secondary</span><input type="color" class="swatch-input" data-tcolor="secondary" value="${esc(S.colors.secondary)}"></label>
        <div class="field"><span class="label">Preview</span><div class="row-wrap"><span class="btn primary" aria-hidden="true">Import plays</span><span class="btn log small-log" aria-hidden="true">LOG</span></div></div>
      </div>
      <div class="field"><span class="label">Presets</span>
        <div class="presets">${PRESETS.map(([n, a, b]) => `<button type="button" class="preset" data-act="preset" data-name="${esc(n)}" data-a="${a}" data-b="${b}"><span class="pswatch" style="background:${a}"></span><span class="pswatch" style="background:${b}"></span>${esc(n)}</button>`).join('')}</div>
      </div>
      <p class="help" style="margin:0">A preset sets the team colors and both group colors. Group names and colors can also be changed on the Roster page.</p>
    </div>
    <div class="panel"><h3>Positions</h3>
      <div class="two">
        <label class="field"><span class="label">Offense</span><input type="text" data-poslist="O" value="${esc(posList('O').join(', '))}"></label>
        <label class="field"><span class="label">Defense</span><input type="text" data-poslist="D" value="${esc(posList('D').join(', '))}"></label>
      </div>
      <p class="help" style="margin:0">Comma-separated, in any order. Changing the list updates every play; positions that stay keep their spot. Repeat a name for two of the same (CB, CB).</p>
      <div class="row-wrap"><button type="button" class="btn primary" data-act="autoPlaceAll">Find players on all plays</button>
        <span class="muted">Un-stretches drawings (the C box should be square), then moves each play's circles onto the markers: the square is C, every other shape is matched by the letter inside it. Plays where nothing is found are left alone.</span></div>
    </div>
    <div class="two">
      <div class="panel"><h3>Log buttons</h3>
        <p class="help" style="margin:0">Comma-separated. Renaming keeps past stats for labels that stay the same. Logging a result that scores updates the scoreboard: TD +6, 1-pt +1, 2-pt +2 for us; TD allowed, 1-pt allowed, 2-pt allowed go to the opponent; Safety on defense is +2 for us.</p>
        <label class="field"><span class="label">Offense actions</span><input type="text" data-list="actO" value="${esc(list('O'))}"></label>
        <label class="field"><span class="label">Defense actions</span><input type="text" data-list="actD" value="${esc(list('D'))}"></label>
        <label class="field"><span class="label">Offense results</span><input type="text" data-list="resO" value="${esc(S.results.O.join(', '))}"></label>
        <label class="field"><span class="label">Defense results</span><input type="text" data-list="resD" value="${esc(S.results.D.join(', '))}"></label>
        <label class="field"><span class="label">Yards (both sides)</span><input type="text" data-list="gains" value="${esc((S.gains || DEFAULT_GAINS).join(', '))}"></label>
      </div>
      <div class="panel"><h3>Tags</h3>
        <div class="pills" style="gap:8px">${S.tags.map(t => `<button type="button" class="tagchip" data-act="delTag" data-tag="${esc(t)}" title="Remove tag">${esc(t)} ✕</button>`).join('')}</div>
        <div class="row-wrap"><input type="text" id="setupTag" placeholder="New tag" style="flex:1"><button type="button" class="btn" data-act="addSetupTag">Add</button></div>
        <p class="help" style="margin:0">Removing a tag here only removes it from the quick-pick list. Plays keep their tags.</p>
      </div>
    </div>
    <div class="panel"><h3>Backup</h3>
      <p class="help" style="margin:0">Everything lives on this device only. A backup file holds one team (${esc(S.team)}). Save one after big changes and before updating iPadOS. Restoring adds the backup as its own team, so nothing here is overwritten.</p>
      <div class="row-wrap">
        <button type="button" class="btn primary" data-act="exportBackup">Save ${esc(S.team)} backup</button>
        <button type="button" class="btn" data-act="importBackup">Restore a backup as a team…</button>
        <span class="muted" id="persistNote"></span>
      </div>
    </div>
    <div class="panel"><h3>Offline install</h3>
      <div class="help"><ol>
        <li>Open this app's web address in Safari (iPad) or Chrome (Android) while you have Wi-Fi.</li>
        <li>iPad: Share → Add to Home Screen. Android: menu → Install app.</li>
        <li>Open it once from the home-screen icon. After that it runs with no signal.</li>
        <li>Deleting the home-screen icon deletes its data, so keep a backup.</li>
      </ol></div>
      <p class="muted" id="offlineNote">Version ${APP_VERSION}</p>
    </div>
    <div class="panel"><h3>Remove ${esc(S.team)}</h3>
      <div class="row-wrap">
        <button type="button" class="btn danger" data-act="resetAll">Clear this team</button><span class="muted">Deletes this team's plays, roster, photos and stats. Keeps its name and colors.</span>
      </div>
      ${TEAMS.list.length > 1 ? `<div class="row-wrap"><button type="button" class="btn danger" data-act="deleteTeam">Delete this team</button><span class="muted">Removes the team completely and switches to another team.</span></div>` : ''}
    </div>
  </div>`;
  (async () => {
    try {
      const p = await navigator.storage?.persisted?.();
      const el = $('#persistNote'); if (el) el.textContent = p ? 'Storage is marked persistent.' : '';
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const on = $('#offlineNote'); if (on) on.textContent = `Version ${APP_VERSION} · ${reg?.active ? 'Ready for offline use' : 'Offline mode not active yet (install from a web address)'}${DB.isMemory() ? ' · WARNING: storage unavailable, changes will not be kept' : ''}`;
    } catch { /* ignore */ }
  })();
}
function parseList(str, existing) {
  const labels = str.split(',').map(s => s.trim()).filter(Boolean);
  if (!existing) return labels;
  return labels.map(l => existing.find(a => a.label.toLowerCase() === l.toLowerCase()) || { id: uid(), label: l, multi: false });
}

/* ---- teams ---- */
async function deleteTeamBlobs(st) {
  const ids = [...st.plays.flatMap(p => [p.imgId, p.thumbId]), ...st.players.map(p => p.photoId)].filter(Boolean);
  for (const id of ids) await delBlob(id);
}
async function loadTeam(id) {
  flushSave();
  let st = null; try { st = await DB.get('kv', 'team:' + id); } catch { st = null; }
  TEAMS.current = id; await DB.put('kv', 'teams', TEAMS).catch(() => { });
  S = migrate(st || defaultState());
  ensureGame();
  ui.live.clear(); ui.flips.clear(); ui.tags.clear(); ui.q = ''; ui.lastLineup = {}; ui.statsGame = null; ui.draw.on = false;
  await preload(); await saveNow().catch(() => { });
  applyTheme(); showBanner();
}
async function switchTeam(id, quiet) {
  if (id === TEAMS.current && !quiet) return;
  await loadTeam(id); go('library');
  if (!quiet) toast(`Switched to ${S.team}`);
}
async function createTeam(st, samples) {
  flushSave();
  const id = uid(); if (samples) { const keep = S; S = st; await addSamples(); S = keep; }
  TEAMS.list.push({ id, name: st.team, primary: st.colors?.primary, secondary: st.colors?.secondary });
  await DB.put('kv', 'team:' + id, st);
  await switchTeam(id, true);
}
function openTeams() {
  $('#sheetCard').innerHTML = `
    <div class="sheet-head"><h3>Teams</h3><span class="muted">Each team has its own playbook, roster, photos and stats.</span></div>
    <div class="log-rows">${TEAMS.list.map(t => `<div class="team-row ${t.id === TEAMS.current ? 'cur' : ''}">
      <span class="row-wrap" style="gap:4px"><span class="pswatch" style="background:${esc(t.primary)};width:22px;height:22px"></span><span class="pswatch" style="background:${esc(t.secondary)};width:22px;height:22px"></span></span>
      <b>${esc(t.name)}</b>
      ${t.id === TEAMS.current ? '<span class="muted">Current</span>' : `<button type="button" class="btn primary" data-act="switchTeam" data-id="${t.id}">Switch</button>`}
    </div>`).join('')}</div>
    <div class="panel"><h3>New team</h3>
      <div class="row-wrap"><input type="text" id="newTeamName" placeholder="Team name" style="flex:1;min-width:180px">
        <label class="row-wrap"><input type="checkbox" id="copyPlays" style="width:22px;height:22px"> Copy ${esc(S.team)}'s plays</label>
        <button type="button" class="btn primary" data-act="newTeam">Create team</button></div>
      <p class="help" style="margin:0">Starts with 12 placeholder players, two groups, and ${esc(S.team)}'s colors and positions. Change colors in Setup.</p>
    </div>
    <div class="sheet-foot"><button type="button" class="btn" data-act="closeSheet">Close</button></div>`;
  $('#sheet').hidden = false;
}
function showBanner() {
  const b = $('#banner');
  if (DB.isMemory()) { b.hidden = false; b.textContent = 'This browser is blocking storage, so nothing you add will be kept. Open the app from its home-screen icon or a normal browser window.'; return; }
  if (S.needsAutoPlace && S.plays.some(p => p.side === 'O')) {
    b.hidden = false;
    b.innerHTML = `<span>Match each play's player circles to the markers in your drawings (spot and size)?</span>
      <button type="button" class="btn small" data-act="autoPlaceAll">Find players on all plays</button><button type="button" class="btn small ghost" data-act="dismissBanner">Not now</button>`;
    return;
  }
  b.hidden = true;
}

/* backup */
function toB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function exportBackup(btn) {
  btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const ids = new Set([...S.plays.flatMap(p => [p.imgId, p.thumbId]), ...S.players.map(p => p.photoId)].filter(Boolean));
    const blobs = {};
    for (const id of ids) { const b = await getBlob(id); if (b) blobs[id] = { t: b.type, d: await toB64(b) }; }
    const data = JSON.stringify({ app: 'huddle', v: 1, exported: new Date().toISOString(), state: S, blobs });
    const name = `huddle-${(S.team || 'team').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${todayStr()}.json`;
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Huddle backup' }); toast('Backup ready'); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Backup saved');
  } catch (e) { toast('Backup failed: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = `Save ${S.team} backup`; }
}
function importBackup() {
  const inp = $('#fileInput'); inp.value = ''; inp.multiple = false; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'huddle' || !data.state) throw new Error('That is not a Huddle backup file.');
      const map = {};
      for (const [id, b] of Object.entries(data.blobs || {})) {
        const bin = Uint8Array.from(atob(b.d), c => c.charCodeAt(0)); const nid = uid();
        await DB.put('blobs', nid, { t: b.t, b: bin.buffer }); map[id] = nid;
      }
      const st = data.state;
      st.plays.forEach(p => { p.imgId = map[p.imgId] || null; p.thumbId = map[p.thumbId] || null; });
      st.players.forEach(p => { p.photoId = map[p.photoId] || null; });
      await createTeam(st);
      toast(`Restored ${S.team}: ${S.plays.length} plays, ${S.players.length} players`);
    } catch (e) { toast('Restore failed: ' + e.message); }
  };
  inp.click();
}
function migrate(s) {
  const d = defaultState();
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.groups.forEach(g => { if (LEGACY_COLORS[g.color]) g.color = LEGACY_COLORS[g.color]; });
  s.plays.forEach(p => { p.tags ||= []; p.assign ||= {}; p.ink ||= []; p.spots ||= spotsFor(s.positions?.[p.side] || DEFAULT_POSITIONS[p.side]); });
  // v1.1 -> v1.2: offense positions C/QB/RB/WR1/WR2 become C/Q/F/X/Z
  const OLD = { QB: 'Q', RB: 'F', WR1: 'X', WR2: 'Z' };
  let renamed = false;
  s.plays.filter(p => p.side === 'O').forEach(p => {
    const keys = p.spots.map(x => x.key).sort().join();
    if (keys !== 'C,QB,RB,WR1,WR2') return;
    renamed = true;
    p.spots.forEach(x => { if (OLD[x.key]) { x.label = OLD[x.key]; x.key = OLD[x.key]; } });
    for (const a of Object.values(p.assign)) for (const [k, v] of Object.entries(OLD)) if (a[k]) { a[v] = a[k]; delete a[k]; }
  });
  if (renamed) s.needsAutoPlace = true;
  if (s.v < 3) {
    const ins = (arr, after, items) => { const miss = items.filter(x => !arr.some(a => a.toLowerCase() === x.toLowerCase())); if (!miss.length) return; const i = arr.findIndex(a => a.toLowerCase() === after.toLowerCase()); arr.splice(i >= 0 ? i + 1 : arr.length, 0, ...miss); };
    ins(s.results.O, 'TD', ['1-pt conv', '2-pt conv']); ins(s.results.D, 'TD allowed', ['1-pt allowed', '2-pt allowed']);
  }
  if (s.v < 2) { if (s.plays.some(p => p.side === 'O' && !p.tags.includes('Sample'))) s.needsAutoPlace = true; }
  if (s.v < 4) {
    // conversions shortened; yardage moved to its own row
    const ren = { '1-pt conv': '1-pt', '2-pt conv': '2-pt' };
    s.results.O = s.results.O.map(r => ren[r] || r).filter(r => !/^(gain|no gain|loss)$/i.test(r));
    s.gains ||= [...DEFAULT_GAINS];
    for (const l of s.logs) {
      if (ren[l.result]) l.result = ren[l.result];
      if (/^(no gain|loss)$/i.test(l.result || '')) { l.gain = /loss/i.test(l.result) ? 'Loss' : 'No gain'; l.result = null; }
      else if (/^gain$/i.test(l.result || '')) { l.gain = 'Small'; l.result = null; }
    }
    s.v = 4;
  }
  return s;
}
async function preload() {
  const ids = [...S.plays.map(p => p.thumbId), ...S.players.map(p => p.photoId)].filter(Boolean);
  await Promise.all(ids.map(blobUrl));
}

/* ================= SAMPLE PLAYS ================= */
function arrow(x, pts, color = '#111') {
  x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 6; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) x.lineTo(p[0], p[1]); x.stroke();
  const [a, b] = pts.slice(-2); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  x.beginPath(); x.moveTo(b[0] + Math.cos(ang) * 10, b[1] + Math.sin(ang) * 10);
  x.lineTo(b[0] + Math.cos(ang + 2.5) * 26, b[1] + Math.sin(ang + 2.5) * 26); x.lineTo(b[0] + Math.cos(ang - 2.5) * 26, b[1] + Math.sin(ang - 2.5) * 26); x.fill();
}
function drawSample(side) {
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800; const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 800);
  x.fillStyle = '#6b7672'; x.font = '600 34px sans-serif'; x.fillText(side === 'O' ? 'SAMPLE · Quick slants' : 'SAMPLE · 3-2 zone', 36, 56);
  const los = side === 'O' ? 395 : 585;
  x.strokeStyle = '#9aa5a1'; x.lineWidth = 4; x.setLineDash([18, 12]); x.beginPath(); x.moveTo(30, los); x.lineTo(1170, los); x.stroke(); x.setLineDash([]);
  const circle = (cx, cy, c = '#111') => { x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, 30, 0, Math.PI * 2); x.stroke(); };
  if (side === 'O') {
    arrow(x, [[180, 390], [180, 320], [430, 170]]); arrow(x, [[1020, 390], [1020, 320], [770, 170]]);
    arrow(x, [[600, 390], [600, 240], [565, 275]]); arrow(x, [[500, 610], [330, 590], [160, 500]], '#1d4f91');
    [[600, 420], [600, 520], [470, 600], [180, 420], [1020, 420]].forEach(([a, b]) => circle(a, b));
  } else {
    x.fillStyle = 'rgba(31,111,224,.10)'; [[60, 300, 330, 200], [870, 300, 330, 200], [180, 70, 400, 210], [620, 70, 400, 210]].forEach(r => x.fillRect(...r));
    [[600, 640], [240, 640], [960, 640], [470, 700], [730, 700]].forEach(([a, b]) => circle(a, b, '#b7bfbc'));
    arrow(x, [[600, 460], [600, 560]], '#a3142b');
    [[600, 440], [220, 420], [980, 420], [420, 220], [780, 220]].forEach(([a, b]) => { x.strokeStyle = '#111'; x.lineWidth = 7; x.beginPath(); x.moveTo(a - 24, b - 24); x.lineTo(a + 24, b + 24); x.moveTo(a + 24, b - 24); x.lineTo(a - 24, b + 24); x.stroke(); });
  }
  return canvasBlob(cv, 'image/png');
}
async function addSamples() {
  const specs = [
    { name: 'Quick slants (sample)', side: 'O', tags: ['Pass', 'Sample'], spots: [
      { key: 'C', label: 'C', x: 50, y: 52.5 }, { key: 'Q', label: 'Q', x: 50, y: 65 }, { key: 'F', label: 'F', x: 39.17, y: 75 },
      { key: 'X', label: 'X', x: 15, y: 52.5 }, { key: 'Z', label: 'Z', x: 85, y: 52.5 }] },
    { name: '3-2 zone (sample)', side: 'D', tags: ['Zone', 'Sample'], spots: [
      { key: 'R', label: 'R', x: 50, y: 55 }, { key: 'CB1', label: 'CB', x: 18.33, y: 52.5 }, { key: 'CB2', label: 'CB', x: 81.67, y: 52.5 },
      { key: 'S1', label: 'S', x: 35, y: 27.5 }, { key: 'S2', label: 'S', x: 65, y: 27.5 }] }
  ];
  for (const s of specs) {
    const blob = await drawSample(s.side);
    S.plays.push({ id: uid(), name: s.name, side: s.side, tags: s.tags, imgId: await putBlob(blob), thumbId: await putBlob(await makeThumb(blob)), spots: s.spots, spotsSet: true, assign: {}, created: Date.now() });
  }
}

/* ================= EVENTS ================= */
const ACT = {
  nav: b => { ui.editing = false; ui.sel = null; ui.benchSel = null; ui.draw.on = false; go(b.dataset.view); },
  book: b => { ui.book = b.dataset.b; ui.editing = false; ui.selected = new Set(); lsSet('book', ui.book); renderLibrary(); },
  editLib: () => { ui.editing = true; ui.selected = new Set(); renderLibrary(); },
  startPicking: () => { ui.book = 'all'; lsSet('book', 'all'); ui.editing = true; ui.selected = new Set(); renderLibrary(); },
  cancelEdit: () => { ui.editing = false; ui.selected = new Set(); renderLibrary(); },
  toggleSel: b => { const id = b.dataset.id; ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id); renderGrid(); },
  selectAll: () => { const all = (ui.shownIds || []).every(id => ui.selected.has(id)); ui.selected = all ? new Set() : new Set(ui.shownIds); renderGrid(); },
  planAdd: () => { let n = 0; S.planOrder ||= []; ui.selected.forEach(id => { const p = playById(id); if (p && !p.inPlan) { p.inPlan = true; S.planOrder.push(id); n++; } }); save(); ui.editing = false; ui.selected = new Set(); renderLibrary(); toast(`Added ${n} to the game plan (${S.plays.filter(p => p.inPlan).length} total)`); },
  planRemove: () => { let n = 0; ui.selected.forEach(id => { const p = playById(id); if (p?.inPlan) { p.inPlan = false; n++; } }); save(); ui.editing = false; ui.selected = new Set(); renderLibrary(); toast(`Removed ${n} from the game plan`); },
  deleteSel: async b => {
    const n = ui.selected.size; if (!n || !armed(b, `Delete ${n} play${n > 1 ? 's' : ''}? Tap again`)) return;
    for (const id of ui.selected) { const p = playById(id); if (!p) continue; await delBlob(p.imgId); await delBlob(p.thumbId); ui.live.delete(id); }
    S.plays = S.plays.filter(p => !ui.selected.has(p.id)); save(); ui.editing = false; ui.selected = new Set(); renderLibrary(); toast(`Deleted ${n} play${n > 1 ? 's' : ''}`);
  },
  side: b => { ui.side = b.dataset.side; lsSet('side', ui.side); renderLibrary(); },
  swapGroups: () => { S.offense = otherGroup().id; ui.live.clear(); save(); renderLibrary(); toast(`${group(S.offense).name} on offense, ${otherGroup().name} on defense`); },
  tag: b => { const t = b.dataset.tag; ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t); renderGrid(); },
  clearTags: () => { ui.tags.clear(); ui.q = ''; const q = $('#q'); if (q) q.value = ''; renderGrid(); },
  openPlay: b => openPlay(b.dataset.id),
  back: () => { ui.sel = null; ui.benchSel = null; ui.draw.on = false; go('library'); },
  rotate: rotateLive,
  prevPlay: () => stepPlay(-1),
  nextPlay: () => stepPlay(1),
  flip: () => { const id = ui.playId; ui.flips.has(id) ? ui.flips.delete(id) : ui.flips.add(id); renderPlay(); },
  drawMode: () => { ui.draw.on = !ui.draw.on; ui.draw.erase = false; ui.sel = null; ui.benchSel = null; renderPlay(); },
  inkColor: b => { ui.draw.color = b.dataset.c; ui.draw.erase = false; $('#stage')?.classList.remove('erasing'); renderHint(); },
  inkArrow: () => { ui.draw.arrow = !ui.draw.arrow; renderHint(); },
  inkErase: () => { ui.draw.erase = !ui.draw.erase; $('#stage')?.classList.toggle('erasing', ui.draw.erase); renderHint(); },
  inkUndo: () => { const p = playById(ui.playId); p.ink?.pop(); save(); renderInk(); renderHint(); },
  inkClear: b => { if (!armed(b, 'Tap again to clear')) return; const p = playById(ui.playId); p.ink = []; save(); renderInk(); renderHint(); },
  resetLive: () => { ui.live.delete(ui.playId); ui.flips.delete(ui.playId); ui.sel = null; ui.benchSel = null; renderPlay(); },
  saveDefault: () => {
    const p = playById(ui.playId); const L = liveFor(p);
    p.assign ||= {}; p.assign[L.groupId] = { ...L.lineup }; save();
    toast(`Saved as ${group(L.groupId).name}'s lineup for this play`);
  },
  editPlay: () => { ui.draw.on = false; editPlay(ui.playId); },
  openLog: () => { const p = playById(ui.playId); const L = liveFor(p); openLog(p, L.lineup, L.groupId); },
  toggleOther: () => { ui.showOther = !ui.showOther; renderBench(); },
  clearSel: () => { ui.sel = null; ui.benchSel = null; refreshLive(); },
  benchIt: () => { const L = liveFor(playById(ui.playId)); delete L.lineup[ui.sel]; ui.sel = null; refreshLive(); },
  sitOut: () => {
    const p = playById(ui.playId); const L = liveFor(p); const pid = L.lineup[ui.sel]; const pl = player(pid); if (!pl) return;
    pl.out = true; save(); delete L.lineup[ui.sel];
    const snaps = snapCounts(p.side); const onField = new Set(Object.values(L.lineup));
    const next = S.players.filter(x => x.groupId === L.groupId && !x.out && !onField.has(x.id)).sort((a, b) => (snaps[a.id] || 0) - (snaps[b.id] || 0))[0];
    if (next) L.lineup[ui.sel] = next.id;
    ui.sel = null; refreshLive(); toast(`${pl.name} is out for today`);
  },
  mark: b => {
    const d = ui.logDraft; const a = S.actions[d.side].find(x => x.id === b.dataset.a); const pid = b.dataset.p;
    const cur = d.marks[a.id] || [];
    d.marks[a.id] = cur.includes(pid) ? cur.filter(x => x !== pid) : (a.multi ? [...cur, pid] : [pid]);
    if (!d.marks[a.id].length) delete d.marks[a.id];
    renderLog();
  },
  gain: b => { const d = ui.logDraft; d.gain = d.gain === b.dataset.g ? null : b.dataset.g; renderLog(); },
  result: b => { const d = ui.logDraft; d.result = d.result === b.dataset.r ? null : b.dataset.r; renderLog(); },
  saveLog, closeSheet: () => { closeSheet(); ui.logDraft = null; },
  quickLog,
  openImport, impSide: b => { ui.importState.side = b.dataset.side; ui.importState.trim = $('#impTrim')?.checked ?? true; renderImportChoice(); },
  pickFiles: b => pickFiles(b.dataset.kind), commitImport,
  doneEdit: () => { ui.live.delete(ui.edit.playId); const id = ui.edit.playId; ui.edit = null; openPlay(id, true); },
  setSide: b => { const p = playById(ui.edit.playId); if (p.side === b.dataset.side) return; p.side = b.dataset.side; p.assign = {}; save(); renderEdit(); },
  deletePlay: async b => {
    if (!armed(b, 'Tap again to delete')) return;
    const p = playById(ui.edit.playId); S.plays = S.plays.filter(x => x.id !== p.id); await delBlob(p.imgId); await delBlob(p.thumbId);
    ui.edit = null; save(); go('library'); toast('Play deleted');
  },
  addSpot: () => {
    const p = playById(ui.edit.playId); let n = p.spots.length + 1; while (p.spots.some(s => s.key === 'P' + n)) n++;
    p.spots.push({ key: 'P' + n, label: 'P' + n, x: 50, y: 50 }); ui.edit.selSpot = 'P' + n; p.spotsSet = true; save(); renderSpotTokens(); renderEditPanel();
  },
  removeSpot: () => {
    const p = playById(ui.edit.playId); const k = ui.edit.selSpot; p.spots = p.spots.filter(s => s.key !== k);
    Object.values(p.assign || {}).forEach(a => delete a[k]); ui.edit.selSpot = null; save(); renderSpotTokens(); renderEditPanel();
  },
  startCrop: () => { ui.edit.crop = {}; ui.edit.selSpot = null; renderEdit(); },
  cancelCrop: () => { ui.edit.crop = null; renderEdit(); },
  applyCrop, rotateImg, flipImg,
  replaceImg: () => {
    const inp = $('#fileInput'); inp.value = ''; inp.multiple = false; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; const p = playById(ui.edit.playId);
      const nb = await normalize(f); if (!nb) return toast('Could not read that image');
      const oi = p.imgId, ot = p.thumbId; p.imgId = await putBlob(nb); p.thumbId = await putBlob(await makeThumb(nb));
      await delBlob(oi); await delBlob(ot); save(); renderEdit();
    };
    inp.click();
  },
  toggleTag: b => { const p = playById(ui.edit.playId); const t = b.dataset.tag; p.tags = p.tags.includes(t) ? p.tags.filter(x => x !== t) : [...p.tags, t]; save(); renderEditPanel(); },
  addTag: () => {
    const v = $('#newTag').value.trim(); if (!v) return; const p = playById(ui.edit.playId);
    if (!S.tags.some(t => t.toLowerCase() === v.toLowerCase())) S.tags.push(v);
    if (!p.tags.includes(v)) p.tags.push(v); save(); renderEditPanel();
  },
  photo: b => {
    const inp = $('#fileInput'); inp.value = ''; inp.multiple = false; inp.accept = 'image/*';
    const pid = b.dataset.pid; inp.onchange = () => { if (inp.files[0]) setPhoto(pid, inp.files[0]).catch(e => toast(e.message)); };
    inp.click();
  },
  toggleOut: b => { const p = player(b.dataset.pid); p.out = !p.out; ui.live.clear(); save(); renderRoster(); },
  moveGroup: b => { const p = player(b.dataset.pid); p.groupId = S.groups.find(g => g.id !== p.groupId).id; ui.live.clear(); save(); renderRoster(); },
  delPlayer: async b => {
    if (!armed(b, 'Remove?')) return;
    const p = player(b.dataset.pid); S.players = S.players.filter(x => x.id !== p.id); await delBlob(p.photoId); ui.live.clear(); save(); renderRoster();
  },
  addPlayer: b => { S.players.push({ id: uid(), name: 'New player', initials: '', number: '', photoId: null, groupId: b.dataset.gid, out: false }); save(); renderRoster(); const ins = $$(`[data-pname]`); ins[ins.length - 1]?.focus(); },
  preset: b => {
    S.colors = { primary: b.dataset.a, secondary: b.dataset.b };
    if (S.groups[0]) S.groups[0].color = b.dataset.a; if (S.groups[1]) S.groups[1].color = b.dataset.b;
    if (!S.team || S.team === 'Team') S.team = b.dataset.name;
    save(); render(); toast(`${b.dataset.name} colors applied`);
  },
  lineupMode: b => { S.lineupMode = b.dataset.m; ui.live.clear(); save(); renderRoster(); },
  score: () => openScore(),
  addScore: b => {
    const g = ensureGame(); g.score ||= { us: 0, them: 0, ev: [] }; const n = +b.dataset.n; const side = b.dataset.side;
    if (g.score[side] + n < 0) return;
    addPoints(g, side, n); save(); renderScore(); openScore();
  },
  undoScore: () => { const g = currentGame(); const e = g?.score?.ev.pop(); if (e) { g.score[e[0]] -= e[1]; if (e[2]) { const l = S.logs.find(x => x.id === e[2]); if (l) delete l.pts; } save(); renderScore(); openScore(); } },
  toggleQB: b => { const p = player(b.dataset.pid); p.qb = !p.qb; ui.live.clear(); save(); renderRoster(); },
  togglePos: b => {
    const p = player(b.dataset.pid); const side = b.dataset.side; const l = b.dataset.l;
    p.pos ||= { O: [], D: [] }; p.pos[side] ||= [];
    p.pos[side] = p.pos[side].includes(l) ? p.pos[side].filter(x => x !== l) : [...p.pos[side], l];
    ui.live.clear(); save(); renderRoster();
  },
  findPlayers: async () => {
    const p = playById(ui.edit.playId); const n = await autoPlace(p);
    save(); renderEdit(); toast(n ? `Placed ${n} of ${p.spots.length} positions` : 'No player markers found in this drawing');
  },
  autoPlaceAll: async b => {
    b.disabled = true; let plays = 0, spots = 0, fixed = 0;
    for (const [i, p] of S.plays.entries()) {
      b.textContent = `Working ${i + 1} of ${S.plays.length}…`;
      if (await fixPlayAspect(p)) fixed++;
      const n = await autoPlace(p); if (n) { plays++; spots += n; }
    }
    S.needsAutoPlace = false; ui.live.clear(); save(); renderSetup(); $('#banner').hidden = true;
    toast(`Placed players on ${plays} of ${S.plays.length} plays${fixed ? `, fixed proportions on ${fixed}` : ''}`);
  },
  fixProportions: async () => {
    const p = playById(ui.edit.playId); const r = await fixPlayAspect(p);
    if (r) { await autoPlace(p); save(); renderEdit(); toast('Fixed: the C box is square again'); }
    else toast('No change needed, or no C square found. Use Narrower / Wider to adjust by eye.');
  },
  narrower: async () => { await scaleWidth(playById(ui.edit.playId), 0.95); renderEdit(); },
  wider: async () => { await scaleWidth(playById(ui.edit.playId), 1.05); renderEdit(); },
  dismissBanner: () => { S.needsAutoPlace = false; save(); $('#banner').hidden = true; },
  statsScope: b => { ui.statsScope = b.dataset.s; renderStats(); },
  newGame: b => {
    if (!armed(b, 'Start a new game?')) return;
    const g = { id: uid(), date: todayStr(), opp: '' }; S.games.push(g); S.gameId = g.id; ui.statsGame = g.id;
    S.players.forEach(p => { p.out = false; }); ui.live.clear(); save(); renderStats(); renderScore(); toast('New game started');
  },
  delLog: b => { if (!armed(b, 'Delete?')) return; const e = S.logs.find(l => l.id === b.dataset.id); if (e) removeLogPoints(e); S.logs = S.logs.filter(l => l.id !== b.dataset.id); save(); renderStats(); renderScore(); },
  delTag: b => { S.tags = S.tags.filter(t => t !== b.dataset.tag); save(); renderSetup(); },
  addSetupTag: () => { const v = $('#setupTag').value.trim(); if (v && !S.tags.includes(v)) { S.tags.push(v); save(); } renderSetup(); },
  exportBackup: b => exportBackup(b), importBackup,
  resetAll: async b => {
    if (!armed(b, 'Tap again to clear this team')) return;
    await deleteTeamBlobs(S);
    const keep = { team: S.team, colors: S.colors, positions: S.positions };
    S = Object.assign(defaultState(), keep); ensureGame(); await addSamples(); await saveNow(); ui.live.clear(); go('library'); toast(`${S.team} cleared`);
  },
  deleteTeam: async b => {
    if (!armed(b, 'Tap again to delete this team')) return;
    clearTimeout(saveTimer); saveTimer = null;
    const gone = S.team; await deleteTeamBlobs(S); await DB.del('kv', teamKey());
    TEAMS.list = TEAMS.list.filter(t => t.id !== TEAMS.current);
    await switchTeam(TEAMS.list[0].id, true); toast(`${gone} deleted`);
  },
  teams: () => openTeams(),
  switchTeam: b => { closeSheet(); switchTeam(b.dataset.id); },
  newTeam: async () => {
    const name = $('#newTeamName').value.trim() || 'New team'; const copy = $('#copyPlays')?.checked;
    const st = defaultState(); st.team = name;
    st.colors = { ...S.colors }; st.positions = JSON.parse(JSON.stringify(S.positions || DEFAULT_POSITIONS));
    st.groups[0].name = 'Group A'; st.groups[1].name = 'Group B';
    st.groups[0].color = st.colors.primary; st.groups[1].color = st.colors.secondary;
    if (copy) {
      for (const p of S.plays) {
        const img = await getBlob(p.imgId), th = await getBlob(p.thumbId);
        st.plays.push({ ...JSON.parse(JSON.stringify(p)), id: uid(), assign: {}, imgId: img ? await putBlob(img) : null, thumbId: th ? await putBlob(th) : null });
      }
    }
    closeSheet(); await createTeam(st, !copy); toast(`${name} created`);
  }
};

document.addEventListener('click', e => {
  if (ui.suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const fn = ACT[b.dataset.act]; if (fn) { e.preventDefault(); Promise.resolve(fn(b, e)).catch(err => toast(err.message || String(err))); }
  persistOnce();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { ui.q = t.value; renderGrid(); }
});
document.addEventListener('change', e => {
  const t = e.target; const d = t.dataset;
  if (t.id === 'ename') { const p = playById(ui.edit.playId); p.name = t.value.trim() || 'Untitled play'; save(); }
  else if (t.id === 'spotLabel') { const sp = playById(ui.edit.playId).spots.find(s => s.key === ui.edit.selSpot); if (sp) { sp.label = t.value.trim().slice(0, 4) || sp.key; save(); renderSpotTokens(); renderEditPanel(); } }
  else if (t.id === 'copySpots' && t.value) {
    const src = playById(t.value); const p = playById(ui.edit.playId);
    p.spots = src.spots.map(s => ({ ...s })); p.spotsSet = true; ui.edit.selSpot = null; save(); renderEdit(); toast(`Copied spots from ${src.name}`);
  }
  else if (d.assign) { const p = playById(ui.edit.playId); p.assign ||= {}; p.assign[d.assign] ||= {}; if (t.value) p.assign[d.assign][d.spot] = t.value; else delete p.assign[d.assign][d.spot]; save(); }
  else if (d.team !== undefined) { S.team = t.value.trim() || 'Team'; save(); $('#teamName').textContent = S.team; applyTheme(); }
  else if (d.gname) { group(d.gname).name = t.value.trim() || 'Group'; save(); }
  else if (d.gcolor) { group(d.gcolor).color = t.value; save(); renderRoster(); }
  else if (d.tcolor) { S.colors[d.tcolor] = t.value; save(); applyTheme(); renderSetup(); }
  else if (d.pname) { player(d.pname).name = t.value.trim() || 'Player'; save(); renderRoster(); }
  else if (d.pinit !== undefined) { player(d.pinit).initials = t.value.trim().toUpperCase(); save(); renderRoster(); }
  else if (d.poslist) {
    const side = d.poslist; const labels = t.value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    if (!labels.length) return;
    S.positions ||= { ...DEFAULT_POSITIONS }; S.positions[side] = labels;
    const fresh = spotsFor(labels);
    S.plays.filter(p => p.side === side).forEach(p => {
      const old = new Map(p.spots.map(x => [x.key, x]));
      p.spots = fresh.map(f => { const o = old.get(f.key); return o ? { ...o, label: f.label } : { ...f }; });
      const keys = new Set(p.spots.map(x => x.key));
      for (const a of Object.values(p.assign || {})) for (const k of Object.keys(a)) if (!keys.has(k)) delete a[k];
    });
    ui.live.clear(); save(); renderSetup(); toast('Positions updated on every play');
  }
  else if (d.list) {
    const k = d.list;
    if (k === 'actO' || k === 'actD') { const side = k.slice(-1); const next = parseList(t.value, S.actions[side]); if (next.length) S.actions[side] = next; }
    else if (k === 'gains') { const next = parseList(t.value); if (next.length) S.gains = next; }
    else { const side = k.slice(-1); const next = parseList(t.value); if (next.length) S.results[side] = next; }
    save(); toast('Log buttons updated');
  }
  else if (t.id === 'statsGame') { ui.statsGame = t.value; renderStats(); }
  else if (t.id === 'scoreOpp') { const g = currentGame(); if (g) { g.opp = t.value.trim(); save(); renderScore(); } }
  else if (t.id === 'oppName') { const g = currentGame(); if (g) { g.opp = t.value.trim(); save(); renderStats(); renderScore(); } }
  else if (d.impInc !== undefined) { ui.importState.items[+d.impInc].include = t.checked; renderImportReview(); }
  else if (d.impName !== undefined) { const it = ui.importState.items[+d.impName]; it.name = t.value; it.tags = suggestTags(t.value); }
  else if (d.impSide !== undefined) { ui.importState.items[+d.impSide].side = t.value; }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'newTag') ACT.addTag();
  if (e.key === 'Enter' && e.target.id === 'setupTag') ACT.addSetupTag();
  if (e.key === 'Escape' && !$('#sheet').hidden) ACT.closeSheet();
  if (ui.view === 'play' && $('#sheet').hidden && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (e.key === 'ArrowLeft') stepPlay(-1); if (e.key === 'ArrowRight') stepPlay(1); }
});
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' && ui.logDraft) ACT.closeSheet(); });

let persisted = false;
function persistOnce() { if (persisted) return; persisted = true; try { navigator.storage?.persist?.(); } catch { /* ignore */ } }

/* ================= BOOT ================= */
(async function boot() {
  let idx = null; try { idx = await DB.get('kv', 'teams'); } catch { idx = null; }
  if (idx && idx.list?.length) TEAMS = idx;
  else {
    // first run, or upgrade from the single-team version (kv "state")
    let legacy = null; try { legacy = await DB.get('kv', 'state'); } catch { legacy = null; }
    const id = uid(); let st = legacy;
    if (!st) { S = defaultState(); await addSamples(); st = S; }
    TEAMS = { list: [{ id, name: st.team, primary: st.colors?.primary, secondary: st.colors?.secondary }], current: id };
    await DB.put('kv', 'team:' + id, st).catch(() => { });
    await DB.put('kv', 'teams', TEAMS).catch(() => { });
    if (legacy) await DB.del('kv', 'state').catch(() => { });
  }
  if (!TEAMS.list.some(t => t.id === TEAMS.current)) TEAMS.current = TEAMS.list[0].id;
  await loadTeam(TEAMS.current);
  go('library');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
