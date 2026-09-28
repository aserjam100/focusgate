import { send } from '../lib/store.js';

const $ = (s) => document.querySelector(s);
const siteId = new URLSearchParams(location.search).get('site');
const input = $('#typed');
let phrase = '';

function msg(text, kind = 'error') {
  $('#msg').className = `msg ${kind}`;
  $('#msg').textContent = text;
}

// Only typed characters are allowed in: no paste, drop, autocomplete,
// autocorrect replacements, or IME-free bulk insertions.
const BLOCKED_INPUT = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'insertReplacementText',
  'insertFromYank',
]);
input.addEventListener('beforeinput', (e) => {
  if (BLOCKED_INPUT.has(e.inputType) || (e.inputType === 'insertText' && e.data && e.data.length > 1)) {
    e.preventDefault();
    msg('Type it, one key at a time.');
  }
});
for (const ev of ['paste', 'drop', 'dragover']) {
  input.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev !== 'dragover') msg('Pasting and dropping are disabled. Type it.');
  });
}
// The phrase text itself can't be copied either.
$('#phrase').addEventListener('copy', (e) => e.preventDefault());
$('#phrase').addEventListener('dragstart', (e) => e.preventDefault());

input.addEventListener('input', () => {
  const typed = input.value.trim().toLocaleLowerCase();
  const target = phrase.toLocaleLowerCase();
  let ok = 0;
  while (ok < typed.length && typed[ok] === target[ok]) ok++;
  $('#progress').textContent = `${ok} / ${target.length} characters correct`;
});

$('#submit').onclick = async () => {
  $('#submit').disabled = true;
  try {
    const res = await send('grayscaleOff', { siteId, typed: input.value });
    if (res.ok) {
      const until = res.until ? ` until ${new Date(res.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
      msg(res.message || `Grayscale is off${until}.`, 'ok');
      return;
    }
    msg(res.message);
  } catch (e) {
    msg(e.message);
  }
  $('#submit').disabled = false;
};

(async () => {
  const { settings, status } = await send('getStatus');
  const site = settings.sites.find((s) => s.id === siteId);
  if (!site) {
    msg('Unknown site.');
    $('#submit').disabled = true;
    return;
  }
  phrase = settings.grayscalePhrase.trim();
  $('#title').textContent = `Turn off grayscale for ${site.domain}`;
  $('#phrase').textContent = phrase;
  const st = status.sites[site.id];
  $('#desc').textContent = st.grayscale
    ? 'Type the phrase below to see this site in color again until the current block window ends.'
    : `Grayscale isn't active on ${site.domain} right now.`;
  input.dispatchEvent(new Event('input'));
})();
