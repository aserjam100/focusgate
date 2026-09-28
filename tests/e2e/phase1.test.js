import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, EMPTY_SCHEDULE, waitFor, sleep, waitForUrl } from './harness.js';

let fg;
before(async () => {
  fg = await launch();
});
after(async () => fg && (await fg.close()));

const siteId = async (domain) => (await fg.storage(['settings'])).settings.sites.find((s) => s.domain === domain).id;

test('install seeds default sites, weekday schedule, setup grace and content-script registration', async () => {
  const { settings, state } = await fg.storage(['settings', 'state']);
  const grace = state.settingsUnlockUntil - Date.now();
  assert.ok(grace > 29 * 60_000 && grace <= 30 * 60_000, 'one-time 30 min setup grace period');
  assert.deepEqual(
    settings.sites.map((s) => s.domain),
    ['instagram.com', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com', 'reddit.com']
  );
  assert.deepEqual(settings.globalSchedule.days[1], [{ start: '09:00', end: '18:00' }]);
  const scripts = await fg.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.equal(scripts.length, 1);
  assert.ok(scripts[0].matches.includes('*://*.reddit.com/*'));
});

test('outside a window everything is free; entering a window adds one DNR rule per site', async () => {
  let res = await fg.send('saveGoals', { goals: 'Ship the parser rewrite' });
  assert.equal(res.error, undefined);
  res = await fg.send('saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } });
  assert.equal(res.error, undefined);
  assert.equal((await fg.rules()).length, 0);
  // Toggling off/on outside a window is free.
  const id = await siteId('twitter.com');
  res = await fg.send('updateSite', { id, patch: { enabled: false } });
  assert.equal(res.error, undefined);
  res = await fg.send('updateSite', { id, patch: { enabled: true } });
  assert.equal(res.error, undefined);

  res = await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow() } });
  assert.equal(res.error, undefined);
  // End the first-install setup grace period.
  await fg.setState({ settingsUnlockUntil: 0 });
  const rules = await fg.rules();
  assert.equal(rules.length, 6);
  assert.ok(rules.every((r) => r.action.type === 'redirect' && r.condition.resourceTypes[0] === 'main_frame'));
});

test('blocked navigation (incl. subdomains) redirects to the block page with site, goals and countdown', async () => {
  const page = await fg.context.newPage();
  for (const [url, site] of [
    ['https://old.reddit.com/r/programming/?sort=top', 'reddit.com'],
    ['https://m.youtube.com/watch?v=abc#t=1', 'youtube.com'],
    ['https://www.instagram.com/', 'instagram.com'],
    ['https://x.com/home', 'x.com'],
  ]) {
    await page.goto(url).catch(() => {});
    await waitForUrl(page, /block\.html/);
    const u = page.url();
    assert.ok(u.startsWith(`${fg.base}/src/block/block.html?site=${site}&url=`), u);
    await page.waitForSelector('#title');
    assert.equal(await page.textContent('#title'), `${site} is blocked`);
    assert.match(await page.textContent('#countdown'), /Block window ends in \d+h \d+m/);
    assert.equal(await page.textContent('#goals'), 'Ship the parser rewrite');
    assert.ok(await page.isVisible('#partner'));
    assert.ok(await page.isVisible('#review-open'));
  }
  // The original URL (with query and fragment) is recoverable.
  await page.goto('https://old.reddit.com/r/programming/?sort=top').catch(() => {});
  await waitForUrl(page, /block\.html/);
  const orig = await page.evaluate(() => location.href.slice(location.href.indexOf('&url=') + 5));
  assert.equal(orig, 'https://old.reddit.com/r/programming/?sort=top');
  await page.close();
});

