import { send } from '../lib/store.js';
import { computeStreaks, METHODS } from '../lib/stats.js';
import { dateKey } from '../lib/time.js';

const $ = (s) => document.querySelector(s);
const METHOD_LABELS = { partner: 'Partner code', review: 'Day review', phrase: 'Grayscale phrase' };
let stats = null;
let rangeDays = 7;

function fmtTime(sec) {
  if (!sec) return '0m';
  if (sec < 60) return '<1m';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function lastDays(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    out.push({ key: dateKey(x.getTime()), date: x });
  }
  return out;
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

// ---- Tooltip -----------------------------------------------------------------

const tip = $('#tip');
function bindTip(node, text) {
  node.addEventListener('mousemove', (e) => {
    tip.textContent = text;
    tip.hidden = false;
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  node.addEventListener('mouseleave', () => (tip.hidden = true));
}

// ---- Render ------------------------------------------------------------------

function render() {
  const days = lastDays(rangeDays);
  const rec = (k) => stats.days?.[k];

  // Tiles
  const streaks = computeStreaks(stats);
  $('#streak').textContent = `${streaks.current} ${streaks.current === 1 ? 'day' : 'days'}`;
  $('#streak-sub').textContent = rec(dateKey())?.windowUnlocks ? 'Broken today by an unlock' : 'Including today';
  $('#longest').textContent = `${streaks.longest} ${streaks.longest === 1 ? 'day' : 'days'}`;
  const todayTime = Object.values(rec(dateKey())?.time || {}).reduce((a, b) => a + b, 0);
  $('#today').textContent = fmtTime(todayTime);
  $('#today-sub').textContent = 'across all tracked sites';
  let unlocks = 0;
  let inWindow = 0;
  for (const { key } of days) {
    const r = rec(key);
    if (!r) continue;
    unlocks += METHODS.reduce((a, m) => a + (r.successes?.[m] || 0), 0);
    inWindow += r.windowUnlocks || 0;
  }
  $('#unlocks').textContent = String(unlocks);
  $('#unlocks-sub').textContent = `last ${rangeDays} days · ${inWindow} during block windows`;

  // Totals per site
  const totals = {};
  for (const { key } of days) {
    for (const [site, sec] of Object.entries(rec(key)?.time || {})) totals[site] = (totals[site] || 0) + sec;
  }
  const sites = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

  // Bars: one series, sorted, value labelled at the end.
  $('#bars-title').textContent = `Time per site, last ${rangeDays} days`;
  const bars = $('#bars');
  bars.replaceChildren();
  if (!sites.length) bars.append(el('p', { className: 'muted', textContent: 'No time tracked yet.' }));
  const max = Math.max(1, ...Object.values(totals));
  for (const site of sites) {
    const bar = el('div', { className: 'bar' });
    bar.style.width = `${(totals[site] / max) * 100}%`;
    const row = el(
      'div',
      { className: 'bar-row' },
      el('span', { className: 'bar-label', textContent: site }),
      el('div', { className: 'bar-track' }, bar),
      el('span', { className: 'bar-value', textContent: fmtTime(totals[site]) })
    );
    bindTip(row, `${site}: ${fmtTime(totals[site])} over ${rangeDays} days (avg ${fmtTime(totals[site] / rangeDays)}/day)`);
    bars.append(row);
  }

  // Heatmap table: sites x days, sequential single-hue bins, values in cells.
  const heat = $('#heat');
  heat.replaceChildren();
  heat.classList.toggle('compact', rangeDays > 7);
  const maxCell = Math.max(1, ...days.flatMap(({ key }) => Object.values(rec(key)?.time || {})));
  const bin = (sec) => (sec <= 0 ? 0 : Math.min(5, 1 + Math.floor((sec / maxCell) * 5 - 1e-9)));
  const head = el('tr', {}, el('th'));
  for (const { date } of days) {
    head.append(
      el('th', {
        textContent: rangeDays <= 7 ? date.toLocaleDateString([], { weekday: 'short' }) : String(date.getDate()),
        title: date.toLocaleDateString(),
      })
    );
  }
  heat.append(el('thead', {}, head));
  const body = el('tbody');
  for (const site of sites) {
    const tr = el('tr', {}, el('th', { className: 'site', textContent: site }));
    for (const { key, date } of days) {
      const sec = rec(key)?.time?.[site] || 0;
      const b = bin(sec);
      const td = el('td', { className: b ? `l${b}` : 'zero', textContent: sec ? String(Math.max(1, Math.round(sec / 60))) : '·' });
      bindTip(td, `${site} · ${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${fmtTime(sec)}`);
      tr.append(td);
    }
    body.append(tr);
  }
  heat.append(body);
  const legend = $('#heat-legend');
  legend.replaceChildren('Minutes per day. Less');
  for (let i = 1; i <= 5; i++) {
    const sw = el('span', { className: 'sw' });
    sw.style.background = `var(--seq-${i})`;
    legend.append(sw);
  }
  legend.append('More');
  legend.classList.toggle('hidden', !sites.length);

  // Methods table
  const methods = $('#methods');
  methods.replaceChildren(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { textContent: 'Method' }),
        el('th', { className: 'num', textContent: 'Attempts' }),
        el('th', { className: 'num', textContent: 'Succeeded' }),
        el('th', { className: 'num', textContent: 'Success rate' })
      )
    )
  );
  const tb = el('tbody');
  for (const m of METHODS) {
    let a = 0;
    let s = 0;
    for (const { key } of days) {
      a += rec(key)?.attempts?.[m] || 0;
      s += rec(key)?.successes?.[m] || 0;
    }
    tb.append(
      el(
        'tr',
        {},
        el('td', { textContent: METHOD_LABELS[m] }),
        el('td', { className: 'num', textContent: String(a) }),
        el('td', { className: 'num', textContent: String(s) }),
        el('td', { className: 'num', textContent: a ? `${Math.round((s / a) * 100)}%` : '–' })
      )
    );
  }
  methods.append(tb);
}

document.querySelectorAll('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    rangeDays = Number(b.dataset.days);
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  })
);

async function load() {
  ({ stats } = await send('getStats'));
  render();
}

chrome.storage.onChanged.addListener((c) => c.stats && load());
load();
