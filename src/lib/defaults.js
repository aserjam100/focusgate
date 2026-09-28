import { weekdaySchedule, emptySchedule } from './schedule.js';

export const SETTINGS_VERSION = 1;

export const DEFAULT_PHRASE = 'I am not the master of my own mind, my mind controls me and I am weak';
export const DEFAULT_MODEL = 'claude-opus-5';

const DEFAULT_DOMAINS = ['instagram.com', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com', 'reddit.com'];

export function makeSite(domain, overrides = {}) {
  return {
    id: 's_' + Math.random().toString(36).slice(2, 10),
    domain,
    enabled: true,
    mode: 'full', // 'full' | 'none' (none = grayscale/tracking only)
    grayscale: false,
    scheduleMode: 'global', // 'global' | 'custom'
    schedule: emptySchedule(),
    ...overrides,
  };
}

export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    enabled: true,
    sites: DEFAULT_DOMAINS.map((d) => makeSite(d)),
    globalSchedule: weekdaySchedule('09:00', '18:00'),
    goals: '',
    unlockMinutes: 15,
    review: {
      minSeconds: 90,
      minWords: 150,
      availableAfter: '17:00',
      apiKey: '',
      model: DEFAULT_MODEL,
    },
    partner: {
      name: '',
      email: '',
      endpoint: '',
      secret: '',
      sender: 'apps-script',
      codeExpiryMinutes: 30,
      maxPerDay: 3,
    },
    grayscalePhrase: DEFAULT_PHRASE,
  };
}

export function defaultState() {
  return {
    unlocks: {}, // siteId -> until (ms)
    dayUnlockUntil: 0,
    settingsUnlockUntil: 0,
    grayscaleOff: {}, // siteId -> until (ms)
    partnerPending: null, // { salt, hash, iterations, expiresAt, target, attempts }
    partnerRequests: { date: '', count: 0 },
  };
}

/** Fill in any missing keys (settings written by older versions). */
export function migrateSettings(stored) {
  const def = defaultSettings();
  if (!stored) return def;
  const s = { ...def, ...stored };
  s.review = { ...def.review, ...(stored.review || {}) };
  s.partner = { ...def.partner, ...(stored.partner || {}) };
  s.sites = (stored.sites || def.sites).map((site) => {
    const merged = { ...makeSite(site.domain), ...site };
    if (!['full', 'none'].includes(merged.mode)) merged.mode = 'full';
    return merged;
  });
  s.version = SETTINGS_VERSION;
  return s;
}

export function migrateState(stored) {
  const def = defaultState();
  return { ...def, ...(stored || {}) };
}
