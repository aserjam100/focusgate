import { send } from '../lib/store.js';
import { countWords } from '../lib/text.js';
import { parseHM, minutesSinceMidnight, formatHM } from '../lib/time.js';

const $ = (s) => document.querySelector(s);
const returnTo = new URLSearchParams(location.search).get('return');

// A gap longer than this between recognition results doesn't count as speaking.
const SPEAKING_GAP_MS = 1500;
const TICK_MS = 250;

let settings = null;
let recognition = null;
let recording = false;
let finalText = '';
let interimText = '';
let speakingMs = 0;
let recordingMs = 0;
let lastResultAt = 0;
let tickTimer = null;

function msg(el, text, kind = 'error') {
  el.className = `msg ${kind}`;
  el.textContent = text;
}

function transcript() {
  return (finalText + ' ' + interimText).replace(/\s+/g, ' ').trim();
}

function render() {
  const r = settings.review;
  const secs = Math.floor(speakingMs / 1000);
  const words = countWords(transcript());
  $('#secs').textContent = `${secs}s`;
  $('#secs-req').textContent = ` / ${r.minSeconds}s`;
  $('#words').textContent = String(words);
  $('#words-req').textContent = ` / ${r.minWords}`;
  const sp = r.minSeconds ? Math.min(1, secs / r.minSeconds) : 1;
  const wp = r.minWords ? Math.min(1, words / r.minWords) : 1;
  $('#secs-bar').style.width = `${sp * 100}%`;
  $('#secs-bar').classList.toggle('done', sp >= 1);
  $('#words-bar').style.width = `${wp * 100}%`;
  $('#words-bar').classList.toggle('done', wp >= 1);
  $('#final').textContent = finalText;
  $('#interim').textContent = interimText ? ' ' + interimText : '';
  $('#transcript').classList.toggle('empty', !finalText && !interimText);
  $('#submit').disabled = recording || !finalText.trim() || !(sp >= 1 && wp >= 1);
  $('#start').classList.toggle('hidden', recording);
  $('#stop').classList.toggle('hidden', !recording);
  $('#rec').classList.toggle('hidden', !recording);
  $('#start').textContent = finalText ? 'Keep speaking' : 'Start speaking';
  const t = $('#transcript');
  t.scrollTop = t.scrollHeight;
}

function tick() {
  if (!recording) return;
  recordingMs += TICK_MS;
  if (Date.now() - lastResultAt < SPEAKING_GAP_MS) speakingMs += TICK_MS;
  render();
}

async function ensureMicPermission() {
  // Ask via getUserMedia first: it gives a clear, catchable permission error,
  // whereas SpeechRecognition only reports a terse "not-allowed".
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      msg(
        $('#mic-msg'),
        'Microphone access was denied. Click the camera/mic icon at the right of the address bar (or open ' +
          'chrome://settings/content/microphone), allow FocusGate, then press Start again.'
      );
    } else if (e.name === 'NotFoundError') {
      msg($('#mic-msg'), 'No microphone found. Plug one in and try again.');
    } else {
      msg($('#mic-msg'), `Couldn't open the microphone: ${e.message}`);
    }
    return false;
  }
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechLang = null;

/**
 * Find a language Chrome can transcribe on this device, downloading its
 * speech model once if needed. Returns null if on-device recognition isn't
 * possible: there is deliberately no fallback to Chrome's cloud recognition,
 * so audio never leaves the computer.
 */
async function ensureOnDeviceModel() {
  if (speechLang) return speechLang;
  if (!SR || typeof SR.available !== 'function' || !('processLocally' in SR.prototype)) {
    msg(
      $('#mic-msg'),
      'This Chrome has no on-device speech recognition. FocusGate never sends your voice to a server, so please update to the latest desktop Chrome to use the day review.'
    );
    return null;
  }
  const candidates = [...new Set([navigator.language, 'en-US'].filter(Boolean))];
  for (const lang of candidates) {
    const options = { langs: [lang], processLocally: true };
    const status = await SR.available(options);
    if (status === 'available') return (speechLang = lang);
    if (status === 'downloadable' || status === 'downloading') {
      msg($('#mic-msg'), `Downloading Chrome's on-device speech model for ${lang}. This happens once and can take a minute…`, 'ok');
      if (await SR.install(options).catch(() => false)) {
        msg($('#mic-msg'), '');
        return (speechLang = lang);
      }
    }
  }
  msg($('#mic-msg'), `Chrome can't transcribe ${candidates.join(' or ')} on this device, so the day review isn't available here.`);
  return null;
}

