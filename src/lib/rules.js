// declarativeNetRequest rule construction. One dynamic rule per fully blocked
// site. `requestDomains` matches the domain and every subdomain.

export const BLOCK_PAGE_PATH = '/src/block/block.html';

export function buildRules(status, extensionOrigin) {
  const blocked = Object.values(status.sites)
    .filter((s) => s.blocked)
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return blocked.map((s, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        // \0 = the whole original URL. It is placed last so the block page can
        // take everything after "&url=" without needing it to be encoded.
        regexSubstitution: `${extensionOrigin}${BLOCK_PAGE_PATH}?site=${encodeURIComponent(s.domain)}&url=\\0`,
      },
    },
    condition: {
      regexFilter: '^.+$',
      requestDomains: [s.domain],
      resourceTypes: ['main_frame'],
    },
  }));
}
