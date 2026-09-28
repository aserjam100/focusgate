import { send } from '../lib/store.js';
import { formatDuration, formatHM, parseHM, minutesSinceMidnight } from '../lib/time.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const isSettings = params.get('target') === 'settings';
const siteDomain = params.get('site');
const target = isSettings ? 'settings' : siteDomain;
// The original URL is appended raw after "&url=" by the redirect rule.
const originalUrl = (() => {
  const i = location.href.indexOf('&url=');
  return i === -1 ? null : location.href.slice(i + 5);
})();

let data = null;

function msg(el, text, kind = 'error') {
  el.className = `msg ${kind}`;
  el.textContent = text;
}

function continueTo() {
  if (isSettings) location.href = chrome.runtime.getURL('src/options/options.html');
  else if (originalUrl && /^https?:/i.test(originalUrl)) location.href = originalUrl;
  else location.href = `https://${siteDomain}/`;
}

function render() {
  const { settings, status, partner } = data;
  const now = Date.now();
  const site = settings.sites.find((s) => s.domain === siteDomain);
  const st = site && status.sites[site.id];

  $('#title').textContent = isSettings ? 'Unlock settings' : `${siteDomain} is blocked`;
  document.title = isSettings ? 'Unlock settings · FocusGate' : `${siteDomain} blocked · FocusGate`;

  // Countdown to the end of the relevant block window.
  // windowEnd null while inWindow = open-ended.
  let end = null;
  if (isSettings) {
    const ends = Object.values(status.sites).filter((s) => s.inWindow).map((s) => s.windowEnd ?? Infinity);
    end = ends.length ? Math.min(...ends) : null;
  } else if (st?.inWindow) end = st.windowEnd ?? Infinity;
  const cd = $('#countdown');
  if (end == null) cd.textContent = '';
  else if (!Number.isFinite(end)) cd.innerHTML = 'Blocked <strong>all the time</strong> (no end to this window).';
  else {
    const at = new Date(end);
    cd.innerHTML = `Block window ends in <strong>${formatDuration(end - now)}</strong> (at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`;
  }

  // Not (or no longer) blocked?
  const free = isSettings ? !status.settingsLocked : !st?.blocked;
  $('#free').classList.toggle('hidden', !free);
  $('#methods').classList.toggle('hidden', free);
  if (free) {
    $('#free-text').textContent = isSettings
      ? 'Settings are unlocked. You can make changes now.'
      : st?.unlockedUntil
        ? `Unlocked for ${formatDuration(st.unlockedUntil - now)}.`
        : `${siteDomain} isn't blocked right now.`;
  }

  $('#goals').textContent = settings.goals.trim() || 'No goals set. Add them in Settings.';
  $('#goals').classList.toggle('muted', !settings.goals.trim());

  // Partner
  const p = settings.partner;
  const configured = p.email && p.endpoint;
  const who = p.name || 'your partner';
  $('#partner-left').textContent = `${partner.requestsLeft} of ${p.maxPerDay} left today`;
  $('#partner-desc').textContent = configured
    ? `Emails ${who} a 6-digit code with your reason. Unlocks ${isSettings ? 'settings' : siteDomain} for ${settings.unlockMinutes} min. Codes expire after ${p.codeExpiryMinutes} min.`
    : 'Set up your partner and email backend in Settings to use this.';
  const pendingHere = partner.pending && partner.pending.target === target && partner.pending.expiresAt > now;
  $('#partner-request').classList.toggle('hidden', !configured || pendingHere);
  $('#partner-verify').classList.toggle('hidden', !pendingHere);
  $('#partner-send').disabled = partner.requestsLeft <= 0;
  if (pendingHere) {
    $('#partner-sent').textContent = `Code sent to ${who}. Expires in ${formatDuration(partner.pending.expiresAt - now)}.`;
  }

  // Day review
  const r = settings.review;
  const availMin = parseHM(r.availableAfter);
  const available = minutesSinceMidnight(now) >= availMin;
  $('#review-desc').textContent =
    `Speak about what you did today (at least ${r.minSeconds}s and ${r.minWords} words). Unlocks everything until midnight. ` +
    (available ? 'Available now.' : `Available after ${formatHM(availMin)}.`);
  $('#review-open').disabled = !available;
}

async function refresh() {
  data = await send('getStatus');
  render();
}

$('#continue').onclick = (e) => {
  e.preventDefault();
  continueTo();
};

$('#partner-send').onclick = async () => {
  const btn = $('#partner-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await send('partnerRequest', { target, reason: $('#partner-reason').value });
    msg($('#partner-msg'), 'Code sent. Ask your partner for it.', 'ok');
  } catch (e) {
    msg($('#partner-msg'), e.message);
  }
  btn.textContent = 'Send code request';
  await refresh();
};

$('#partner-check').onclick = async () => {
  const btn = $('#partner-check');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const res = await send('partnerVerify', { code: $('#partner-code').value });
    if (res.ok) {
      msg($('#partner-msg'), 'Unlocked.', 'ok');
      continueTo();
      return;
    }
    msg($('#partner-msg'), res.message);
  } catch (e) {
    msg($('#partner-msg'), e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
  await refresh();
};

$('#partner-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#partner-check').click();
});

$('#review-open').onclick = () => {
  const ret = isSettings ? 'settings' : originalUrl || `https://${siteDomain}/`;
  location.href = chrome.runtime.getURL(`src/review/review.html?return=${encodeURIComponent(ret)}`);
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.runtime) refresh();
});

refresh();
setInterval(render, 30_000);
