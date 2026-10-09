/* Huddle Logger: the assistant coach's phone page.
   Paired by scanning the QR code in Huddle → Setup → Assistant logger (the code carries the channel and key in the
   link's #fragment, which never leaves the phone). Follows the play on the coach's iPad; every "Log play" is sent
   to the iPad, where it counts in stats, the scoreboard and the touch counts. Logs queue here when there is no signal. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const inkFor = hex => { const v = parseInt(String(hex || '#444444').slice(1), 16); const l = ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114; return l > 150 ? '#111' : '#fff'; };
const ls = { get(k, d) { try { const v = localStorage.getItem('huddle.lg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('huddle.lg.' + k, JSON.stringify(v)); } catch { /* ignore */ } } };
const POINTS = (side, r) => { r = String(r || '').toLowerCase(); if (side === 'O') return /^td\b|touchdown|\b1.?pt|\b2.?pt/.test(r); return /allowed|safety|pick.?six/.test(r); };

/* ---------- pairing ---------- */
function readPairing() {
  const m = location.hash.match(/[#&]p=([\w-]+)/);
  if (m) { try { const p = JSON.parse(new TextDecoder().decode(HLink.dec64(m[1]))); if (p.t && p.k) { ls.set('pair', p); return p; } } catch { /* bad link */ } }
  return ls.get('pair', null);
}
const PAIR = readPairing();
if (PAIR && ls.get('pairTopic', '') !== PAIR.t) {   // new code scanned: start clean
  ls.set('pairTopic', PAIR.t); ls.set('cur', null); ls.set('pending', null); ls.set('hist', []); ls.set('draft', null); ls.set('recent', []);
}

/* ---------- state ---------- */
let cur = ls.get('cur', null);            // the play the assistant is logging
let pending = ls.get('pending', null);    // coach moved on while marks were in progress
let hist = ls.get('hist', []);            // last few plays the coach showed
const blank = () => ({ kids: [], marks: {}, gain: null, result: null });
let draft = ls.get('draft', null) || blank();
if (!Array.isArray(draft.kids)) draft.kids = [...new Set(Object.values(draft.marks || {}).flat())];   // drafts saved by 1.15.0
let outbox = ls.get('outbox', []);        // messages not yet delivered
let recent = ls.get('recent', []);        // this phone's recent logs (for undo + reassurance)
const persist = () => { ls.set('cur', cur); ls.set('pending', pending); ls.set('hist', hist); ls.set('draft', draft); ls.set('outbox', outbox); ls.set('recent', recent); };
const dirty = () => draft.kids.length > 0 || Object.keys(draft.marks).length > 0 || !!draft.result || !!draft.gain;
const canLog = () => Object.keys(draft.marks).length > 0 || !!draft.result || !!draft.gain;

function setCur(c) {
  cur = c; pending = null;
  hist = [c, ...hist.filter(h => h.play?.id !== c.play?.id)].slice(0, 4);
  persist(); render();
}
function takeCur(c) {
  if (!cur || !dirty() || cur.play?.id === c.play?.id) {
    // same play: keep what's been tapped, refresh the lineup and names
    return setCur(c);
  }
  pending = c; hist = [c, ...hist.filter(h => h.play?.id !== c.play?.id)].slice(0, 4); persist(); render();
}

/* ---------- connection ---------- */
let conn = null, flushing = false, retry = null, sendFail = false;
function start() {
  if (!PAIR) return render();
  $('#lgTeam').textContent = `${PAIR.team || 'Team'} logger`;
  conn = HLink.connect({
    topic: PAIR.t, key: PAIR.k,
    onStatus: () => { renderStatus(); if (conn?.status() === 'live') flush(); },
    onMsg: m => {
      if (m.type === 'cur' && m.play) takeCur(m);
      else if (m.type === 'logged') { recent.unshift({ id: m.id, play: m.play, coach: true, t: Date.now() }); recent = recent.slice(0, 8); persist(); renderRecent(); toast(`Coach logged ${m.play} on the iPad`); }
    }
  });
  queue({ type: 'hello', quiet: ls.get('helloed', false) }); ls.set('helloed', true);
}
function queue(msg) { outbox.push(msg); persist(); flush(); }
async function flush() {
  if (flushing || !conn) return; flushing = true; clearTimeout(retry);
  try {
    while (outbox.length) {
      try { await conn.send(outbox[0]); sendFail = false; } catch { sendFail = true; retry = setTimeout(flush, 5000); break; }
      const sent = outbox.shift();
      if (sent.type === 'log') { const r = recent.find(x => x.id === sent.entry.id); if (r) r.sent = true; }
      persist();
    }
  } finally { flushing = false; renderStatus(); renderRecent(); }
}
addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { flush(); wake(); } });

