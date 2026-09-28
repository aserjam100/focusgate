// Local-only usage stats. Shape:
// { installDate: 'YYYY-MM-DD', days: { 'YYYY-MM-DD': {
//     time: { domain: seconds },
//     attempts: { partner, review, phrase },
//     successes: { partner, review, phrase },
//     windowUnlocks: n } } }

import { dateKey } from './time.js';

export const METHODS = ['partner', 'review', 'phrase'];

export function emptyDay() {
  return {
    time: {},
    attempts: { partner: 0, review: 0, phrase: 0 },
    successes: { partner: 0, review: 0, phrase: 0 },
    windowUnlocks: 0,
  };
}

export function ensureDay(stats, key) {
  stats.days ||= {};
  stats.days[key] ||= emptyDay();
  return stats.days[key];
}

export function addTime(stats, domain, seconds, now = Date.now()) {
  const day = ensureDay(stats, dateKey(now));
  day.time[domain] = (day.time[domain] || 0) + seconds;
}

export function recordAttempt(stats, method, { success, inWindow, countAttempt = true }, now = Date.now()) {
  const day = ensureDay(stats, dateKey(now));
  if (countAttempt) day.attempts[method] = (day.attempts[method] || 0) + 1;
  if (success) {
    day.successes[method] = (day.successes[method] || 0) + 1;
    if (inWindow) day.windowUnlocks += 1;
  }
}

/**
 * Current streak: consecutive clean days (no unlocks during block windows)
 * ending today. If today already has an unlock the streak is 0. Days with no
 * record count as clean; counting stops at the install date.
 */
export function computeStreaks(stats, now = Date.now()) {
  const install = stats.installDate || dateKey(now);
  const days = stats.days || {};
  const clean = (k) => !(days[k]?.windowUnlocks > 0);

  const keys = [];
  for (let d = new Date(now); ; d.setDate(d.getDate() - 1)) {
    const k = dateKey(d.getTime());
    keys.push(k);
    if (k <= install || keys.length > 3650) break;
  }
  // keys: today, yesterday, ... install

  let current = 0;
  for (const k of keys) {
    if (!clean(k)) break;
    current++;
  }
  let longest = 0;
  let run = 0;
  for (const k of keys.slice().reverse()) {
    run = clean(k) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}

/** Drop day records older than `keepDays`. */
export function pruneStats(stats, keepDays = 400, now = Date.now()) {
  const cutoff = dateKey(now - keepDays * 86_400_000);
  for (const k of Object.keys(stats.days || {})) if (k < cutoff) delete stats.days[k];
}
