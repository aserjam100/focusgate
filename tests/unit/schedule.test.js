import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeInterval, nextTransition, emptySchedule, weekdaySchedule, validateSchedule } from '../../src/lib/schedule.js';

// Local-time constructor helper. 2026-09-28 is a Monday.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('weekday 9-18 is active on Monday 10:00 and ends at 18:00', () => {
  const s = weekdaySchedule();
  const iv = activeInterval(s, at(2026, 9, 28, 10));
  assert.ok(iv);
  assert.equal(iv.end, at(2026, 9, 28, 18));
});

test('not active before start, after end, or on weekends', () => {
  const s = weekdaySchedule();
  assert.equal(activeInterval(s, at(2026, 9, 28, 8, 59)), null);
  assert.equal(activeInterval(s, at(2026, 9, 28, 18, 0)), null); // end is exclusive
  assert.equal(activeInterval(s, at(2026, 10, 3, 12)), null); // Saturday
});

test('next transition: Monday 08:00 -> 09:00; Monday 12:00 -> 18:00; Friday 19:00 -> next Monday 09:00', () => {
  const s = weekdaySchedule();
  assert.equal(nextTransition(s, at(2026, 9, 28, 8)), at(2026, 9, 28, 9));
  assert.equal(nextTransition(s, at(2026, 9, 28, 12)), at(2026, 9, 28, 18));
  assert.equal(nextTransition(s, at(2026, 10, 2, 19)), at(2026, 10, 5, 9));
});

test('window crossing midnight: Fri 22:00-02:00 is active Sat 01:00 (from the Friday entry)', () => {
  const s = emptySchedule();
  s.days[5] = [{ start: '22:00', end: '02:00' }];
  const iv = activeInterval(s, at(2026, 10, 3, 1)); // Saturday 01:00
  assert.ok(iv);
  assert.equal(iv.start, at(2026, 10, 2, 22));
  assert.equal(iv.end, at(2026, 10, 3, 2));
  assert.equal(activeInterval(s, at(2026, 10, 3, 2, 30)), null);
});

test('adjacent windows across midnight merge into one contiguous block', () => {
  const s = emptySchedule();
  s.days[1] = [{ start: '22:00', end: '24:00' }];
  s.days[2] = [{ start: '00:00', end: '06:00' }];
  const iv = activeInterval(s, at(2026, 9, 28, 23));
  assert.equal(iv.end, at(2026, 9, 29, 6));
  // No spurious transition at midnight.
  assert.equal(nextTransition(s, at(2026, 9, 28, 23)), at(2026, 9, 29, 6));
});

test('start == end means a full 24h window', () => {
  const s = emptySchedule();
  s.days[1] = [{ start: '00:00', end: '00:00' }];
  assert.ok(activeInterval(s, at(2026, 9, 28, 23, 59)));
  assert.equal(activeInterval(s, at(2026, 9, 29, 0, 1)), null);
});

test('always schedule is open-ended with no transitions', () => {
  const s = { ...emptySchedule(), always: true };
  assert.equal(activeInterval(s, Date.now()).end, Infinity);
  assert.equal(nextTransition(s, Date.now()), null);
});

test('every-day 00:00-24:00 chains are treated as open-ended', () => {
  const s = emptySchedule();
  for (let d = 0; d < 7; d++) s.days[d] = [{ start: '00:00', end: '24:00' }];
  assert.equal(activeInterval(s, at(2026, 9, 28, 12)).end, Infinity);
});

test('overlapping windows on the same day merge', () => {
  const s = emptySchedule();
  s.days[1] = [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }];
  assert.equal(activeInterval(s, at(2026, 9, 28, 10)).end, at(2026, 9, 28, 14));
});

test('validateSchedule flags bad times', () => {
  const s = emptySchedule();
  s.days[1] = [{ start: '25:00', end: '18:00' }];
  assert.equal(validateSchedule(s).length, 1);
  assert.deepEqual(validateSchedule(weekdaySchedule()), []);
});

test('DST: windows are wall-clock times in the current timezone', () => {
  // Uses whatever TZ the test runs in; run with TZ=America/New_York to exercise
  // the Nov 1 2026 fall-back day (25 hours long).
  const s = emptySchedule();
  s.days[0] = [{ start: '09:00', end: '18:00' }]; // Sunday
  const iv = activeInterval(s, at(2026, 11, 1, 12));
  assert.equal(new Date(iv.start).getHours(), 9);
  assert.equal(new Date(iv.end).getHours(), 18);
});