/* ---------- actions ---------- */
function mark(aid, pid) {
  const a = cur.acts.find(x => x.id === aid); if (!a) return;
  const now = draft.marks[aid] || [];
  draft.marks[aid] = now.includes(pid) ? now.filter(x => x !== pid) : (a.multi ? [...now, pid] : [pid]);
  if (!draft.marks[aid].length) delete draft.marks[aid];
  persist(); render();
}
// tap a name: that kid moves up into the play with their buttons open
function pick(pid) { if (!draft.kids.includes(pid)) draft.kids.push(pid); persist(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
// ✕ on a kid in the play: back to the list, and their taps are cleared
function unpick(pid) {
  draft.kids = draft.kids.filter(x => x !== pid);
  for (const [aid, pids] of Object.entries(draft.marks)) { draft.marks[aid] = pids.filter(x => x !== pid); if (!draft.marks[aid].length) delete draft.marks[aid]; }
  persist(); render();
}
function logPlay() {
  if (!cur || !canLog()) return;
  const entry = { id: uid(), t: Date.now(), side: cur.side, groupId: cur.group.id, playId: cur.play?.id || null, playName: cur.play?.name || 'Play',
    lineup: cur.lineup || {}, marks: draft.marks, result: draft.result, gain: draft.gain };
  recent.unshift({ id: entry.id, play: entry.playName, result: entry.result, t: entry.t, sent: false }); recent = recent.slice(0, 8);
  draft = blank();
  queue({ type: 'log', entry });
  if (pending) { const p = pending; pending = null; setCur(p); } else { persist(); render(); }
  navigator.vibrate?.(30);
  toast(`Logged ${entry.playName}`);
}
function undoLast() {
  const r = recent.find(x => !x.coach && !x.undone); if (!r) return;
  const i = outbox.findIndex(m => m.type === 'log' && m.entry.id === r.id);
  if (i >= 0) outbox.splice(i, 1); else queue({ type: 'del', id: r.id });
  r.undone = true; persist(); renderRecent(); renderStatus(); toast(`Removed ${r.play}`);
}

/* ---------- render ---------- */
function disc(k, color) { return `<span class="disc" style="--gc:${color};--gc-ink:${inkFor(color)}">${esc(k.i)}</span>`; }
function render() {
  const el = $('#lg');
  if (!PAIR) {
    el.innerHTML = `<div class="lg-empty"><h2>Not paired yet</h2><p>On the coach's iPad: Huddle → Setup → Assistant logger. Scan that code with this phone's camera.</p></div>`;
    return renderStatus();
  }
  if (!cur) {
    el.innerHTML = `<div class="lg-empty"><h2>Waiting for the coach</h2><p>The play shows up here a few seconds after the coach opens it on the iPad.</p></div>`;
    renderStatus(); return;
  }
  const color = cur.group.color; const lineup = cur.lineup || {};
  const spotOrder = (cur.play?.spots || []).map(s => s[0]);
  const fieldIds = spotOrder.map(k => lineup[k]).filter(Boolean);
  const posOf = Object.fromEntries(Object.entries(lineup).map(([k, pid]) => [pid, (cur.play?.spots || []).find(s => s[0] === k)?.[1] || '']));
  const kidById = Object.fromEntries(cur.kids.map(k => [k.id, k]));
  const here = cur.kids.filter(k => !k.out);
  const inPlay = draft.kids.map(id => kidById[id]).filter(Boolean);
  const rest = [...fieldIds.map(id => kidById[id]).filter(k => k && !k.out), ...here.filter(k => !fieldIds.includes(k.id))].filter(k => !draft.kids.includes(k.id));
  const where = k => posOf[k.id] || 'bench';
  el.innerHTML = `
    ${pending ? `<button type="button" class="lg-pending" data-act="switch" data-i="pending">Coach is on <b>${esc(pending.play.name)}</b> now. Log this play first, or tap to switch.</button>` : ''}
    <div class="lg-play" style="--gc:${color}">
      <div class="lg-side">${cur.side === 'O' ? 'Offense' : 'Defense'} · ${esc(cur.group.name)}</div>
      <h2>${esc(cur.play?.name || 'Play')}</h2>
      ${hist.length > 1 ? `<div class="lg-hist">${hist.filter(h => h.play?.id !== cur.play?.id).slice(0, 3).map(h => `<button type="button" class="tagchip" data-act="switch" data-id="${esc(h.play.id)}">${esc(h.play.name)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="lg-in">
      ${inPlay.length ? inPlay.map(k => `<div class="lg-kid has">
        <div class="lg-who">${disc(k, color)}<b>${esc(k.n)}</b><span class="muted">${esc(where(k))}</span>
          <button type="button" class="lg-x" data-act="unpick" data-p="${esc(k.id)}" aria-label="Remove ${esc(k.n)} from this play">✕</button></div>
        <div class="lg-acts" style="--n:${cur.acts.length}">${cur.acts.map(a => `<button type="button" class="lg-act ${(draft.marks[a.id] || []).includes(k.id) ? 'on' : ''}" data-act="mark" data-a="${esc(a.id)}" data-p="${esc(k.id)}">${esc(a.label)}</button>`).join('')}</div>
      </div>`).join('') : '<div class="lg-hint">Tap the kids who were in on the play.</div>'}
    </div>
    <div class="lg-res">
      <div class="results"><span class="label">Yards</span>${(cur.gains || []).map(g => `<button type="button" class="tagchip ${draft.gain === g ? 'on' : ''}" data-act="gain" data-v="${esc(g)}">${esc(g)}</button>`).join('')}</div>
      <div class="results"><span class="label">Result</span>${(cur.res || []).map(r => `<button type="button" class="tagchip ${draft.result === r ? 'on' : ''}" data-act="result" data-v="${esc(r)}">${esc(r)}${POINTS(cur.side, r) ? ' ★' : ''}</button>`).join('')}</div>
    </div>
    ${rest.length ? `<div class="lg-names">${rest.map(k => `<button type="button" class="lg-name ${posOf[k.id] ? '' : 'bench'}" data-act="pick" data-p="${esc(k.id)}">${disc(k, color)}<span><b>${esc(k.n)}</b><small>${esc(where(k))}</small></span></button>`).join('')}</div>` : ''}
    <div class="lg-recent" id="lgRecent"></div>
    <div class="lg-foot">
      <button type="button" class="btn" data-act="clear" ${dirty() ? '' : 'disabled'}>Clear</button>
      <button type="button" class="btn primary lg-log" data-act="log" ${canLog() ? '' : 'disabled'}>Log play</button>
    </div>`;
  renderRecent(); renderStatus();
}
function renderRecent() {
  const el = $('#lgRecent'); if (!el) return;
  const rows = recent.slice(0, 4);
  el.innerHTML = rows.length ? `<div class="lg-rhead"><span class="label">Recent</span>${recent.some(r => !r.coach && !r.undone) ? '<button type="button" class="btn small ghost" data-act="undo">Undo last</button>' : ''}</div>
    ${rows.map(r => `<div class="lg-row ${r.undone ? 'undone' : ''}"><span>${esc(r.play)}${r.result ? ' · ' + esc(r.result) : ''}</span><span class="muted">${r.coach ? 'coach, on iPad' : r.undone ? 'removed' : r.sent ? 'sent ✓' : 'waiting…'}</span></div>`).join('')}` : '';
}
function renderStatus() {
  const el = $('#lgStatus'); if (!el) return;
  const st = sendFail || !navigator.onLine ? 'offline' : (conn?.status() || 'offline'); const n = outbox.filter(m => m.type !== 'hello').length;
  el.innerHTML = `<span class="ldot ${st}"></span>${st === 'live' ? (n ? `Sending ${n}…` : 'Connected') : (n ? `No signal · ${n} waiting` : 'No signal')}`;
}
let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'mark') mark(b.dataset.a, b.dataset.p);
  else if (a === 'pick') pick(b.dataset.p);
  else if (a === 'unpick') unpick(b.dataset.p);
  else if (a === 'gain') { draft.gain = draft.gain === b.dataset.v ? null : b.dataset.v; persist(); render(); }
  else if (a === 'result') { draft.result = draft.result === b.dataset.v ? null : b.dataset.v; persist(); render(); }
  else if (a === 'log') logPlay();
  else if (a === 'clear') { draft = blank(); if (pending) { const p = pending; pending = null; setCur(p); } else { persist(); render(); } }
  else if (a === 'undo') undoLast();
  else if (a === 'switch') { const c = b.dataset.i === 'pending' ? pending : hist.find(h => h.play?.id === b.dataset.id); if (c) setCur(c); }
});

let lock = null;
async function wake() { try { if (document.visibilityState === 'visible' && navigator.wakeLock && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch { /* not allowed */ } }

render(); start(); wake();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
