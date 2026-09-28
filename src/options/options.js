import { send } from '../lib/store.js';
import { formatDuration } from '../lib/time.js';
import { renderScheduleEditor } from './schedule-editor.js';

const $ = (s) => document.querySelector(s);
const form = $('#settings');
let data = null;
let globalSchedule = null;
let formDirty = false;

function showMessage(text, kind = 'error') {
  const el = $('#message');
  el.className = `msg ${kind}`;
  el.textContent = text;
  if (text) el.scrollIntoView({ block: 'nearest' });
}

async function act(type, payload) {
  try {
    await send(type, payload);
    showMessage('');
  } catch (e) {
    showMessage(e.message + (e.code === 'LOCKED' ? ' (use "Unlock settings…" above)' : ''));
  }
  await refresh();
}

// ---- Form <-> settings -------------------------------------------------------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function fillForm(settings) {
  for (const el of form.elements) {
    if (!el.name) continue;
    let v = getPath(settings, el.name);
    if (el.name === 'redditWhitelist') v = (v || []).join('\n');
    el.value = v ?? '';
  }
  globalSchedule = structuredClone(settings.globalSchedule);
  renderScheduleEditor($('#global-schedule'), globalSchedule, (s) => {
    globalSchedule = s;
    formDirty = true;
  });
  formDirty = false;
}

function readForm() {
  const patch = { review: {}, partner: {} };
  for (const el of form.elements) {
    if (!el.name) continue;
    let v = el.value;
    if (el.type === 'number') v = Number(v);
    if (el.name === 'redditWhitelist') v = v.split(/[\s,]+/).filter(Boolean);
    const [a, b] = el.name.split('.');
    if (b) patch[a][b] = v;
    else patch[a] = v;
  }
  patch.globalSchedule = globalSchedule;
  return patch;
}

form.addEventListener('input', () => (formDirty = true));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#save').disabled = true;
  try {
    await send('saveSettings', { patch: readForm() });
    $('#save-msg').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    showMessage('');
    formDirty = false;
    data = await send('getStatus');
    fillForm(data.settings);
    renderLock();
  } catch (err) {
    showMessage(err.message);
  } finally {
    $('#save').disabled = false;
  }
});

// ---- Sites table --------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function renderSites() {
  const { settings, status } = data;
  const table = $('#sites');
  table.replaceChildren();
  for (const site of settings.sites) {
    const st = status.sites[site.id];
    const tr = el('tr');

    const enabled = el('input', { type: 'checkbox', checked: site.enabled });
    enabled.onchange = () => act('updateSite', { id: site.id, patch: { enabled: enabled.checked } });
    const sw = el('label', { className: 'switch', title: 'Enabled' }, enabled, el('span', { className: 'slider' }));

    const mode = el('select');
    for (const [v, label] of [['full', 'Full block'], ['partial', 'Partial'], ['none', 'None']]) {
      mode.append(el('option', { value: v, textContent: label, selected: site.mode === v }));
    }
    mode.onchange = () => act('updateSite', { id: site.id, patch: { mode: mode.value } });

    const gray = el('input', { type: 'checkbox', checked: site.grayscale });
    gray.onchange = () => act('updateSite', { id: site.id, patch: { grayscale: gray.checked } });

    const schedMode = el('select');
    schedMode.append(
      el('option', { value: 'global', textContent: 'Global schedule', selected: site.scheduleMode === 'global' }),
      el('option', { value: 'custom', textContent: 'Custom schedule', selected: site.scheduleMode === 'custom' })
    );
    schedMode.onchange = () => act('updateSite', { id: site.id, patch: { scheduleMode: schedMode.value } });

    const state = st.blocked ? 'blocked' : st.partial ? 'partial' : st.inWindow && st.unlockedUntil ? 'unlocked' : st.inWindow ? 'in window' : 'free';
    const pill = el('span', { className: `pill ${state.split(' ')[0]}`, textContent: state });

    const rm = el('button', { type: 'button', className: 'danger', textContent: 'Remove' });
    rm.onclick = () => act('removeSite', { id: site.id });

    tr.append(
      el('td', {}, sw),
      el('td', { className: 'domain' }, site.domain),
      el('td', {}, mode),
      el('td', {}, el('label', { className: 'row small' }, gray, 'Grayscale')),
      el('td', {}, schedMode),
      el('td', {}, pill),
      el('td', {}, rm)
    );
    table.append(tr);

    if (site.scheduleMode === 'custom') {
      const holder = el('div');
      let draft = structuredClone(site.schedule);
      renderScheduleEditor(holder, draft, (s) => (draft = s));
      const save = el('button', { type: 'button', className: 'primary', textContent: `Save ${site.domain} schedule` });
      save.onclick = () => act('updateSite', { id: site.id, patch: { schedule: draft } });
      table.append(el('tr', { className: 'sched-row' }, el('td'), el('td', { colSpan: 6 }, holder, save)));
    }
  }
}

function renderLock() {
  const { status } = data;
  const locked = status.settingsLocked;
  $('#lock-banner').classList.toggle('hidden', !locked);
  if (locked) $('#lock-text').textContent = 'A block window is active. Adding sites and tightening still work.';
  $('#save').disabled = locked;
  let txt = '';
  if (status.settingsUnlockedUntil) txt = `Settings unlocked for ${formatDuration(status.settingsUnlockedUntil - Date.now())}.`;
  else if (status.dayUnlocked) txt = 'Day unlocked. Settings are free until midnight.';
  if (!$('#save-msg').textContent.startsWith('Saved')) $('#save-msg').textContent = txt;
}

async function refresh() {
  data = await send('getStatus');
  renderSites();
  renderLock();
  if (!formDirty && !form.contains(document.activeElement)) fillForm(data.settings);
}

$('#add-site').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#add-domain');
  if (!input.value.trim()) return;
  await act('addSite', { domain: input.value });
  if (!$('#message').textContent) input.value = '';
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.runtime || changes.settings) refresh();
});

(async () => {
  data = await send('getStatus');
  fillForm(data.settings);
  renderSites();
  renderLock();
})();
