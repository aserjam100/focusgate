// A local "PWA" whose service worker answers navigations from its cache, the
// way x.com does. Such navigations never reach the network, so
// declarativeNetRequest never sees them.
import http from 'node:http';

const PAGE = `<!doctype html><html><head><title>fake pwa</title></head><body><h1>pwa home</h1>
<script>navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => (document.body.dataset.sw = 'ready'));</script></body></html>`;
const SW = `
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open('v1').then((c) => c.addAll(['/home']))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(caches.match('/home').then((r) => r || fetch(e.request)));
});`;

export async function startPwaSite() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/sw.js') {
      res.setHeader('content-type', 'text/javascript');
      return res.end(SW);
    }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://localhost:${server.address().port}`, hits, close: () => server.close() };
}

/** Add a site directly to storage (normalizeDomain rightly rejects "localhost" in the UI). */
export async function addRawSite(fg, domain) {
  await fg.sw.evaluate(async (domain) => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.sites.push({ id: 's_pwa', domain, enabled: true, mode: 'full', grayscale: false, scheduleMode: 'global', schedule: { always: false, days: [[], [], [], [], [], [], []] } });
    await chrome.storage.local.set({ settings });
    await globalThis.focusgate.recompute();
  }, domain);
}
