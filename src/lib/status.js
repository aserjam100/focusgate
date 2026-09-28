// Pure computation of what should be blocked right now. The service worker
// persists the result so pages and content scripts never re-derive it.

import { activeInterval, nextTransition } from './schedule.js';

export function siteSchedule(settings, site) {
  return site.scheduleMode === 'custom' ? site.schedule : settings.globalSchedule;
}

export function computeStatus(settings, state, now) {
  const dayUnlocked = state.dayUnlockUntil > now;
  const settingsUnlocked = state.settingsUnlockUntil > now;
  const sites = {};
  let anyInWindow = false;
  let anyLockedInWindow = false;
  const transitions = [];

  for (const site of settings.sites) {
    const sched = siteSchedule(settings, site);
    const win = settings.enabled && site.enabled ? activeInterval(sched, now) : null;
    const inWindow = win != null;
    const tempUntil = state.unlocks[site.id] > now ? state.unlocks[site.id] : 0;
    const unlocked = dayUnlocked || tempUntil > 0;
    const grayOffUntil = state.grayscaleOff[site.id] > now ? state.grayscaleOff[site.id] : 0;

    if (inWindow) anyInWindow = true;
    if (inWindow && !dayUnlocked) anyLockedInWindow = true;

    sites[site.id] = {
      id: site.id,
      domain: site.domain,
      mode: site.mode,
      inWindow,
      // null while in a window means open-ended (JSON can't carry Infinity).
      windowEnd: win && Number.isFinite(win.end) ? win.end : null,
      unlockedUntil: dayUnlocked ? state.dayUnlockUntil : tempUntil || null,
      unlockKind: dayUnlocked ? 'day' : tempUntil ? 'temp' : null,
      blocked: inWindow && !unlocked && site.mode === 'full',
      partial: inWindow && !unlocked && site.mode === 'partial',
      // Grayscale survives unlocks: it has its own (phrase) unlock.
      grayscale: inWindow && site.grayscale && !grayOffUntil,
    };

    if (settings.enabled && site.enabled) {
      const t = nextTransition(sched, now);
      if (t) transitions.push(t);
    }
    if (tempUntil) transitions.push(tempUntil);
    if (grayOffUntil) transitions.push(grayOffUntil);
  }
  if (dayUnlocked) transitions.push(state.dayUnlockUntil);
  if (settingsUnlocked) transitions.push(state.settingsUnlockUntil);
  if (state.partnerPending?.expiresAt > now) transitions.push(state.partnerPending.expiresAt);

  return {
    enabled: settings.enabled,
    anyInWindow,
    dayUnlocked,
    dayUnlockUntil: dayUnlocked ? state.dayUnlockUntil : null,
    settingsUnlockedUntil: settingsUnlocked ? state.settingsUnlockUntil : null,
    // Settings that loosen blocking are locked while any site is inside its
    // block window, unless the day or settings were unlocked.
    settingsLocked: anyLockedInWindow && !settingsUnlocked,
    sites,
    nextTransition: transitions.length ? Math.min(...transitions) : null,
  };
}

/** Can a loosening change be made to this site (uncheck, delete, edit)? */
export function canModifySite(status, siteId) {
  const s = status.sites[siteId];
  if (!s || !s.inWindow) return true;
  return status.dayUnlocked || status.settingsUnlockedUntil != null;
}

/** Can global settings (schedule, pause, requirements, partner...) be loosened? */
export function canModifyGlobal(status) {
  return !status.settingsLocked;
}