function createRecognition() {
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = speechLang;
  rec.processLocally = true; // never use the cloud recognizer

  rec.onresult = (ev) => {
    lastResultAt = Date.now();
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (res.isFinal) finalText = (finalText + ' ' + res[0].transcript).replace(/\s+/g, ' ').trim();
      else interim += res[0].transcript;
    }
    interimText = interim.trim();
    render();
  };

  rec.onerror = (ev) => {
    switch (ev.error) {
      case 'no-speech':
      case 'aborted':
        return; // onend restarts
      case 'not-allowed':
      case 'service-not-allowed':
        stop();
        msg($('#mic-msg'), 'Speech recognition was blocked. Allow the microphone for this page and try again.');
        return;
      case 'language-not-supported':
        stop();
        speechLang = null;
        msg($('#mic-msg'), "Chrome's on-device speech model isn't installed for this language. Press Start to download it.");
        return;
      case 'audio-capture':
        stop();
        msg($('#mic-msg'), 'No microphone input. Check your input device.');
        return;
      default:
        msg($('#mic-msg'), `Speech recognition error: ${ev.error}`);
    }
  };

  // Chrome ends continuous sessions after silence or ~a minute; restart while
  // the user still wants to record.
  rec.onend = () => {
    if (interimText) {
      finalText = (finalText + ' ' + interimText).trim();
      interimText = '';
    }
    if (recording) {
      try {
        rec.start();
      } catch {
        setTimeout(() => recording && rec.start(), 300);
      }
    }
    render();
  };
  return rec;
}

async function start() {
  msg($('#mic-msg'), '');
  // Check the model first: installing it needs the click's user activation.
  if (!(await ensureOnDeviceModel())) return;
  if (!(await ensureMicPermission())) return;
  recognition ||= createRecognition();
  recording = true;
  lastResultAt = 0;
  try {
    recognition.start();
  } catch {
    /* already started */
  }
  tickTimer ||= setInterval(tick, TICK_MS);
  render();
}

function stop() {
  recording = false;
  try {
    recognition?.stop();
  } catch {
    /* not running */
  }
  render();
}

function reset() {
  stop();
  finalText = interimText = '';
  speakingMs = recordingMs = 0;
  msg($('#result'), '');
  render();
}

async function submit() {
  stop();
  $('#submit').disabled = true;
  $('#submit').textContent = 'Submitting…';
  try {
    const res = await send('reviewSubmit', {
      transcript: transcript(),
      speakingSeconds: speakingMs / 1000,
      recordingSeconds: recordingMs / 1000,
    });
    if (res.approved) {
      msg($('#result'), `Approved. ${res.reason} Everything is unlocked until midnight.`, 'ok');
      $('#continue').classList.remove('hidden');
    } else {
      msg($('#result'), `Not approved. ${res.reason}`);
    }
  } catch (e) {
    msg($('#result'), e.message);
  }
  $('#submit').textContent = 'Submit review';
  render();
  loadHistory();
}

async function loadHistory() {
  const { reviews } = await send('reviewHistory');
  const box = $('#history');
  box.replaceChildren();
  if (!reviews.length) {
    box.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No reviews yet.' }));
    return;
  }
  for (const r of reviews) {
    const d = document.createElement('details');
    d.className = 'entry';
    const s = document.createElement('summary');
    const pill = Object.assign(document.createElement('span'), {
      className: `pill ${r.approved ? 'free' : 'blocked'}`,
      textContent: r.approved ? 'approved' : 'rejected',
    });
    s.append(
      Object.assign(document.createElement('strong'), { textContent: new Date(r.ts).toLocaleString() }),
      pill,
      Object.assign(document.createElement('span'), {
        className: 'muted small',
        textContent: `${r.words} words · ${r.speakingSeconds}s`,
      })
    );
    const reason = Object.assign(document.createElement('p'), { className: 'small muted', textContent: r.reason });
    const text = Object.assign(document.createElement('p'), { textContent: r.transcript || '(empty)' });
    d.append(s, reason, text);
    box.append(d);
  }
}

function renderAvailability() {
  const r = settings.review;
  const avail = parseHM(r.availableAfter);
  const ok = minutesSinceMidnight(Date.now()) >= avail;
  $('#start').disabled = !ok;
  if (!ok) msg($('#avail'), `The day review opens at ${formatHM(avail)}. Come back then.`);
  else msg($('#avail'), '');
}

$('#start').onclick = start;
$('#stop').onclick = stop;
$('#reset').onclick = reset;
$('#submit').onclick = submit;
$('#continue').onclick = (e) => {
  e.preventDefault();
  if (returnTo === 'settings') location.href = chrome.runtime.getURL('src/options/options.html');
  else if (returnTo && /^https?:/i.test(returnTo)) location.href = returnTo;
  else window.close();
};

(async () => {
  const data = await send('getStatus');
  settings = data.settings;
  $('#goals').textContent = settings.goals.trim() || 'No goal set.';
  renderAvailability();
  setInterval(renderAvailability, 30_000);
  render();
  loadHistory();
})();
