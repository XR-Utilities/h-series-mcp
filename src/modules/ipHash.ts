// Caller-IP privacy for the public audit plane. The raw client IP is a personal
// identifier and MUST NEVER leave this process onto the shared, world-readable SIEM
// audit topic. What goes on the public plane is a one-way, salted keyed hash: an
// operator with the salt can correlate repeat callers (rate-abuse, a noisy agent)
// without the topic exposing anyone's address. The raw IP stays in the stderr op-log
// only (logger.ts), which is the local operator surface, not the chain.
//
// The salt (AUDIT_IP_HASH_SALT) is a secret: without it the hash is HMAC-keyed by a
// per-process random value, so hashes are NOT correlatable across restarts and NEVER
// reversible by dictionary attack over the small IPv4 space. Set the salt in the
// deploy env to get stable cross-restart correlation.
import { createHmac, randomBytes } from "node:crypto";

// Per-process fallback key. Generated once at module load so that, with no configured
// salt, the public hash is still keyed (a bare sha256 of an IPv4 is trivially reversible
// by enumerating the 2^32 space) but not stable across restarts.
const FALLBACK_KEY = randomBytes(32).toString("hex");

function hmacKey(): string {
  return process.env["AUDIT_IP_HASH_SALT"] || FALLBACK_KEY;
}

/**
 * Truncate an IP to its network prefix so the public plane carries a coarse locality
 * (a /24 for IPv4, a /48 for IPv6) rather than a single host. Returns "unknown" for an
 * unparseable value. This is the human-readable half of the public field; the HMAC below
 * is the correlatable half.
 */
export function truncateIp(ip: string): string {
  if (!ip) return "unknown";
  // Normalize an IPv4-mapped IPv6 address (::ffff:1.2.3.4) to its IPv4 form.
  const v4mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  const addr = v4mapped ? v4mapped[1]! : ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
    const parts = addr.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (addr.includes(":")) {
    // IPv6: keep the first three hextets (the /48 routing prefix), drop the interface id.
    const segs = addr.split(":");
    return `${segs.slice(0, 3).join(":")}::/48`;
  }
  return "unknown";
}

/**
 * Salted, keyed, one-way hash of the caller IP for the public audit plane. Truncated to
 * 16 hex chars: enough to distinguish callers for abuse correlation, short enough to keep
 * the audit field compact and to not present as a full crypto digest. NEVER the raw IP.
 */
export function hashIp(ip: string): string {
  if (!ip) return "unknown";
  return createHmac("sha256", hmacKey()).update(ip).digest("hex").slice(0, 16);
}
