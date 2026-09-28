/**
 * FocusGate partner-email backend (Google Apps Script web app).
 *
 * Sends the unlock code to your accountability partner from your own Gmail
 * using MailApp. No API keys live in the extension; the only credential is a
 * shared secret that stops strangers from using this endpoint.
 *
 * Script properties (Project Settings -> Script properties):
 *   SHARED_SECRET  required  long random string; paste the same value into FocusGate settings
 *   PARTNER_EMAIL  optional  if set, codes ALWAYS go here, whatever the extension sends
 *                            (so changing the email in the extension can't redirect codes to you)
 *   MAX_PER_DAY    optional  server-side daily cap (default 3)
 *
 * Deploy -> New deployment -> Web app; Execute as: Me; Who has access: Anyone.
 */

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var secret = props.getProperty('SHARED_SECRET');
    if (!secret) return json_({ ok: false, error: 'server_not_configured: set SHARED_SECRET' });
    if (!safeEqual_(String(body.secret || ''), secret)) return json_({ ok: false, error: 'unauthorized' });

    var to = props.getProperty('PARTNER_EMAIL') || String(body.to || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json_({ ok: false, error: 'bad_recipient' });
    var code = String(body.code || '');
    if (!/^\d{6}$/.test(code)) return json_({ ok: false, error: 'bad_code' });

    var max = Number(props.getProperty('MAX_PER_DAY') || 3);
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var key = 'count_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var count = Number(props.getProperty(key) || 0);
      if (count >= max) return json_({ ok: false, error: 'rate_limited: ' + max + ' requests per day' });

      var site = clip_(body.site, 200) || 'a blocked site';
      var reason = clip_(body.reason, 1000) || '(no reason given)';
      var partnerName = clip_(body.partnerName, 100);
      var minutes = Number(body.expiresMinutes) || 30;

      MailApp.sendEmail({
        to: to,
        subject: 'FocusGate unlock request: ' + site,
        name: 'FocusGate',
        body:
          (partnerName ? 'Hi ' + partnerName + ',\n\n' : 'Hi,\n\n') +
          'Your friend is asking to unlock ' + site + '.\n\n' +
          'Their reason:\n  "' + reason + '"\n\n' +
          'If you agree, send them this code (valid for ' + minutes + ' minutes):\n\n' +
          '    ' + code + '\n\n' +
          "If you don't think it's a good idea, just don't send it.\n\n" +
          '(Sent by the FocusGate Chrome extension. At most ' + max + ' requests per day.)',
      });

      props.setProperty(key, String(count + 1));
      cleanupOldCounts_(props, key);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Health check: open the /exec URL in a browser. */
function doGet() {
  return json_({ ok: true, service: 'focusgate-mailer' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clip_(v, n) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cleanupOldCounts_(props, keep) {
  var all = props.getProperties();
  for (var k in all) if (k.indexOf('count_') === 0 && k !== keep) props.deleteProperty(k);
}

/** Run once from the editor to authorise MailApp and send yourself a test. */
function testSend() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'FocusGate test', 'MailApp is authorised.');
}
