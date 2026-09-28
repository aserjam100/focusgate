// Domain normalisation and matching. A configured domain always covers its
// subdomains (reddit.com matches www., old., m.reddit.com).

export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
  let host;
  try {
    host = new URL(s).hostname; // also punycodes IDNs
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) return null;
  return host;
}

export function hostMatches(host, domain) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith('.' + domain);
}

/** Most specific configured domain that matches `host`, or null. */
export function findDomainForHost(host, domains) {
  let best = null;
  for (const d of domains) {
    if (hostMatches(host, d) && (!best || d.length > best.length)) best = d;
  }
  return best;
}

export function matchPatterns(domain) {
  // "*.example.com" also matches example.com itself in Chrome match patterns.
  return [`*://*.${domain}/*`];
}