test('during a window: unchecking, deleting, pausing and editing settings are refused; tightening works', async () => {
  const id = await siteId('reddit.com');
  for (const [type, payload] of [
    ['updateSite', { id, patch: { enabled: false } }],
    ['updateSite', { id, patch: { mode: 'none' } }],
    ['updateSite', { id, patch: { scheduleMode: 'custom' } }],
    ['removeSite', { id }],
    ['setEnabled', { enabled: false }],
    ['saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } }],
    ['saveSettings', { patch: { unlockMinutes: 240 } }],
  ]) {
    const res = await fg.send(type, payload);
    assert.equal(res.code, 'LOCKED', `${type} ${JSON.stringify(payload)} should be locked`);
  }
  const { settings } = await fg.storage(['settings']);
  assert.equal(settings.enabled, true);
  assert.ok(settings.sites.find((s) => s.id === id).enabled);

  let res = await fg.send('addSite', { domain: 'https://news.ycombinator.com/news' });
  assert.equal(res.error, undefined);
  res = await fg.send('updateSite', { id, patch: { grayscale: true } });
  assert.equal(res.error, undefined, 'turning grayscale on is tightening');
  assert.equal((await fg.rules()).length, 7);
});

test('popup shows locked message and reverts the toggle', async () => {
  const popup = await fg.context.newPage();
  await popup.goto(`${fg.base}/src/popup/popup.html`);
  await popup.waitForSelector('#sites li');
  const row = popup.locator('#sites li', { hasText: 'reddit.com' });
  assert.equal(await row.locator('.pill').textContent(), 'blocked');
  await row.locator('.switch').click();
  await popup.waitForSelector('#message.error');
  assert.match(await popup.textContent('#message'), /Locked/);
  assert.equal(await row.locator('input[type=checkbox]').isChecked(), true);
  assert.ok(await popup.isVisible('#message button'), 'offers "Unlock settings…"');
  assert.match(await popup.textContent('#summary'), /Block window active/);
  await popup.close();
});

test('temporary unlock lifts the block, shows a badge countdown, and auto-relocks via alarm', async () => {
  const id = await siteId('reddit.com');
  await fg.setState({ unlocks: { [id]: Date.now() + 4000 } });
  let rules = await fg.rules();
  assert.ok(!rules.some((r) => r.condition.requestDomains[0] === 'reddit.com'));
  assert.equal(await fg.sw.evaluate(() => chrome.action.getBadgeText({})), '1m');
  // Wait for the transition alarm (no recompute triggered by us).
  await waitFor(async () => (await fg.rules()).some((r) => r.condition.requestDomains[0] === 'reddit.com'), { timeout: 15_000 });
  assert.equal(await fg.sw.evaluate(() => chrome.action.getBadgeText({})), '');
  const { state } = await fg.storage(['state']);
  assert.equal(state.unlocks[id], undefined, 'expired unlock pruned');
});

test('tabs already open on a site are sent to the block page when the block starts', async () => {
  const id = await siteId('reddit.com');
  await fg.setState({ unlocks: { [id]: Date.now() + 60_000 } });
  await fg.context.route('https://www.reddit.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>fake reddit</h1>' })
  );
  const page = await fg.context.newPage();
  await page.goto('https://www.reddit.com/r/all');
  assert.equal(await page.textContent('h1'), 'fake reddit');
  await fg.setState({ unlocks: {} });
  await waitForUrl(page, /block\.html\?site=reddit\.com&url=https:\/\/www\.reddit\.com\/r\/all/);
  await page.close();
  await fg.context.unroute('https://www.reddit.com/**');
});

test('browser restart mid-unlock: unlock persists, then relocks once expired', async () => {
  const id = await siteId('reddit.com');
  await fg.setState({ unlocks: { [id]: Date.now() + 8000 } });
  assert.equal((await fg.rules()).length, 6);
  const dir = fg.userDataDir;
  await fg.close({ keepProfile: true });
  fg = await launch({ userDataDir: dir });
  // Still unlocked right after restart.
  await fg.recompute();
  assert.ok(!(await fg.rules()).some((r) => r.condition.requestDomains[0] === 'reddit.com'));
  // And relocks when the unlock expires (alarm recreated on wake).
  await waitFor(async () => (await fg.rules()).length === 7, { timeout: 20_000 });
});

test('pause outside a window works and is gated inside it', async () => {
  // Leave the window: settings are locked, so grant a settings unlock first.
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  let res = await fg.send('saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } });
  assert.equal(res.error, undefined);
  await fg.setState({ settingsUnlockUntil: 0 });
  res = await fg.send('setEnabled', { enabled: false });
  assert.equal(res.error, undefined);
  assert.equal(await fg.sw.evaluate(() => chrome.action.getBadgeText({})), 'off');
  res = await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow() } });
  assert.equal(res.error, undefined);
  assert.equal((await fg.rules()).length, 0, 'paused: nothing blocked');
  res = await fg.send('setEnabled', { enabled: true });
  assert.equal(res.error, undefined, 'resuming is always allowed');
  assert.equal((await fg.rules()).length, 7);
  res = await fg.send('setEnabled', { enabled: false });
  assert.equal(res.code, 'LOCKED');
  await sleep(10);
});
