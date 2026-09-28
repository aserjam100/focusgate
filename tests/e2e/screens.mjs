// Dev helper: node tests/e2e/screens.mjs <outdir>
import { launch, scheduleCoveringNow } from './harness.js';
const out = process.argv[2] || '.';
const fg = await launch();
await fg.send('saveSettings', { patch: { globalSchedule: scheduleCoveringNow(), goals: 'Finish the parser rewrite.\nReview two PRs.' } });
await fg.setState({ settingsUnlockUntil: 0 });
const p = await fg.context.newPage();
await p.setViewportSize({ width: 360, height: 520 });
await p.goto(`${fg.base}/src/popup/popup.html`); await p.waitForSelector('#sites li');
await p.screenshot({ path: `${out}/popup.png` });
await p.setViewportSize({ width: 1000, height: 900 });
await p.goto('https://www.reddit.com/').catch(() => {}); await p.waitForURL(/block/); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/block.png`, fullPage: true });
await p.goto(`${fg.base}/src/options/options.html`); await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/options.png`, fullPage: true });
await fg.close();
