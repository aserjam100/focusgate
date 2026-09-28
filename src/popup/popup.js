import { send } from '../lib/store.js';
import { formatDuration } from '../lib/time.js';

const $ = (s) => document.querySelector(s);
let current = null;

function openPage(path) {
  send('openPage', { path });
  window.close();
}

function showMessage(text, kind = 'error', withUnlock = false) {
  const el = $('#message');
  el.className = `msg ${kind}`;
  el.textContent = text;
  if (withUnlock) {
    const btn = document.createElement('button');
    btn.textContent = 'Unlock settings…';
    btn.style.marginLeft = '8px';
    btn.onclick = () => openPage('src/block/block.html?target=settings');
    el.append(' ', btn);
  }
}

async function act(type, payload) {
  try {
    await send(type, payload);
    $('#message').textContent = '';
  } catch (e) {
    showMessage(e.message, 'error', e.code === 'LOCKED');
  }
  await refresh();
}

function sitePill(st, site) {
  const pill = document.createElement('span');
  pill.className = 'pill';
  if (!site.enabled) {
    pill.textContent = 'off';
  } else if (st.blocked) {
    pill.classList.add('blocked');
    pill.textContent = 'blocked';
  } else if (st.partial) {
    pill.classList.add('partial');
    pill.textContent = 'partial';
  } else if (st.inWindow && st.unlockedUntil) {
    pill.classList.add('unlocked');
    pill.textContent = `unlocked ${formatDuration(st.unlockedUntil - Date.now())}`;
  } else if (st.inWindow) {
    pill.textContent = st.grayscale ? 'gray' : 'tracked';
  } else {
    pill.classList.add('free');
    pill.textContent = 'free';
  }
  return pill;
}

function render({ settings, status }) {
  const now = Date.now();
  $('#pause').textContent = settings.enabled ? 'Pause' : 'Resume';

  let summary;
  if (!settings.enabled) summary = 'Paused. Nothing is blocked.';
  else if (status.dayUnlocked) summary = `Day review passed. Everything's unlocked until midnight.`;
  else if (status.anyInWindow) {
    const end = Math.min(...Object.values(status.sites).filter((s) => s.inWindow).map((s) => s.windowEnd ?? Infinity));
    summary = `Block window active${Number.isFinite(end) ? `, ends in ${formatDuration(end - now)}` : ''}. Loosening changes need an unlock.`;
  } else summary = 'No block window right now. Changes are free.';
  if (status.settingsUnlockedUntil) summary += ` Settings unlocked for ${formatDuration(status.settingsUnlockedUntil - now)}.`;
  $('#summary').textContent = summary;

  const ul = $('#sites');
  ul.replaceChildren();
  for (const site of settings.sites) {
    const st = status.sites[site.id];
    const li = document.createElement('li');

    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.title = site.enabled ? 'Blocking enabled' : 'Blocking disabled';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = site.enabled;
    cb.onchange = () => act('updateSite', { id: site.id, patch: { enabled: cb.checked } });
    const slider = document.createElement('span');
    slider.className = 'slider';
    sw.append(cb, slider);

    const name = document.createElement('span');
    name.className = 'domain';
    name.textContent = site.domain;
    name.title = `${site.domain} · mode: ${site.mode}${site.grayscale ? ' + grayscale' : ''}`;

    li.append(sw, name);

    if (st.grayscale) {
      const g = document.createElement('a');
      g.href = '#';
      g.className = 'gray-link';
      g.textContent = 'color…';
      g.title = 'Type the phrase to turn grayscale off';
      g.onclick = (e) => {
        e.preventDefault();
        openPage(`src/phrase/phrase.html?site=${encodeURIComponent(site.id)}`);
      };
      li.append(g);
    }

    li.append(sitePill(st, site));

    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.textContent = '×';
    rm.title = `Remove ${site.domain}`;
    rm.onclick = () => act('removeSite', { id: site.id });
    li.append(rm);

    ul.append(li);
  }
}

async function refresh() {
  current = await send('getStatus');
  render(current);
}

$('#pause').onclick = () => act('setEnabled', { enabled: !current.settings.enabled });

$('#add').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#domain');
  if (!input.value.trim()) return;
  await act('addSite', { domain: input.value });
  if (!$('#message').textContent) input.value = '';
};

document.querySelectorAll('[data-open]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openPage(a.dataset.open);
  })
);

refresh();
setInterval(refresh, 15_000);
