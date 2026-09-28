// FocusGate content script (runs at document_start on every configured site).
//   - grayscale during block windows
//   - time-on-site heartbeat for stats
// Driven by the `runtime` object the service worker writes to
// chrome.storage.local, so this script never re-derives schedules.

(() => {
  // Re-injection after an extension update: tear down the orphaned instance.
  if (typeof window.__fgCleanup === 'function') {
    try {
      window.__fgCleanup();
    } catch {
      /* old instance already dead */
    }
  }

  const HEARTBEAT_SECONDS = 15;
  const STYLE_ID = 'fg-grayscale';
  const host = location.hostname.toLowerCase();
  let mine = null; // this domain's entry in runtime.byDomain

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  function applyGrayscale() {
    const existing = document.getElementById(STYLE_ID);
    if (!mine?.grayscale) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    // The root element is exempt from filter's fixed-position containing
    // block rule, so this doesn't break sticky headers.
    el.textContent = 'html { filter: grayscale(100%) !important; }';
    (document.head || document.documentElement).appendChild(el);
  }

  // Single-page apps sometimes replace <head>; put the style back if so.
  const observer = new MutationObserver(() => {
    if (mine?.grayscale && !document.getElementById(STYLE_ID)) applyGrayscale();
  });

  const heartbeat = setInterval(() => {
    if (!alive()) return teardown();
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    chrome.runtime.sendMessage({ type: 'heartbeat', host, seconds: HEARTBEAT_SECONDS }).catch(() => {});
  }, HEARTBEAT_SECONDS * 1000);

  function setRuntime(rt) {
    const byDomain = rt?.byDomain || {};
    // Most specific configured domain for this host.
    let best = null;
    for (const d of Object.keys(byDomain)) {
      if ((host === d || host.endsWith('.' + d)) && (!best || d.length > best.length)) best = d;
    }
    mine = best ? byDomain[best] : null;
    applyGrayscale();
  }

  const onStorage = (changes, area) => {
    if (area === 'local' && changes.runtime) setRuntime(changes.runtime.newValue);
  };

  function teardown() {
    observer.disconnect();
    clearInterval(heartbeat);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {
      /* context invalidated */
    }
    document.getElementById(STYLE_ID)?.remove();
  }
  window.__fgCleanup = teardown;

  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener(onStorage);
  chrome.storage.local.get('runtime').then(({ runtime }) => setRuntime(runtime));
})();
