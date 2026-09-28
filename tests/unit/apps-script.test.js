// Runs backend/apps-script/Code.gs in a VM with mocked Apps Script services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../../backend/apps-script/Code.gs', import.meta.url), 'utf8');

function sandbox(props = {}) {
  const store = { ...props };
  const sent = [];
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => (store[k] = v),
        deleteProperty: (k) => delete store[k],
        getProperties: () => ({ ...store }),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    MailApp: { sendEmail: (m) => sent.push(m) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, sent, store };
}

const good = { secret: 's3cret', to: 'friend@example.com', code: '042917', site: 'reddit.com', reason: 'Need a thread for work', partnerName: 'Sam', expiresMinutes: 30 };

test('sends the code to the partner with the reason', () => {
  const { post, sent } = sandbox({ SHARED_SECRET: 's3cret' });
  assert.deepEqual(post(good), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'friend@example.com');
  assert.match(sent[0].subject, /reddit\.com/);
  assert.match(sent[0].body, /042917/);
  assert.match(sent[0].body, /Need a thread for work/);
  assert.match(sent[0].body, /Hi Sam/);
});

test('rejects a wrong or missing secret, and unconfigured servers', () => {
  assert.equal(sandbox({ SHARED_SECRET: 's3cret' }).post({ ...good, secret: 'nope' }).error, 'unauthorized');
  assert.match(sandbox({}).post(good).error, /server_not_configured/);
});

test('PARTNER_EMAIL overrides the recipient sent by the extension', () => {
  const { post, sent } = sandbox({ SHARED_SECRET: 's3cret', PARTNER_EMAIL: 'real@friend.com' });
  post({ ...good, to: 'me-myself@example.com' });
  assert.equal(sent[0].to, 'real@friend.com');
});

test('server-side daily rate limit', () => {
  const { post, sent } = sandbox({ SHARED_SECRET: 's3cret' });
  for (let i = 0; i < 3; i++) assert.equal(post(good).ok, true);
  assert.match(post(good).error, /rate_limited/);
  assert.equal(sent.length, 3);
});

test('validates code and recipient', () => {
  const { post } = sandbox({ SHARED_SECRET: 's3cret' });
  assert.equal(post({ ...good, code: '12ab56' }).error, 'bad_code');
  assert.equal(post({ ...good, to: 'not-an-email' }).error, 'bad_recipient');
});
