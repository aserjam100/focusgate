import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, scheduleCoveringNow, waitForUrl } from './harness.js';

let fg;
before(async () => {
  fg = await launch();
  await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow() } });
  await fg.setState({ settingsUnlockUntil: 0 }); // end setup grace: now locked
});
after(async () => fg && (await fg.close()));

test('the goal can be changed during a block window, when other settings are locked', async () => {
  assert.equal((await fg.send('saveSettings', { patch: { unlockMinutes: 30 } })).code, 'LOCKED');
  const res = await fg.send('saveGoals', { goals: '  Ship v2 this week  ' });
  assert.equal(res.error, undefined);
  assert.equal((await fg.storage(['settings'])).settings.goals, 'Ship v2 this week');
});

test('the goal can never be empty', async () => {
  for (const goals of ['', '   \n  ', undefined]) {
    const res = await fg.send('saveGoals', { goals });
    assert.equal(res.code, 'NO_GOAL');
  }
  assert.equal((await fg.storage(['settings'])).settings.goals, 'Ship v2 this week');
});

test('other settings cannot be saved until a goal is set', async () => {
  await fg.sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, goals: '' } });
  });
  await fg.setState({ settingsUnlockUntil: Date.now() + 60_000 });
  let res = await fg.send('saveSettings', { patch: { unlockMinutes: 30 } });
  assert.equal(res.code, 'NO_GOAL');
  assert.match(res.error, /today, or a goal for all time/);
  await fg.send('saveGoals', { goals: 'Build things, do not scroll' });
  res = await fg.send('saveSettings', { patch: { unlockMinutes: 30 } });
  assert.equal(res.error, undefined);
  await fg.setState({ settingsUnlockUntil: 0 });
});

test('settings page: goal box works while locked, flags a missing goal, and the block page links to it', async () => {
  const page = await fg.context.newPage();
  await page.goto(`${fg.base}/src/options/options.html#goals`);
  await page.waitForSelector('#lock-banner:not(.hidden)');
  assert.equal(await page.isDisabled('#save'), true, 'main settings locked');
  assert.equal(await page.inputValue('#goals-input'), 'Build things, do not scroll');
  assert.match(await page.textContent('#goals-form'), /for all time/);

  await page.fill('#goals-input', '');
  await page.click('#goals-form button[type=submit]');
  await page.waitForSelector('#goals-msg.error-text');
  assert.match(await page.textContent('#goals-msg'), /Add a goal first/);

  await page.fill('#goals-input', 'Finish chapter 3');
  await page.click('#goals-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#goals-msg').textContent.startsWith('Saved'));
  await page.waitForTimeout(500); // the storage-change refresh must not wipe the confirmation
  assert.match(await page.textContent('#goals-msg'), /^Saved at/);
  assert.equal(await page.evaluate(() => document.querySelector('#goals-form').classList.contains('needs-goal')), false);

  await page.goto('https://www.reddit.com/').catch(() => {});
  await waitForUrl(page, /block\.html/);
  await page.waitForSelector('#goals');
  assert.equal(await page.textContent('#goals'), 'Finish chapter 3');
  await page.click('#edit-goals');
  await waitForUrl(page, /options\.html#goals$/);
  await page.close();
});
