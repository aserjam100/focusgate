// Pluggable partner-email senders. An extension cannot send email by itself,
// so each sender POSTs to a small backend that holds the mail credentials.
// To add a provider, add an entry here and select it in settings.

export const SENDERS = {
  /**
   * Google Apps Script web app (backend/apps-script/Code.gs). Sends from the
   * script owner's Gmail via MailApp. Uses text/plain to avoid a CORS
   * preflight, which Apps Script can't answer.
   */
  'apps-script': async (cfg, message, fetchImpl) => {
    const res = await fetchImpl(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: cfg.secret, ...message }),
      redirect: 'follow',
    });
    return parseJsonResponse(res);
  },

  /** Any HTTPS endpoint accepting the same JSON (e.g. your own Worker). */
  webhook: async (cfg, message, fetchImpl) => {
    const res = await fetchImpl(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify(message),
    });
    return parseJsonResponse(res);
  },
};

async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Email backend returned non-JSON (HTTP ${res.status}). Check the endpoint URL and that the script is deployed with access "Anyone".`);
  }
  if (!res.ok || !data.ok) throw new Error(`Email backend error: ${data.error || 'HTTP ' + res.status}`);
  return data;
}

/**
 * @param partner settings.partner
 * @param message { to, partnerName, site, reason, code, expiresMinutes }
 */
export async function sendPartnerEmail(partner, message, fetchImpl = fetch) {
  const sender = SENDERS[partner.sender] || SENDERS['apps-script'];
  if (!partner.endpoint) throw new Error('No email backend URL configured in settings.');
  return sender(partner, message, fetchImpl);
}
