import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, fakeEmailBackend } from './harness.js';

let fg, backend;
before(async () => {
  backend = await fakeEmailBackend();
  fg = await launch();
  await fg.send('saveSettings', {
    patch: {
      globalSchedule: scheduleCoveringNow(),
      partner: { name: 'Sam', email: 'sam@example.com', endpoint: backend.url, secret: 'shh', sender: 'apps-script' },
    },
  });
  await fg.setState({ settingsUnlockUntil: 0 });
});
after(async () => {
  await fg?.close();
  backend?.close();
});

test('block page: ask partner -> email carries code, site and reason -> entering the code unlocks the site', async () => {
  const page = await fg.context.newPage();
  await page.goto('https://www.reddit.com/r/rust').catch(() => {});
  await page.waitForURL(/block\.html/);
  await page.waitForSelector('#partner-request:not(.hidden)');
  assert.match(await page.textContent('#partner-left'), /3 of 3 left/);

  await page.fill('#partner-reason', 'short');
  await page.click('#partner-send');
  await page.waitForSelector('#partner-msg.error');
  assert.match(await page.textContent('#partner-msg'), /at least 10 characters/);
  assert.equal(backend.received.length, 0);

  await page.fill('#partner-reason', 'Need to read the async book thread for work');
  await page.click('#partner-send');
  await page.waitForSelector('#partner-verify:not(.hidden)');
  assert.equal(backend.received.length, 1);
  const mail = backend.received[0];
  assert.equal(mail.secret, 'shh');
  assert.equal(mail.to, 'sam@example.com');
  assert.equal(mail.site, 'reddit.com');
  assert.equal(mail.reason, 'Need to read the async book thread for work');
  assert.match(mail.code, /^\d{6}$/);

  // Plaintext code is nowhere in storage; only a salted hash + expiry.
  const all = await fg.storage(null);
  assert.ok(!JSON.stringify(all).includes(mail.code));
  const pending = all.state.partnerPending;
  assert.equal(pending.hash.length, 64);
  const ttl = pending.expiresAt - Date.now();
  assert.ok(ttl > 29 * 60_000 && ttl <= 30 * 60_000);

  // Wrong code.
  const wrong = mail.code === '000000' ? '111111' : '000000';
  await page.fill('#partner-code', wrong);
  await page.click('#partner-check');
  await page.waitForSelector('#partner-msg.error');
  assert.match(await page.textContent('#partner-msg'), /Wrong code \(4 tries left\)/);

  // Right code -> unlocked -> navigates back to the original URL.
  await fg.context.route('https://www.reddit.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>rust</h1>' }));
  await page.fill('#partner-code', mail.code);
  await page.click('#partner-check');
  await page.waitForURL('https://www.reddit.com/r/rust');
  assert.equal(await page.textContent('h1'), 'rust');
  const { state, stats } = await fg.storage(['state', 'stats']);
  const id = Object.keys(state.unlocks)[0];
  const left = state.unlocks[id] - Date.now();
  assert.ok(left > 14 * 60_000 && left <= 15 * 60_000, 'unlocked for 15 minutes');
  assert.equal(state.partnerPending, null);
  const today = Object.values(stats.days).at(-1);
  assert.equal(today.attempts.partner, 1);
  assert.equal(today.successes.partner, 1);
  assert.equal(today.windowUnlocks, 1);
  await page.close();
  await fg.context.unroute('https://www.reddit.com/**');
});

test('partner code for "settings" unlocks settings changes but not sites', async () => {
  let res = await fg.send('setEnabled', { enabled: false });
  assert.equal(res.code, 'LOCKED');
  res = await fg.send('partnerRequest', { target: 'settings', reason: 'Need to fix my schedule for travel' });
  assert.equal(res.error, undefined);
  const code = backend.received.at(-1).code;
  assert.match(backend.received.at(-1).site, /settings/);
  res = await fg.send('partnerVerify', { code });
  assert.equal(res.ok, true);
  res = await fg.send('saveSettings', { patch: { unlockMinutes: 20 } });
  assert.equal(res.error, undefined);
  assert.ok((await fg.rules()).length >= 5, 'sites still blocked');
  await fg.setState({ settingsUnlockUntil: 0 });
});

test('max 3 requests per day, then refused without emailing', async () => {
  let res = await fg.send('partnerRequest', { target: 'youtube.com', reason: 'Conference talk I must watch' });
  assert.equal(res.error, undefined);
  assert.equal(res.requestsLeft, 0);
  res = await fg.send('partnerRequest', { target: 'youtube.com', reason: 'Conference talk I must watch' });
  assert.equal(res.code, 'RATE_LIMIT');
  assert.equal(backend.received.length, 3);
});

test('expired codes are rejected', async () => {
  const { state } = await fg.storage(['state']);
  assert.ok(state.partnerPending);
  await fg.setState({ partnerPending: { ...state.partnerPending, expiresAt: Date.now() - 1 } });
  const res = await fg.send('partnerVerify', { code: backend.received.at(-1).code });
  assert.match(res.error, /No active code/);
});

test('five wrong guesses invalidate the code', async () => {
  await fg.setState({ partnerRequests: { date: '', count: 0 } });
  await fg.send('partnerRequest', { target: 'x.com', reason: 'Need to reply to a customer thread' });
  const code = backend.received.at(-1).code;
  const wrong = code === '123456' ? '654321' : '123456';
  let res;
  for (let i = 0; i < 5; i++) res = await fg.send('partnerVerify', { code: wrong });
  assert.match(res.message, /Too many wrong codes/);
  res = await fg.send('partnerVerify', { code });
  assert.match(res.error, /No active code/);
});

test('backend errors surface to the user and do not use up a request', async () => {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  await fg.send('saveSettings', { patch: { partner: { endpoint: 'http://127.0.0.1:9/nothing' } } });
  await fg.setState({ settingsUnlockUntil: 0 });
  const before = (await fg.storage(['state'])).state.partnerRequests.count;
  const res = await fg.send('partnerRequest', { target: 'x.com', reason: 'Need to reply to a customer thread' });
  assert.ok(res.error);
  assert.equal((await fg.storage(['state'])).state.partnerRequests.count, before);
});
