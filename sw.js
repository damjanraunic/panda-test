// Panda Chinese: keeps the app, the fonts and the voice on the device, so it works without internet.
// The page is always asked for online first (new versions arrive as before); the saved copy is used
// only when there is no answer within 3 seconds.
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

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    const p = u.pathname, scope = new URL(self.registration.scope).pathname;
    if (req.mode === 'navigate' || p === scope || p === scope + 'index.html') return e.respondWith(fresh(u.origin + p, scope, 3000));
    if (p.endsWith('/audio/index.json')) return e.respondWith(fresh(u.origin + p, p, 3000));
    if (/\/audio\/[^/]+\.mp3$/.test(p)) return e.respondWith(caches.open(AUDIO).then(c => c.match(u.origin + p).then(r => r || fetch(req).then(n => { if (n.ok) c.put(u.origin + p, n.clone()); return n; }))));
    if (SHELL.some(s => s !== './' && p === scope + s)) return e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => keep(CORE, req, n))));
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
