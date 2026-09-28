import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, canModifySite, canModifyGlobal } from '../../src/lib/status.js';
import { defaultSettings, defaultState, migrateSettings } from '../../src/lib/defaults.js';
import { buildRules } from '../../src/lib/rules.js';
import { normalizeDomain, hostMatches, findDomainForHost } from '../../src/lib/domains.js';

const MON_10 = new Date(2026, 8, 28, 10).getTime();
const MON_20 = new Date(2026, 8, 28, 20).getTime();

function setup() {
  const settings = defaultSettings();
  const state = defaultState();
  const reddit = settings.sites.find((s) => s.domain === 'reddit.com');
  return { settings, state, reddit };
}

test('default sites are blocked inside the weekday window and free outside', () => {
  const { settings, state, reddit } = setup();
  assert.equal(computeStatus(settings, state, MON_10).sites[reddit.id].blocked, true);
  assert.equal(computeStatus(settings, state, MON_20).sites[reddit.id].blocked, false);
});

test('gating: loosening is locked inside a window, free outside', () => {
  const { settings, state, reddit } = setup();
  const inside = computeStatus(settings, state, MON_10);
  assert.equal(canModifySite(inside, reddit.id), false);
  assert.equal(canModifyGlobal(inside), false);
  const outside = computeStatus(settings, state, MON_20);
  assert.equal(canModifySite(outside, reddit.id), true);
  assert.equal(canModifyGlobal(outside), true);
});

test('a temporary site unlock unblocks that site but does not unlock settings', () => {
  const { settings, state, reddit } = setup();
  state.unlocks[reddit.id] = MON_10 + 15 * 60_000;
  const st = computeStatus(settings, state, MON_10);
  assert.equal(st.sites[reddit.id].blocked, false);
  assert.equal(st.sites[reddit.id].unlockKind, 'temp');
  assert.equal(canModifySite(st, reddit.id), false, 'unlocking then deleting would be a permanent bypass');
  assert.equal(st.nextTransition, MON_10 + 15 * 60_000);
});

test('expired unlock relocks', () => {
  const { settings, state, reddit } = setup();
  state.unlocks[reddit.id] = MON_10 - 1;
  assert.equal(computeStatus(settings, state, MON_10).sites[reddit.id].blocked, true);
});

test('settings unlock and day unlock allow loosening', () => {
  const { settings, state, reddit } = setup();
  state.settingsUnlockUntil = MON_10 + 60_000;
  let st = computeStatus(settings, state, MON_10);
  assert.equal(canModifyGlobal(st), true);
  assert.equal(canModifySite(st, reddit.id), true);
  assert.equal(st.sites[reddit.id].blocked, true, 'settings unlock does not unblock sites');

  const s2 = defaultState();
  s2.dayUnlockUntil = MON_10 + 60_000;
  st = computeStatus(settings, s2, MON_10);
  assert.equal(st.sites[reddit.id].blocked, false);
  assert.equal(canModifyGlobal(st), true);
});

test('paused extension blocks nothing', () => {
  const { settings, state, reddit } = setup();
  settings.enabled = false;
  const st = computeStatus(settings, state, MON_10);
  assert.equal(st.sites[reddit.id].blocked, false);
  assert.equal(st.settingsLocked, false);
});

test('per-site custom schedule overrides global', () => {
  const { settings, state, reddit } = setup();
  reddit.scheduleMode = 'custom';
  reddit.schedule.days[1] = [{ start: '19:00', end: '21:00' }];
  assert.equal(computeStatus(settings, state, MON_10).sites[reddit.id].blocked, false);
  assert.equal(computeStatus(settings, state, MON_20).sites[reddit.id].blocked, true);
});

test('no-block mode with grayscale', () => {
  const { settings, state, reddit } = setup();
  reddit.mode = 'none';
  reddit.grayscale = true;
  let st = computeStatus(settings, state, MON_10).sites[reddit.id];
  assert.equal(st.blocked, false);
  assert.equal(st.grayscale, true);
  // Grayscale persists through an unlock; only the phrase turns it off.
  state.unlocks[reddit.id] = MON_10 + 60_000;
  st = computeStatus(settings, state, MON_10).sites[reddit.id];
  assert.equal(st.grayscale, true);
  state.grayscaleOff[reddit.id] = MON_10 + 60_000;
  assert.equal(computeStatus(settings, state, MON_10).sites[reddit.id].grayscale, false);
});

test('DNR rules: one redirect rule per fully blocked domain, matching subdomains', () => {
  const { settings, state } = setup();
  const rules = buildRules(computeStatus(settings, state, MON_10), 'chrome-extension://abc');
  assert.equal(rules.length, 6);
  const r = rules.find((x) => x.condition.requestDomains[0] === 'reddit.com');
  assert.equal(r.action.type, 'redirect');
  assert.match(r.action.redirect.regexSubstitution, /^chrome-extension:\/\/abc\/src\/block\/block\.html\?site=reddit\.com&url=\\0$/);
  assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(new Set(rules.map((x) => x.id)).size, 6);
  assert.equal(buildRules(computeStatus(settings, state, MON_20), 'x').length, 0);
});

test('domain normalisation and matching', () => {
  assert.equal(normalizeDomain('https://www.Reddit.com/r/foo'), 'reddit.com');
  assert.equal(normalizeDomain('old.reddit.com'), 'old.reddit.com');
  assert.equal(normalizeDomain('not a domain'), null);
  assert.equal(normalizeDomain('localhost'), null);
  assert.ok(hostMatches('old.reddit.com', 'reddit.com'));
  assert.ok(hostMatches('m.youtube.com', 'youtube.com'));
  assert.ok(!hostMatches('notreddit.com', 'reddit.com'));
  assert.equal(findDomainForHost('www.x.com', ['x.com', 'twitter.com']), 'x.com');
});

test('migrateSettings fills in keys added in later versions', () => {
  const old = { enabled: true, sites: [{ id: 'a', domain: 'a.com', enabled: true }], globalSchedule: defaultSettings().globalSchedule };
  const s = migrateSettings(old);
  assert.equal(s.sites[0].mode, 'full');
  assert.equal(s.review.minWords, 150);
  assert.equal(s.partner.maxPerDay, 3);
  assert.equal(s.sites[0].id, 'a');
});
