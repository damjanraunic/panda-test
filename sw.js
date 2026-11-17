// Panda Chinese: keeps the app, the fonts and the voice on the device, so it works without internet.
// Opening the app: the saved copy opens at once, and the newest version is checked for at the same time.
// If there is a new one, the page is told ("downloading", then "ready"), so it can show it and switch.
// Emergency: replace this file with sw-off.js (renamed to sw.js) to switch all of this off for everyone.
const CORE = 'pc-core-1', AUDIO = 'pc-audio-1', KEEP = [CORE, AUDIO];
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const SHARED = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CORE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('pc-') && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (name, key, r) => { if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(name).then(x => x.put(key, c)).catch(() => {}); } return r; };

// online first; after `ms` without an answer (or offline) the saved copy
function fresh(url, key, ms) {
  return new Promise(res => {
    let done = false; const fin = r => { if (!done && r) { done = true; res(r); } };
    const net = fetch(url, { cache: 'no-cache' }).then(r => keep(CORE, key, r));
    const t = setTimeout(() => caches.match(key).then(fin), ms);
    net.then(r => { clearTimeout(t); fin(r); })
      .catch(() => { clearTimeout(t); caches.match(key).then(r => fin(r || Response.error())); });
  });
}

// the newest version of the page: what happened last time (for a page that asks after it has loaded)
let UPD = { st: 'none', t: 0 };
async function tell(msg) { UPD = { ...msg, t: Date.now() }; for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ pc: 'upd', ...msg }); }
const sig = r => r && (r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '');
async function checkNew(url, key) {
  try {
    const c = await caches.open(CORE), old = await c.match(key);
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return tell({ st: 'none' });
    if (old && sig(old) && sig(old) === sig(r)) return tell({ st: 'none' });
    await tell({ st: 'downloading', p: 0 });
    // read it piece by piece, so the page can show how far it is
    // (the size of the saved version is the best guess: the server may send the page compressed)
    const total = (old ? (await old.clone().blob()).size : 0) || +r.headers.get('content-length') || 0, parts = []; let got = 0, last = 0;
    const rd = r.body && r.body.getReader ? r.body.getReader() : null;
    if (rd) for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; const pc = total ? Math.floor(got * 100 / total) : 0; if (pc >= last + 5) { last = pc; tell({ st: 'downloading', p: Math.min(99, pc) }); } }
    const body = rd ? new Blob(parts) : await r.blob();
    await c.put(key, new Response(body, { status: 200, headers: r.headers }));
    await tell({ st: 'ready' });
  } catch (e) { tell({ st: 'offline' }); }
}
self.addEventListener('message', e => { if (e.data && e.data.pc === 'status' && e.source) e.source.postMessage({ pc: 'upd', ...UPD }); });

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    const p = u.pathname, scope = new URL(self.registration.scope).pathname;
    if (req.mode === 'navigate' || p === scope || p === scope + 'index.html') {
      // the saved copy at once, and a check for a newer one; the very first time straight from the internet
      e.respondWith(caches.match(scope).then(r => {
        if (!r) return fresh(u.origin + p, scope, 10000);
        UPD = { st: 'checking', t: Date.now() };
        e.waitUntil(checkNew(u.origin + p, scope));
        return r;
      }));
      return;
    }
    if (p.endsWith('/audio/index.json')) return e.respondWith(fresh(u.origin + p, p, 3000));
    if (/\/audio\/[^/]+\.mp3$/.test(p)) return e.respondWith(caches.open(AUDIO).then(c => c.match(u.origin + p).then(r => r || fetch(req).then(n => { if (n.ok) c.put(u.origin + p, n.clone()); return n; }))));
    // the manifest and the icons: online first too, so a new name or icon reaches everyone (saved copy without internet)
    if (SHELL.some(s => s !== './' && p === scope + s)) return e.respondWith(fresh(u.origin + p, u.origin + p, 3000));
    return;
  }
  // fonts and the stroke-order library: the saved copy at once, refreshed in the background
  if (SHARED.test(u.hostname)) {
    e.respondWith(caches.match(req).then(r => {
      const net = fetch(req).then(n => keep(CORE, req, n)).catch(() => r || Response.error());
      return r || net;
    }));
  }
});
