// Navigations that declarativeNetRequest never sees must still be blocked.
// Regression for: x.com/home kept loading while blocked (served by X's
// service worker) until the popup was opened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, EMPTY_SCHEDULE, waitFor, waitForUrl } from './harness.js';
import { startPwaSite, addRawSite } from './pwa-site.js';

let fg, site;
before(async () => {
  site = await startPwaSite();
  fg = await launch();
  await fg.send('saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } });
  await addRawSite(fg, 'localhost');
});
after(async () => {
  await fg?.close();
  site?.close();
});

async function block() {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow() } });
  await fg.setState({ settingsUnlockUntil: 0 });
}
async function unblock() {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  await fg.send('saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } });
  await fg.setState({ settingsUnlockUntil: 0 });
}

test('a navigation answered by the site’s service worker is still blocked', async () => {
  const warm = await fg.context.newPage();
  await warm.goto(site.origin + '/home');
  await warm.waitForSelector('body[data-sw=ready]');
  await warm.close();

  await block();
  assert.ok((await fg.rules()).some((r) => r.condition.requestDomains[0] === 'localhost'));
  // The site's service worker answers from cache (or, under load, fetches
  // /home itself). Either way no main_frame request reaches DNR, so only the
  // backup layers can catch it. Without them this page stays on /home.
  const page = await fg.context.newPage();
  await page.goto(site.origin + '/home').catch(() => {});
  await waitForUrl(page, /block\.html\?site=localhost&url=http:\/\/localhost:\d+\/home$/);
  await page.close();
  await unblock();
});

test('going Back to a previously visited page is blocked', async () => {
  const page = await fg.context.newPage();
  await page.goto(site.origin + '/home');
  await page.goto(`${site.origin.replace('localhost', '127.0.0.1')}/other`);
  await block();
  await page.goBack().catch(() => {});
  await waitFor(async () => page.url().includes('block.html?site=localhost'), { timeout: 5000 });
  await page.close();
  await unblock();
});
