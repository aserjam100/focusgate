import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, waitFor } from './harness.js';
import { DEFAULT_PHRASE } from '../../src/lib/defaults.js';

let fg, redditId;
before(async () => {
  fg = await launch();
  await fg.context.route('https://www.reddit.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>fake reddit</h1>' }));
  await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow({ endInMinutes: 90 }) } });
  const { settings } = await fg.storage(['settings']);
  redditId = settings.sites.find((s) => s.domain === 'reddit.com').id;
  await fg.send('updateSite', { id: redditId, patch: { mode: 'none', grayscale: true } });
  await fg.setState({ settingsUnlockUntil: 0 });
});
after(async () => fg && (await fg.close()));

const filter = (page) => page.evaluate(() => getComputedStyle(document.documentElement).filter);

test('grayscale applies during the block window on a no-block site', async () => {
  const page = await fg.context.newPage();
  await page.goto('https://www.reddit.com/');
  await waitFor(async () => (await filter(page)) === 'grayscale(1)');
  // Survives the site replacing <head>.
  await page.evaluate(() => document.head.replaceChildren());
  await waitFor(async () => (await filter(page)) === 'grayscale(1)');
  await page.close();
});

test('grayscale stays on while a full-block site is temporarily unlocked', async () => {
  const { settings } = await fg.storage(['settings']);
  const yt = settings.sites.find((s) => s.domain === 'youtube.com').id;
  await fg.send('updateSite', { id: yt, patch: { grayscale: true } });
  await fg.setState({ unlocks: { [yt]: Date.now() + 60_000 } });
  const { runtime } = await fg.storage(['runtime']);
  assert.equal(runtime.byDomain['youtube.com'].blocked, false);
  assert.equal(runtime.byDomain['youtube.com'].grayscale, true);
  await fg.setState({ unlocks: {} });
});

test('turning grayscale off in settings during a window needs an unlock', async () => {
  const res = await fg.send('updateSite', { id: redditId, patch: { grayscale: false } });
  assert.equal(res.code, 'LOCKED');
});

test('phrase page: paste and drop blocked, wrong phrase rejected, exact phrase (any case) turns it off until window end', async () => {
  const site = await fg.context.newPage();
  await site.goto('https://www.reddit.com/');
  await waitFor(async () => (await filter(site)) === 'grayscale(1)');

  const page = await fg.context.newPage();
  await page.goto(`${fg.base}/src/phrase/phrase.html?site=${redditId}`);
  await page.waitForFunction(() => document.querySelector('#phrase').textContent.length > 0);
  assert.equal(await page.textContent('#phrase'), DEFAULT_PHRASE);
  assert.equal(await page.getAttribute('#typed', 'autocomplete'), 'off');
  assert.equal(await page.getAttribute('#typed', 'spellcheck'), 'false');

  // Paste via a real clipboard event.
  await page.focus('#typed');
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.querySelector('#typed').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, DEFAULT_PHRASE);
  assert.equal(await page.inputValue('#typed'), '');
  assert.match(await page.textContent('#msg'), /Pasting and dropping are disabled/);
  // Bulk insert (what autocomplete/IME-less insertText of a whole string looks like).
  await page.keyboard.insertText(DEFAULT_PHRASE);
  assert.equal(await page.inputValue('#typed'), '');

  // Wrong phrase.
  await page.keyboard.type('I am the master of my own mind');
  await page.click('#submit');
  await page.waitForSelector('#msg.error');
  assert.match(await page.textContent('#msg'), /doesn't match/);
  assert.equal(await filter(site), 'grayscale(1)');

  // Correct phrase, different case, typed key by key.
  await page.fill('#typed', '');
  await page.focus('#typed');
  await page.keyboard.type(DEFAULT_PHRASE.toUpperCase(), { delay: 0 });
  assert.match(await page.textContent('#progress'), new RegExp(`^${DEFAULT_PHRASE.length} / ${DEFAULT_PHRASE.length}`));
  await page.click('#submit');
  await page.waitForSelector('#msg.ok');
  assert.match(await page.textContent('#msg'), /Grayscale is off until/);

  // Live update on the open site tab.
  await waitFor(async () => (await filter(site)) === 'none');

  const { state, runtime, stats } = await fg.storage(['state', 'runtime', 'stats']);
  const windowEnd = runtime.byDomain['reddit.com'].windowEnd;
  assert.equal(state.grayscaleOff[redditId], windowEnd, 'lasts until the current window ends');
  const today = Object.values(stats.days).at(-1);
  assert.equal(today.attempts.phrase, 2);
  assert.equal(today.successes.phrase, 1);

  // When that time passes it comes back (simulated by expiring the override).
  await fg.setState({ grayscaleOff: { [redditId]: Date.now() - 1 } });
  await waitFor(async () => (await filter(site)) === 'grayscale(1)');
  await page.close();
  await site.close();
});

test('editing the phrase in settings changes what must be typed', async () => {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  let res = await fg.send('saveSettings', { patch: { grayscalePhrase: 'Scrolling is not rest' } });
  assert.equal(res.error, undefined);
  res = await fg.send('saveSettings', { patch: { grayscalePhrase: '   ' } });
  assert.match(res.error, /cannot be empty/);
  await fg.setState({ settingsUnlockUntil: 0 });
  res = await fg.send('grayscaleOff', { siteId: redditId, typed: DEFAULT_PHRASE });
  assert.equal(res.ok, false);
  res = await fg.send('grayscaleOff', { siteId: redditId, typed: 'scrolling is NOT rest' });
  assert.equal(res.ok, true);
});
