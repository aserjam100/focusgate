// FocusGate service worker. Single writer for settings/state; recomputes the
// blocking status on every wake-up, alarm, and settings change.

import { loadAll } from '../lib/store.js';
import { makeSite } from '../lib/defaults.js';
import { computeStatus, canModifySite, canModifyGlobal } from '../lib/status.js';
import { buildRules, BLOCK_PAGE_PATH } from '../lib/rules.js';
import { normalizeDomain, findDomainForHost, matchPatterns } from '../lib/domains.js';
import { validateSchedule } from '../lib/schedule.js';
import { dateKey, nextMidnight, parseHM, minutesSinceMidnight, MINUTE } from '../lib/time.js';
import { randomCode, hashCode, verifyCode } from '../lib/crypto.js';
import { sendPartnerEmail } from '../lib/email.js';
import { judgeReview } from '../lib/llm.js';
import { countWords, phraseMatches } from '../lib/text.js';
import { addTime, recordAttempt, pruneStats } from '../lib/stats.js';

const ALARM_TRANSITION = 'fg-transition';
const ALARM_TICK = 'fg-tick';
const CONTENT_SCRIPT_ID = 'fg-sites';
const CONTENT_FILES = ['src/content/core.js'];
const MAX_CODE_ATTEMPTS = 5;
const SETUP_GRACE_MINUTES = 30;
const EXT_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Serialisation: every read-modify-write goes through this queue so alarms,
// messages and heartbeats can't interleave and lose updates.
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

class GateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const LOCKED_MSG =
  'Locked: a block window is active. Unlock settings first (partner code, or the evening day review).';

// ---------------------------------------------------------------------------
// Recompute

let lastRulesKey = null;
let lastContentKey = null;

async function recompute(reason = '') {
  const { settings, state, runtime: prevRuntime } = await loadAll();
  const prevState = JSON.stringify(state);
  const now = Date.now();
  pruneState(state, now);
  const status = computeStatus(settings, state, now);

  await applyRules(status);
  await syncContentScripts(settings);

  const byDomain = {};
  for (const s of Object.values(status.sites)) {
    byDomain[s.domain] = {
      siteId: s.id,
      blocked: s.blocked,
      grayscale: s.grayscale,
      inWindow: s.inWindow,
      windowEnd: s.windowEnd,
    };
  }
  const runtime = { status, byDomain };
  // Only write when something changed: pages and content scripts listen for
  // storage changes, and a no-op write would make them refresh in a loop.
  const writes = {};
  if (JSON.stringify(state) !== prevState) writes.state = state;
  if (JSON.stringify(runtime) !== JSON.stringify(prevRuntime)) writes.runtime = runtime;
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);

  await scheduleAlarms(status);
  await updateBadge(status, now);
  await redirectOpenTabs(status);
  return status;
}

function pruneState(state, now) {
  for (const [id, until] of Object.entries(state.unlocks)) if (!(until > now)) delete state.unlocks[id];
  for (const [id, until] of Object.entries(state.grayscaleOff)) if (!(until > now)) delete state.grayscaleOff[id];
  if (state.partnerPending && !(state.partnerPending.expiresAt > now)) state.partnerPending = null;
  if (!(state.dayUnlockUntil > now)) state.dayUnlockUntil = 0;
  if (!(state.settingsUnlockUntil > now)) state.settingsUnlockUntil = 0;
}

async function applyRules(status) {
  const rules = buildRules(status, EXT_ORIGIN);
  const key = JSON.stringify(rules);
  if (key === lastRulesKey) return;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
  lastRulesKey = key;
}

async function syncContentScripts(settings) {
  const domains = [...new Set(settings.sites.map((s) => s.domain))].sort();
  const matches = domains.flatMap(matchPatterns);
  const key = JSON.stringify(matches);
  if (key === lastContentKey) return;
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  const current = registered[0];
  const same =
    current &&
    JSON.stringify([...(current.matches || [])].sort()) === JSON.stringify([...matches].sort()) &&
    JSON.stringify(current.js) === JSON.stringify(CONTENT_FILES);
  if (!same) {
    if (current) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if (matches.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches,
          js: CONTENT_FILES,
          runAt: 'document_start',
          persistAcrossSessions: true,
        },
      ]);
    }
  }
  lastContentKey = key;
}

