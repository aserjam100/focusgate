// Loads the unpacked extension into Playwright's Chromium (new headless mode
// supports extensions when using the full "chromium" channel).

import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function launch({ headless = process.env.HEADED ? false : true, userDataDir } = {}) {
  userDataDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'fg-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const base = `chrome-extension://${extId}`;

  // A page inside the extension to send messages from.
  const ctl = await context.newPage();
  await ctl.goto(`${base}/src/popup/popup.html`);

  const api = {
    context,
    sw,
    extId,
    base,
    ctl,
    async send(type, payload = {}) {
      return ctl.evaluate(([type, payload]) => chrome.runtime.sendMessage({ type, ...payload }), [type, payload]);
    },
    async storage(keys) {
      return sw.evaluate((keys) => chrome.storage.local.get(keys), keys);
    },
    async setState(patch) {
      await sw.evaluate(async (patch) => {
        const { state } = await chrome.storage.local.get('state');
        await chrome.storage.local.set({ state: { ...state, ...patch } });
        await globalThis.focusgate.recompute();
      }, patch);
    },
    async rules() {
      return sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    },
    async recompute() {
      await sw.evaluate(() => globalThis.focusgate.recompute());
    },
    userDataDir,
    async close({ keepProfile = false } = {}) {
      await context.close();
      if (!keepProfile) fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
  // Wait for onInstalled to seed settings.
  for (let i = 0; i < 50; i++) {
    const { settings } = await api.storage(['settings']);
    if (settings) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // Other settings can't be saved without a goal.
  const { settings } = await api.storage(['settings']);
  if (!settings.goals) await api.send('saveGoals', { goals: 'Test goal' });
  return api;
}

/** Schedule with a window covering "now" on today's weekday (or 'always'). */
export function scheduleCoveringNow({ always = false, endInMinutes = 120 } = {}) {
  const now = new Date();
  const days = [[], [], [], [], [], [], []];
  if (!always) {
    const pad = (n) => String(n).padStart(2, '0');
    const start = new Date(now.getTime() - 60 * 60_000);
    const end = new Date(now.getTime() + endInMinutes * 60_000);
    const s = start.getDate() === now.getDate() ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '00:00';
    const e = end.getDate() === now.getDate() ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : '24:00';
    days[now.getDay()] = [{ start: s, end: e }];
  }
  return { always, days };
}

export const EMPTY_SCHEDULE = { always: false, days: [[], [], [], [], [], [], []] };

/** Local HTTP server standing in for the email backend. */
export async function fakeEmailBackend() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/exec`, received, close: () => server.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the page's URL matches. Unlike page.waitForURL this doesn't
 * follow one navigation, so it tolerates the extension's redundant redirect
 * layers aborting each other's in-flight navigations.
 */
export async function waitForUrl(page, re, timeout = 10_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (re.test(page.url())) return page.url();
    await sleep(50);
  }
  throw new Error(`URL never matched ${re}; last: ${page.url()}`);
}

export async function waitFor(fn, { timeout = 10_000, interval = 200 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error('waitFor timed out; last value: ' + JSON.stringify(last));
}
