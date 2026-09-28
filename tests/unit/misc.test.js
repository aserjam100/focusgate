import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomCode, hashCode, verifyCode } from '../../src/lib/crypto.js';
import { countWords, phraseMatches } from '../../src/lib/text.js';
import { computeStreaks, recordAttempt, addTime } from '../../src/lib/stats.js';
import { dateKey, nextMidnight } from '../../src/lib/time.js';
import { sendPartnerEmail } from '../../src/lib/email.js';
import { DEFAULT_PHRASE } from '../../src/lib/defaults.js';

test('random codes are 6 digits', () => {
  for (let i = 0; i < 200; i++) assert.match(randomCode(), /^\d{6}$/);
});

test('code hash verifies the right code only and never stores plaintext', async () => {
  const h = await hashCode('123456');
  assert.ok(!JSON.stringify(h).includes('123456'));
  assert.equal(h.hash.length, 64);
  assert.equal(await verifyCode('123456', h), true);
  assert.equal(await verifyCode(' 123456 ', h), true);
  assert.equal(await verifyCode('123457', h), false);
});

test('word counting', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords("I didn't   finish the PR, but I reviewed 3 docs."), 10);
});

test('phrase: exact but case-insensitive', () => {
  assert.ok(phraseMatches(DEFAULT_PHRASE.toUpperCase(), DEFAULT_PHRASE));
  assert.ok(phraseMatches('  ' + DEFAULT_PHRASE + ' ', DEFAULT_PHRASE));
  assert.ok(!phraseMatches(DEFAULT_PHRASE.replace(',', ''), DEFAULT_PHRASE));
  assert.ok(!phraseMatches(DEFAULT_PHRASE + '.', DEFAULT_PHRASE));
});

test('nextMidnight is local midnight', () => {
  const t = new Date(2026, 8, 28, 17, 30).getTime();
  assert.equal(nextMidnight(t), new Date(2026, 8, 29).getTime());
});

test('streaks: clean days count, an unlock in a window breaks the streak', () => {
  const now = new Date(2026, 8, 28, 12).getTime();
  const day = (n) => now - n * 86_400_000;
  const stats = { installDate: dateKey(day(9)), days: {} };
  assert.deepEqual(computeStreaks(stats, now), { current: 10, longest: 10 });
  recordAttempt(stats, 'partner', { success: true, inWindow: true }, day(4));
  assert.deepEqual(computeStreaks(stats, now), { current: 4, longest: 5 });
  recordAttempt(stats, 'review', { success: true, inWindow: false }, day(1)); // outside window: still clean
  assert.equal(computeStreaks(stats, now).current, 4);
  recordAttempt(stats, 'phrase', { success: false, inWindow: true }, now); // failed attempt: still clean
  assert.equal(computeStreaks(stats, now).current, 4);
  recordAttempt(stats, 'phrase', { success: true, inWindow: true }, now);
  assert.equal(computeStreaks(stats, now).current, 0);
  addTime(stats, 'reddit.com', 15, now);
  assert.equal(stats.days[dateKey(now)].time['reddit.com'], 15);
  assert.equal(stats.days[dateKey(now)].attempts.phrase, 2);
});

test('email sender posts JSON with the secret and surfaces backend errors', async () => {
  let seen;
  const ok = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), ct: init.headers['Content-Type'] };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const partner = { sender: 'apps-script', endpoint: 'https://script.google.com/x/exec', secret: 's3' };
  await sendPartnerEmail(partner, { to: 'p@x.com', code: '123456' }, ok);
  assert.equal(seen.body.secret, 's3');
  assert.equal(seen.body.code, '123456');
  assert.match(seen.ct, /^text\/plain/);
  const bad = async () => ({ ok: true, status: 200, text: async () => '{"ok":false,"error":"rate_limited"}' });
  await assert.rejects(sendPartnerEmail(partner, {}, bad), /rate_limited/);
  const html = async () => ({ ok: true, status: 200, text: async () => '<html>login</html>' });
  await assert.rejects(sendPartnerEmail(partner, {}, html), /non-JSON/);
});
