import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, waitFor } from './harness.js';

let fg;
before(async () => {
  fg = await launch();
  await fg.send('saveGoals', { goals: 'Finish the parser rewrite' });
  await fg.send('saveSettings', {
    patch: {
      globalSchedule: scheduleCoveringNow(),
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
    static availability = window.__fakeAvailability || 'available';
    static available = async (opts) => {
      window.__availableCalls = (window.__availableCalls || []).concat([opts]);
      return FakeRecognition.availability;
    };
    static install = async () => {
      window.__installed = true;
      FakeRecognition.availability = 'available';
      return true;
    };
    // Real Chrome defines this as a prototype accessor.
    get processLocally() {
      return !!this._processLocally;
    }
    set processLocally(v) {
      this._processLocally = v;
    }
    start() {
      window.__startedWith = { processLocally: this.processLocally, lang: this.lang };
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
  await page.addInitScript(FAKE_SPEECH);
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
  const started = await page.evaluate(() => window.__startedWith);
  assert.equal(started.processLocally, true, 'recognition must run on-device');
  assert.ok(started.lang);
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

test('downloads the on-device speech model once when it is not installed yet', async () => {
  const page = await fg.context.newPage();
  await page.addInitScript(() => (window.__fakeAvailability = 'downloadable'));
  await page.addInitScript(FAKE_SPEECH);
  await page.goto(`${fg.base}/src/review/review.html`);
  await page.click('#start');
  await page.waitForSelector('#rec:not(.hidden)');
  assert.equal(await page.evaluate(() => window.__installed), true);
  const calls = await page.evaluate(() => window.__availableCalls);
  assert.equal(calls[0].processLocally, true);
  await page.close();
});

test('refuses to record (no cloud fallback) when on-device recognition is unavailable', async () => {
  for (const setup of [
    () => (window.__fakeAvailability = 'unavailable'),
    // Older Chrome: speech API exists but has no on-device support.
    () => {
      window.__noOnDevice = true;
    },
  ]) {
    const page = await fg.context.newPage();
    await page.addInitScript(setup);
    await page.addInitScript(FAKE_SPEECH);
    await page.addInitScript(() => {
      if (window.__noOnDevice) {
        class Old { start() { window.__startedWith = {}; } stop() {} }
        window.SpeechRecognition = window.webkitSpeechRecognition = Old;
      }
    });
    await page.goto(`${fg.base}/src/review/review.html`);
    await page.click('#start');
    await page.waitForSelector('#mic-msg.error');
    assert.match(await page.textContent('#mic-msg'), /can't transcribe|no on-device speech recognition/);
    assert.equal(await page.evaluate(() => window.__startedWith), undefined, 'recognition never started');
    assert.equal(await page.isVisible('#rec'), false);
    await page.close();
  }
});
