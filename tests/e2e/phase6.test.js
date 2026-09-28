import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, waitFor, EMPTY_SCHEDULE } from './harness.js';
import { dateKey } from '../../src/lib/time.js';

let fg;
before(async () => {
  fg = await launch();
  await fg.send('saveSettings', { patch: { globalSchedule: EMPTY_SCHEDULE } });
  await fg.context.route('https://www.reddit.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>fake reddit</h1>' }));
});
after(async () => fg && (await fg.close()));

test('time on a tracked site is recorded from the focused tab heartbeat', async () => {
  // Headless Chrome has no OS input, so chrome.idle always reports "idle".
  await fg.sw.evaluate(() => (chrome.idle.queryState = async () => 'active'));
  const page = await fg.context.newPage();
  await page.goto('https://www.reddit.com/');
  await page.bringToFront();
  const secs = await waitFor(
    async () => (await fg.storage(['stats'])).stats.days?.[dateKey()]?.time?.['reddit.com'],
    { timeout: 25_000, interval: 500 }
  );
  assert.equal(secs, 15);
  await page.close();
});

test('heartbeats while idle, from untracked hosts, or from non-tab senders are ignored', async () => {
  const before = (await fg.storage(['stats'])).stats.days[dateKey()].time;
  await fg.send('heartbeat', { host: 'www.reddit.com', seconds: 15 }); // from an extension page
  await fg.sw.evaluate(() => (chrome.idle.queryState = async () => 'idle'));
  const page = await fg.context.newPage();
  await page.goto('https://www.reddit.com/');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 16_000)));
  await page.close();
  assert.deepEqual((await fg.storage(['stats'])).stats.days[dateKey()].time, before);
});

test('dashboard shows streaks, time per site per day and attempts per method', async () => {
  // Seed 10 days of history: an in-window unlock 4 days ago.
  const day = (n) => dateKey(Date.now() - n * 86_400_000);
  const days = {};
  for (let i = 0; i < 10; i++) {
    days[day(i)] = {
      time: { 'reddit.com': 600 + i * 300, 'youtube.com': i % 2 ? 1800 : 0 },
      attempts: { partner: i === 4 ? 2 : 0, review: i === 1 ? 1 : 0, phrase: 0 },
      successes: { partner: i === 4 ? 1 : 0, review: i === 1 ? 1 : 0, phrase: 0 },
      windowUnlocks: i === 4 ? 1 : 0,
    };
  }
  await fg.sw.evaluate(async (stats) => chrome.storage.local.set({ stats }), { installDate: day(9), days });

  const page = await fg.context.newPage();
  await page.goto(`${fg.base}/src/stats/stats.html`);
  await page.waitForSelector('#heat tbody tr');
  assert.equal(await page.textContent('#streak'), '4 days');
  assert.equal(await page.textContent('#longest'), '5 days');
  assert.equal(await page.textContent('#today'), '10m');
  assert.equal(await page.textContent('#unlocks'), '2');
  assert.match(await page.textContent('#unlocks-sub'), /1 during block windows/);
  assert.equal(await page.locator('#heat thead th').count(), 8);
  assert.equal(await page.locator('.bar-row').first().locator('.bar-label').textContent(), 'reddit.com');

  const rows = await page.locator('#methods tbody tr').allTextContents();
  assert.match(rows[0], /Partner code\s*21\s*50%/);
  assert.match(rows[1], /Day review\s*11\s*100%/);

  await page.click('.seg button[data-days="30"]');
  assert.equal(await page.locator('#heat thead th').count(), 31);
  await page.close();
});
