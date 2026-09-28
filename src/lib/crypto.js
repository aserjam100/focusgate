// Partner-code hashing. A 6-digit code has only 10^6 possibilities, so a plain
// SHA-256 hash can be brute-forced from DevTools in well under a second.
// PBKDF2-HMAC-SHA256 with a random salt and 2M iterations costs ~0.2 s per
// guess on a modern laptop core, so an exhaustive search takes hours even
// across all cores, longer than the code's default 30-minute lifetime.
// It raises the bar; it is not a guarantee (see README "Limitations").

export const PBKDF2_ITERATIONS = 2_000_000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}

export function randomCode() {
  // Rejection sampling avoids modulo bias.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

export async function hashCode(code, saltHex, iterations = PBKDF2_ITERATIONS) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { salt: toHex(salt), hash: toHex(bits), iterations };
}

export async function verifyCode(code, { salt, hash, iterations }) {
  const got = await hashCode(String(code).trim(), salt, iterations);
  // Constant-time compare of hex strings.
  let diff = got.hash.length ^ hash.length;
  for (let i = 0; i < Math.min(got.hash.length, hash.length); i++) diff |= got.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