/** Content scripts aren't injected into tabs that were open before install/update. */
async function injectIntoOpenTabs(settings) {
  const patterns = settings.sites.flatMap((s) => matchPatterns(s.domain));
  if (!patterns.length) return;
  const tabs = await chrome.tabs.query({ url: patterns });
  await Promise.all(
    tabs.map((t) =>
      chrome.scripting.executeScript({ target: { tabId: t.id }, files: CONTENT_FILES }).catch(() => {})
    )
  );
}

async function scheduleAlarms(status) {
  if (status.nextTransition) {
    // +250ms so we land just after the boundary, not just before it.
    await chrome.alarms.create(ALARM_TRANSITION, { when: status.nextTransition + 250 });
  } else {
    await chrome.alarms.clear(ALARM_TRANSITION);
  }
  // Safety net: recompute every minute. Catches timezone/clock changes and
  // sleep/wake, and keeps the badge countdown fresh.
  const tick = await chrome.alarms.get(ALARM_TICK);
  if (!tick) await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
}

async function updateBadge(status, now) {
  let text = '';
  let color = '#6b7280';
  if (!status.enabled) {
    text = 'off';
  } else if (status.dayUnlocked) {
    text = 'day';
    color = '#16a34a';
  } else {
    const temps = Object.values(status.sites)
      .filter((s) => s.unlockKind === 'temp' && s.inWindow)
      .map((s) => s.unlockedUntil);
    if (temps.length) {
      const mins = Math.ceil((Math.min(...temps) - now) / MINUTE);
      text = mins >= 1 ? `${mins}m` : '<1m';
      color = '#d97706';
    }
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

/** DNR only affects new requests; send already-open tabs to the block page. */
async function redirectOpenTabs(status) {
  const blocked = Object.values(status.sites).filter((s) => s.blocked);
  if (!blocked.length) return;
  const tabs = await chrome.tabs.query({ url: blocked.flatMap((s) => matchPatterns(s.domain)) });
  const domains = blocked.map((s) => s.domain);
  for (const tab of tabs) {
    let host;
    try {
      host = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    const domain = findDomainForHost(host, domains);
    if (!domain) continue;
    const url = `${EXT_ORIGIN}${BLOCK_PAGE_PATH}?site=${encodeURIComponent(domain)}&url=${tab.url}`;
    chrome.tabs.update(tab.id, { url }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Mutations

async function mutate(fn) {
  return locked(async () => {
    const data = await loadAll();
    const now = Date.now();
    pruneState(data.state, now);
    const status = computeStatus(data.settings, data.state, now);
    const result = (await fn({ ...data, status, now })) || {};
    await chrome.storage.local.set({ settings: data.settings, state: data.state });
    const { _why, ...rest } = result;
    const newStatus = await recompute(_why || 'mutation');
    return { ...rest, status: newStatus };
  });
}

function findSite(settings, id) {
  const site = settings.sites.find((s) => s.id === id);
  if (!site) throw new GateError('Unknown site');
  return site;
}

function requireGlobal(status) {
  if (!canModifyGlobal(status)) throw new GateError(LOCKED_MSG, 'LOCKED');
}

function requireSite(status, id) {
  if (!canModifySite(status, id)) throw new GateError(LOCKED_MSG, 'LOCKED');
}

const SITE_FIELDS = ['mode', 'grayscale', 'scheduleMode', 'schedule', 'enabled'];
const GLOBAL_FIELDS = {
  globalSchedule: 'object',
  goals: 'string',
  unlockMinutes: 'number',
  review: 'object',
  partner: 'object',
  grayscalePhrase: 'string',
};

/** Is this site change strictly tightening (allowed even when locked)? */
function isTightening(site, patch) {
  const keys = Object.keys(patch);
  return keys.every(
    (k) =>
      (k === 'enabled' && patch.enabled === true) ||
      (k === 'grayscale' && patch.grayscale === true) ||
      (k === 'mode' && patch.mode === 'full')
  );
}

const handlers = {
  async getStatus() {
    return locked(async () => {
      const { settings, state } = await loadAll();
      const status = await recompute('getStatus');
      const today = dateKey();
      const reqs = state.partnerRequests.date === today ? state.partnerRequests.count : 0;
      return {
        settings,
        status,
        partner: {
          pending: state.partnerPending
            ? { target: state.partnerPending.target, expiresAt: state.partnerPending.expiresAt }
            : null,
          requestsToday: reqs,
          requestsLeft: Math.max(0, settings.partner.maxPerDay - reqs),
        },
      };
    });
  },

  addSite({ domain, mode }) {
    return mutate(({ settings }) => {
      const d = normalizeDomain(domain);
      if (!d) throw new GateError(`"${domain}" is not a valid domain`);
      if (settings.sites.some((s) => s.domain === d)) throw new GateError(`${d} is already in the list`);
      settings.sites.push(makeSite(d, mode ? { mode } : {}));
      return { _why: 'addSite' };
    });
  },

  removeSite({ id }) {
    return mutate(({ settings, status }) => {
      findSite(settings, id);
      requireSite(status, id);
      settings.sites = settings.sites.filter((s) => s.id !== id);
      return { _why: 'removeSite' };
    });
  },

  updateSite({ id, patch }) {
    return mutate(({ settings, status }) => {
      const site = findSite(settings, id);
      const clean = {};
      for (const k of SITE_FIELDS) if (k in patch) clean[k] = patch[k];
      if (clean.mode && !['full', 'none'].includes(clean.mode)) throw new GateError('Bad mode');
      if (clean.schedule) {
        const errs = validateSchedule(clean.schedule);
        if (errs.length) throw new GateError(errs.join('; '));
      }
      if (!isTightening(site, clean)) requireSite(status, id);
      Object.assign(site, clean);
      return { _why: 'updateSite' };
    });
  },

  setEnabled({ enabled }) {
    return mutate(({ settings, status }) => {
      if (!enabled) requireGlobal(status);
      settings.enabled = !!enabled;
      return { _why: enabled ? 'resume' : 'pause' };
    });
  },

  saveSettings({ patch }) {
    return mutate(({ settings, status }) => {
      requireGlobal(status);
      for (const [k, type] of Object.entries(GLOBAL_FIELDS)) {
        if (!(k in patch)) continue;
        if (typeof patch[k] !== type) throw new GateError(`Bad value for ${k}`);
        if (type === 'object' && !Array.isArray(patch[k]) && typeof settings[k] === 'object' && !Array.isArray(settings[k])) {
          settings[k] = { ...settings[k], ...patch[k] };
        } else {
          settings[k] = patch[k];
        }
      }
      const errs = validateSchedule(settings.globalSchedule);
      if (errs.length) throw new GateError(errs.join('; '));
      settings.unlockMinutes = clampNum(settings.unlockMinutes, 1, 240);
      settings.review.minSeconds = clampNum(settings.review.minSeconds, 0, 3600);
      settings.review.minWords = clampNum(settings.review.minWords, 0, 10000);
      settings.partner.codeExpiryMinutes = clampNum(settings.partner.codeExpiryMinutes, 1, 1440);
      settings.partner.maxPerDay = clampNum(settings.partner.maxPerDay, 0, 20);
      if (parseHM(settings.review.availableAfter) == null) throw new GateError('Bad "available after" time');
      if (!settings.grayscalePhrase.trim()) throw new GateError('Grayscale phrase cannot be empty');
      return { _why: 'saveSettings' };
    });
  },

  // ---- Partner unlock ------------------------------------------------------

  partnerRequest({ target, reason }) {
    return mutate(async ({ settings, state, status, now }) => {
      const p = settings.partner;
      if (!p.email || !p.endpoint) throw new GateError('Set your partner email and email backend in Settings first.');
      reason = String(reason || '').trim();
      if (reason.length < 10) throw new GateError('Give your partner a real reason (at least 10 characters).');
      const targetLabel = resolveTarget(settings, target).label;
      const today = dateKey(now);
      if (state.partnerRequests.date !== today) state.partnerRequests = { date: today, count: 0 };
      if (state.partnerRequests.count >= p.maxPerDay) {
        throw new GateError(`You've used all ${p.maxPerDay} partner requests for today.`, 'RATE_LIMIT');
      }
      const code = randomCode();
      const expiresAt = now + p.codeExpiryMinutes * MINUTE;
      await sendPartnerEmail(p, {
        to: p.email,
        partnerName: p.name,
        site: targetLabel,
        reason,
        code,
        expiresMinutes: p.codeExpiryMinutes,
      });
      const hashed = await hashCode(code);
      state.partnerRequests.count += 1;
      state.partnerPending = { ...hashed, expiresAt, target, attempts: 0 };
      await bumpStats((s) => recordAttempt(s, 'partner', { success: false }, now));
      return { _why: 'partnerRequest', expiresAt, requestsLeft: p.maxPerDay - state.partnerRequests.count };
    });
  },

  partnerVerify({ code }) {
    return mutate(async ({ settings, state, status, now }) => {
      const pending = state.partnerPending;
      if (!pending) throw new GateError('No active code. Request a new one.');
      if (!/^\d{6}$/.test(String(code).trim())) throw new GateError('Enter the 6-digit code.');
      const ok = await verifyCode(code, pending);
      if (!ok) {
        pending.attempts += 1;
        if (pending.attempts >= MAX_CODE_ATTEMPTS) {
          state.partnerPending = null;
          return { ok: false, message: 'Too many wrong codes. That code is now invalid.' };
        }
        return { ok: false, message: `Wrong code (${MAX_CODE_ATTEMPTS - pending.attempts} tries left).` };
      }
      state.partnerPending = null;
      const until = now + settings.unlockMinutes * MINUTE;
      const t = resolveTarget(settings, pending.target);
      if (t.kind === 'settings') state.settingsUnlockUntil = until;
      else state.unlocks[t.site.id] = until;
      const inWindow = t.kind === 'settings' ? status.anyInWindow : status.sites[t.site.id]?.inWindow;
      // The request already counted as the attempt; record only the success.
      await bumpStats((s) => recordAttempt(s, 'partner', { success: true, inWindow, countAttempt: false }, now));
      return { ok: true, until, target: pending.target, _why: 'partnerUnlock' };
    });
  },

  // ---- Voice day review ----------------------------------------------------

  reviewSubmit({ transcript, speakingSeconds, recordingSeconds }) {
    return mutate(async ({ settings, state, status, now }) => {
      const r = settings.review;
      const avail = parseHM(r.availableAfter);
      if (minutesSinceMidnight(now) < avail) {
        throw new GateError(`The day review is only available after ${r.availableAfter}.`, 'TOO_EARLY');
      }
      transcript = String(transcript || '').trim();
      const words = countWords(transcript);
      const secs = Math.round(Number(speakingSeconds) || 0);
      const failures = [];
      if (secs < r.minSeconds) failures.push(`spoke for ${secs}s, need ${r.minSeconds}s`);
      if (words < r.minWords) failures.push(`${words} words, need ${r.minWords}`);

      let approved = failures.length === 0;
      let reason = approved ? 'Met duration and word-count requirements.' : `Not enough: ${failures.join('; ')}.`;
      let llmUsed = false;
      let llmError = null;
      if (approved && r.apiKey) {
        llmUsed = true;
        try {
          const verdict = await judgeReview({ apiKey: r.apiKey, model: r.model, goals: settings.goals, transcript });
          approved = verdict.approved;
          reason = verdict.reason;
        } catch (e) {
          // Don't grant the unlock if the configured check can't run.
          approved = false;
          llmError = e.message;
          reason = `Couldn't reach Claude to check your review: ${e.message}`;
        }
      }

      const entry = {
        ts: now,
        date: dateKey(now),
        transcript,
        words,
        speakingSeconds: secs,
        recordingSeconds: Math.round(Number(recordingSeconds) || 0),
        approved,
        reason,
        llmUsed,
        llmError,
      };
      const { reviews = [] } = await chrome.storage.local.get('reviews');
      reviews.push(entry);
      await chrome.storage.local.set({ reviews: reviews.slice(-500) });

      if (approved) state.dayUnlockUntil = nextMidnight(now);
      await bumpStats((s) => recordAttempt(s, 'review', { success: approved, inWindow: status.anyInWindow }, now));
      return { approved, reason, words, speakingSeconds: secs, llmUsed, until: approved ? state.dayUnlockUntil : null, _why: 'review' };
    });
  },

  async reviewHistory() {
    const { reviews = [] } = await chrome.storage.local.get('reviews');
    return { reviews: reviews.slice().reverse() };
  },

  // ---- Grayscale phrase ----------------------------------------------------

  grayscaleOff({ siteId, typed }) {
    return mutate(async ({ settings, state, status, now }) => {
      const site = findSite(settings, siteId);
      const st = status.sites[site.id];
      if (!st?.grayscale) return { ok: true, message: 'Grayscale is not active for this site.' };
      const ok = phraseMatches(typed, settings.grayscalePhrase);
      await bumpStats((s) => recordAttempt(s, 'phrase', { success: ok, inWindow: true }, now));
      if (!ok) return { ok: false, message: "That doesn't match the phrase exactly." };
      // Lasts until the current block window ends (i.e. until the next one starts).
      state.grayscaleOff[site.id] = Number.isFinite(st.windowEnd) ? st.windowEnd : nextMidnight(now);
      return { ok: true, until: state.grayscaleOff[site.id], _why: 'grayscaleOff' };
    });
  },

  // ---- Stats ---------------------------------------------------------------

  heartbeat({ seconds }, sender) {
    return locked(async () => {
      // Trust the frame URL Chrome reports, not a host field in the message:
      // only content scripts on real web pages count.
      let host;
      try {
        const u = new URL(sender.url || '');
        if (!sender.tab || !/^https?:$/.test(u.protocol)) return {};
        host = u.hostname;
      } catch {
        return {};
      }
      const idle = await chrome.idle.queryState(60);
      if (idle !== 'active') return {};
      const { settings } = await loadAll();
      const domain = findDomainForHost(host, settings.sites.map((s) => s.domain));
      if (!domain) return {};
      const secs = Math.min(Math.max(Number(seconds) || 0, 0), 30);
      await bumpStats((s) => addTime(s, domain, secs));
      return {};
    });
  },

  async getStats() {
    const { stats } = await chrome.storage.local.get('stats');
    return { stats: stats || { days: {} } };
  },

  openPage({ path }) {
    return chrome.tabs.create({ url: chrome.runtime.getURL(path) }).then(() => ({}));
  },
};

function resolveTarget(settings, target) {
  if (target === 'settings') return { kind: 'settings', label: 'FocusGate settings (to change or pause blocking)' };
  const site = settings.sites.find((s) => s.domain === target || s.id === target);
  if (!site) throw new GateError('Unknown site');
  return { kind: 'site', site, label: site.domain };
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

async function bumpStats(fn) {
  const { stats = { days: {} } } = await chrome.storage.local.get('stats');
  stats.installDate ||= dateKey();
  fn(stats);
  pruneStats(stats);
  await chrome.storage.local.set({ stats });
}

// ---------------------------------------------------------------------------
// Wiring

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg, sender))
    .then((res) => sendResponse(res || {}))
    .catch((e) => {
      if (!(e instanceof GateError)) console.error('[FocusGate]', msg.type, e);
      sendResponse({ error: e.message, code: e.code });
    });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_TRANSITION || alarm.name === ALARM_TICK) locked(() => recompute(alarm.name));
});

chrome.runtime.onInstalled.addListener((details) => {
  locked(async () => {
    const stored = await chrome.storage.local.get(['settings', 'stats']);
    const { settings, state } = await loadAll(); // migrates / fills defaults
    const writes = { settings, state };
    if (!stored.stats) writes.stats = { installDate: dateKey(), days: {} };
    // First install inside a block window would otherwise lock you out of
    // setting up goals and your partner. Give a one-time setup grace period.
    if (details.reason === 'install' && !stored.settings) {
      state.settingsUnlockUntil = Date.now() + SETUP_GRACE_MINUTES * MINUTE;
    }
    await chrome.storage.local.set(writes);
    lastRulesKey = lastContentKey = null;
    await recompute(`installed:${details.reason}`);
    await injectIntoOpenTabs(settings);
    if (details.reason === 'install') chrome.runtime.openOptionsPage();
  });
});

chrome.runtime.onStartup.addListener(() => locked(() => recompute('startup')));

// Recompute on every service-worker wake-up too (covers restarts mid-unlock
// and clock changes while the worker was asleep).
locked(() => recompute('wake'));

// Handle for tests and for poking at state from the service-worker console.
globalThis.focusgate = { recompute: () => locked(() => recompute('manual')) };
