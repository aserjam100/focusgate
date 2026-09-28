// chrome.storage.local access. Only the service worker writes settings/state;
// pages send it messages so gating can't be skipped by a UI bug.

import { migrateSettings, migrateState } from './defaults.js';

export async function loadAll() {
  const { settings, state, runtime } = await chrome.storage.local.get(['settings', 'state', 'runtime']);
  return { settings: migrateSettings(settings), state: migrateState(state), runtime: runtime || null };
}

export function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).then((res) => {
    if (!res) throw new Error('No response from background');
    if (res.error) {
      const err = new Error(res.error);
      err.code = res.code;
      throw err;
    }
    return res;
  });
}
