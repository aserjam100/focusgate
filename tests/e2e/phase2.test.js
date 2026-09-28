import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, waitFor } from './harness.js';

let fg;
before(async () => {
  fg = await launch();
  await fg.send('saveSettings', {
    patch: {
      globalSchedule: scheduleCoveringNow(),
      goals: 'Finish the parser rewrite',
      review: { minSeconds: 2, minWords: 12, availableAfter: '00:00' },
    },
  });
  await fg.setState({ settingsUnlockUntil: 0 });
});
after(async () => fg && (await fg.close()));

// Fake Web Speech API: emits interim then final results while "listening".
const FAKE_SPEECH = () => {
  const words = 'today I refactored the tokenizer wrote tests for the parser and reviewed two pull requests with my team'.split(' ');
  class FakeRecognition {
    start() {
      if (this._t) throw new Error('already started');
      let i = 0;
      this._t = setInterval(() => {
        if (i >= words.length) return;
        const chunk = words.slice(i, i + 3).join(' ');
        i += 3;
        const interim = [{ 0: { transcript: chunk }, isFinal: false, length: 1 }];
        this.onresult?.({ resultIndex: 0, results: interim });
        const fin = [{ 0: { transcript: chunk }, isFinal: true, length: 1 }];
        this.onresult?.({ resultIndex: 0, results: fin });
      }, 250);
    }
    stop() {
      clearInterval(this._t);
      this._t = null;
      setTimeout(() => this.onend?.(), 0);
    }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeRecognition;
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [] });
};

test('review is refused before the configured time of day', async () => {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  await fg.send('saveSettings', { patch: { review: { availableAfter: '23:59' } } });
  const res = await fg.send('reviewSubmit', { transcript: 'x', speakingSeconds: 999 });
  assert.equal(res.code, 'TOO_EARLY');
  const page = await fg.context.newPage();
  await page.goto(`${fg.base}/src/review/review.html`);
  await page.waitForSelector('#avail.msg.error');
  assert.match(await page.textContent('#avail'), /opens at 23:59/);
  assert.equal(await page.isDisabled('#start'), true);
  await page.close();
  await fg.send('saveSettings', { patch: { review: { availableAfter: '00:00' } } });
  await fg.setState({ settingsUnlockUntil: 0 });
});

test('microphone denial shows guidance instead of failing silently', async () => {
  const page = await fg.context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };
  });
  await page.goto(`${fg.base}/src/review/review.html`);
  await page.click('#start');
  await page.waitForSelector('#mic-msg.error');
  assert.match(await page.textContent('#mic-msg'), /Microphone access was denied/);
  await page.close();
});

test('short review is rejected server-side even if the page is bypassed', async () => {
  const res = await fg.send('reviewSubmit', { transcript: 'did stuff', speakingSeconds: 1 });
  assert.equal(res.approved, false);
  assert.match(res.reason, /spoke for 1s, need 2s; 2 words, need 12/);
  assert.equal((await fg.rules()).length, 6);
});

test('speaking a long enough review shows live text, then unlocks everything until midnight', async () => {
  const page = await fg.context.newPage();
  await page.addInitScript(FAKE_SPEECH);
  await page.goto(`${fg.base}/src/review/review.html?return=${encodeURIComponent('https://www.reddit.com/')}`);
  assert.equal(await page.isDisabled('#submit'), true);
  await page.click('#start');
  await page.waitForSelector('#rec:not(.hidden)');
  await waitFor(async () => Number(await page.textContent('#words')) >= 12);
  await waitFor(async () => parseInt(await page.textContent('#secs')) >= 2);
  assert.match(await page.textContent('#final'), /refactored the tokenizer/);
  await page.click('#stop');
  await waitFor(async () => !(await page.isDisabled('#submit')));
  await page.click('#submit');
  await page.waitForSelector('#result.ok');
  assert.match(await page.textContent('#result'), /Approved/);
  assert.equal((await fg.rules()).length, 0);
  const { state } = await fg.storage(['state']);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  assert.equal(state.dayUnlockUntil, midnight.getTime());
  assert.equal(await fg.sw.evaluate(() => chrome.action.getBadgeText({})), 'day');
  // History saved, with a date.
  await page.waitForSelector('details.entry');
  const { reviews } = await fg.storage(['reviews']);
  assert.equal(reviews.at(-1).approved, true);
  assert.match(reviews.at(-1).date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await page.locator('details.entry').count(), 2);
  await page.close();
  await fg.setState({ dayUnlockUntil: 0 });
});

test('with an API key, Claude verdict decides and its reason is shown', async () => {
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  await fg.send('saveSettings', { patch: { review: { apiKey: 'sk-ant-test' } } });
  await fg.setState({ settingsUnlockUntil: 0 });
  // Stub fetch inside the service worker to capture the request.
  await fg.sw.evaluate(() => {
    globalThis.__calls = [];
    globalThis.fetch = async (url, init) => {
      globalThis.__calls.push({ url, init });
      const verdict = JSON.parse(init.body).messages[0].content.includes('cat videos')
        ? { approved: false, reason: 'This describes watching videos, not work on the parser.' }
        : { approved: true, reason: 'Concrete parser progress.' };
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(verdict) }] }), { status: 200 });
    };
  });
  const words = Array(20).fill('watched cat videos all day').join(' ');
  let res = await fg.send('reviewSubmit', { transcript: words, speakingSeconds: 5 });
  assert.equal(res.approved, false);
  assert.equal(res.llmUsed, true);
  assert.match(res.reason, /watching videos/);
  assert.equal((await fg.rules()).length, 6);

  const calls = await fg.sw.evaluate(() => globalThis.__calls.map((c) => ({ url: c.url, headers: c.init.headers, body: JSON.parse(c.init.body) })));
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], 'sk-ant-test');
  assert.match(calls[0].body.messages[0].content, /<goals>\nFinish the parser rewrite/);
  assert.equal(calls[0].body.output_config.format.type, 'json_schema');

  res = await fg.send('reviewSubmit', { transcript: Array(20).fill('rewrote parser error recovery').join(' '), speakingSeconds: 5 });
  assert.equal(res.approved, true);
  assert.equal(res.reason, 'Concrete parser progress.');
  assert.equal((await fg.rules()).length, 0);
  await fg.setState({ dayUnlockUntil: 0 });
});

test('API failure does not grant the unlock', async () => {
  await fg.sw.evaluate(() => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 });
  });
  const res = await fg.send('reviewSubmit', { transcript: Array(20).fill('rewrote parser error recovery').join(' '), speakingSeconds: 5 });
  assert.equal(res.approved, false);
  assert.match(res.reason, /Couldn't reach Claude.*overloaded/);
  const { reviews } = await fg.storage(['reviews']);
  assert.equal(reviews.length, 5, 'every submission is logged');
});
