// Schedule model:
//   { always: boolean, days: [[{start:'HH:MM', end:'HH:MM'}], ...] }  // index 0 = Sunday
// A window whose end is <= its start crosses midnight into the next day
// (e.g. Fri 22:00-02:00 blocks until Sat 02:00). start == end means 24 hours.
// "24:00" is accepted as an end time.

import { parseHM, DAY } from './time.js';

const LOOKBACK_DAYS = 2;
const LOOKAHEAD_DAYS = 8;

export function emptySchedule() {
  return { always: false, days: [[], [], [], [], [], [], []] };
}

export function weekdaySchedule(start = '09:00', end = '18:00') {
  const s = emptySchedule();
  for (let d = 1; d <= 5; d++) s.days[d] = [{ start, end }];
  return s;
}

export function validateSchedule(schedule) {
  const errors = [];
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length !== 7) {
    return ['Schedule must have 7 days'];
  }
  schedule.days.forEach((wins, d) => {
    (wins || []).forEach((w, i) => {
      if (parseHM(w.start) == null || parseHM(w.start) >= 1440) errors.push(`Day ${d} window ${i + 1}: bad start "${w.start}"`);
      if (parseHM(w.end) == null) errors.push(`Day ${d} window ${i + 1}: bad end "${w.end}"`);
    });
  });
  return errors;
}

/** Concrete [start, end) intervals (ms) for windows *starting* on the given local day. */
function intervalsStartingOn(schedule, y, m, d) {
  const weekday = new Date(y, m, d).getDay();
  const out = [];
  for (const w of schedule.days[weekday] || []) {
    const s = parseHM(w.start);
    const e = parseHM(w.end);
    if (s == null || e == null || s >= 1440) continue;
    const start = new Date(y, m, d, 0, s).getTime();
    // Constructing with day+1 keeps this correct across DST shifts.
    const end = e > s ? new Date(y, m, d, 0, e).getTime() : new Date(y, m, d + 1, 0, e).getTime();
    if (end > start) out.push([start, end]);
  }
  return out;
}

/** Merged, sorted intervals covering roughly [now - 2d, now + 8d]. */
export function intervalsAround(schedule, now) {
  const base = new Date(now);
  const raw = [];
  for (let off = -LOOKBACK_DAYS; off <= LOOKAHEAD_DAYS; off++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);
    raw.push(...intervalsStartingOn(schedule, day.getFullYear(), day.getMonth(), day.getDate()));
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  return merged;
}

/**
 * The contiguous block interval containing `now`, or null.
 * Adjacent windows (Mon 22:00-24:00 + Tue 00:00-06:00) are merged so the end
 * time reflects when blocking actually stops.
 */
export function activeInterval(schedule, now) {
  if (!schedule) return null;
  if (schedule.always) return { start: -Infinity, end: Infinity };
  for (const [s, e] of intervalsAround(schedule, now)) {
    if (s <= now && now < e) {
      // A chain that reaches the lookahead horizon is effectively open-ended.
      return { start: s, end: e >= now + (LOOKAHEAD_DAYS - 1) * DAY ? Infinity : e };
    }
  }
  return null;
}

export function isActive(schedule, now) {
  return activeInterval(schedule, now) != null;
}

/** Next timestamp > now at which this schedule turns on or off, or null. */
export function nextTransition(schedule, now) {
  if (!schedule || schedule.always) return null;
  let best = null;
  for (const [s, e] of intervalsAround(schedule, now)) {
    for (const t of [s, e]) {
      if (t > now && (best == null || t < best)) best = t;
    }
  }
  return best;
}
