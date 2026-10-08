/* Huddle assistant link.
   The coach's iPad and an assistant's phone trade small messages through a public relay (ntfy.sh).
   Every message is encrypted (AES-GCM) with a key that only lives in the pairing QR code, so the relay
   only ever sees an unreadable blob on a random channel name. Messages are cached by the relay for a few
   hours, so a device that drops signal catches up when it reconnects. */
const HLink = (() => {
  const RELAY = window.HUDDLE_RELAY || 'https://ntfy.sh';   // override only for local testing
  const enc64 = u8 => { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const dec64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const newCreds = () => ({ topic: 'huddle-' + enc64(rand(15)), key: enc64(rand(32)) });
  const keys = new Map();
  const keyFor = k => {
    if (!keys.has(k)) keys.set(k, crypto.subtle.importKey('raw', dec64(k), 'AES-GCM', false, ['encrypt', 'decrypt']));
    return keys.get(k);
  };
  async function seal(key, obj) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(key), new TextEncoder().encode(JSON.stringify(obj)));
    return `h1.${enc64(iv)}.${enc64(new Uint8Array(ct))}`;
  }
  async function open(key, str) {
    const [v, iv, ct] = String(str).split('.');
    if (v !== 'h1' || !iv || !ct) return null;
    try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec64(iv) }, await keyFor(key), dec64(ct)))); }
    catch { return null; }   // not ours / wrong key
  }
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const deviceId = (() => { let d = lsGet('huddle.device'); if (!d) { d = enc64(rand(6)); lsSet('huddle.device', d); } return d; })();

  /* one live connection: send() and onMsg for everything another device sends on the channel */
  function connect({ topic, key, onMsg, onStatus }) {
    const sinceKey = 'huddle.since.' + topic;
    let es = null, retry = null, closed = false, status = '';
    const setStatus = s => { if (s !== status) { status = s; onStatus?.(s); } };
    function listen() {
      clearTimeout(retry); es?.close(); if (closed) return;
      if (!navigator.onLine) { setStatus('offline'); retry = setTimeout(listen, 4000); return; }
      const since = lsGet(sinceKey) || '6h';
      es = new EventSource(`${RELAY}/${encodeURIComponent(topic)}/sse?since=${encodeURIComponent(since)}`);
      es.onopen = () => setStatus('live');
      es.onmessage = async e => {
        let ev; try { ev = JSON.parse(e.data); } catch { return; }
        if (ev.event && ev.event !== 'message') { if (ev.event === 'open') setStatus('live'); return; }
        if (ev.id) lsSet(sinceKey, ev.id);
        const msg = await open(key, ev.message);
        if (msg && msg.from !== deviceId) onMsg(msg);
      };
      es.onerror = () => { setStatus('offline'); es.close(); es = null; retry = setTimeout(listen, 3000); };
    }
    const wake = () => { if (document.visibilityState === 'visible' && !closed) listen(); };
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    listen();
    return {
      async send(obj) {
        const body = await seal(key, { ...obj, from: deviceId });
        const res = await fetch(`${RELAY}/${encodeURIComponent(topic)}`, { method: 'POST', body });
        if (!res.ok) throw new Error('Relay said ' + res.status);
        return true;
      },
      status: () => status,
      reconnect: listen,
      close() { closed = true; clearTimeout(retry); es?.close(); document.removeEventListener('visibilitychange', wake); removeEventListener('online', wake); }
    };
  }
  return { newCreds, connect, enc64, dec64, deviceId };
})();
