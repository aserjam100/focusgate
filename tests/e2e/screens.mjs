// Dev helper: node tests/e2e/screens.mjs <outdir>  (screenshots of every page)
import { launch, scheduleCoveringNow } from './harness.js';
import { dateKey } from '../../src/lib/time.js';
const out = process.argv[2] || '.';
const fg = await launch();
await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow(), goals: 'Finish the parser rewrite.\nReview two PRs.', review: { availableAfter: '00:00' } } });
const { settings } = await fg.storage(['settings']);
const reddit = settings.sites.find((s) => s.domain === 'reddit.com').id;
await fg.send('updateSite', { id: reddit, patch: { mode: 'none', grayscale: true } });
await fg.setState({ settingsUnlockUntil: 0 });
const day = (n) => dateKey(Date.now() - n * 86_400_000);
const days = {};
for (let i = 0; i < 30; i++) days[day(i)] = {
  time: { 'reddit.com': (i * 137) % 2400, 'youtube.com': (i * 311) % 3600, 'x.com': i % 3 ? 400 : 0 },
  attempts: { partner: i % 7 === 4 ? 2 : 0, review: i % 5 === 1 ? 1 : 0, phrase: i === 2 ? 3 : 0 },
  successes: { partner: i % 7 === 4 ? 1 : 0, review: i % 5 === 1 ? 1 : 0, phrase: i === 2 ? 1 : 0 },
  windowUnlocks: i % 7 === 4 ? 1 : 0 };
await fg.sw.evaluate((stats) => chrome.storage.local.set({ stats }), { installDate: day(29), days });
await fg.sw.evaluate((reviews) => chrome.storage.local.set({ reviews }), [{ ts: Date.now() - 86400000, date: day(1), transcript: 'Today I refactored the tokenizer and wrote tests for error recovery.', words: 160, speakingSeconds: 104, approved: true, reason: 'Concrete progress on the parser rewrite.', llmUsed: true }]);
const p = await fg.context.newPage();
await p.setViewportSize({ width: 1000, height: 900 });
for (const [name, path] of [['stats', 'src/stats/stats.html'], ['review', 'src/review/review.html'], ['phrase', `src/phrase/phrase.html?site=${reddit}`]]) {
  await p.goto(`${fg.base}/${path}`); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await p.emulateMedia({ colorScheme: 'dark' });
await p.goto(`${fg.base}/src/stats/stats.html`); await p.click('.seg button[data-days="30"]'); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/stats-dark-30.png`, fullPage: true });
await p.setViewportSize({ width: 380, height: 800 }); await p.emulateMedia({ colorScheme: 'light' });
await p.goto(`${fg.base}/src/stats/stats.html`); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/stats-mobile.png`, fullPage: true });
await fg.close();
