import { isUUID } from 'class-validator';
import * as crypto from 'node:crypto';

import { MIN_RAW_SECRET_LENGTH, REFRESH_TOKEN_SECRET_BYTES, UUID_LENGTH } from '../constants';

/** Length of an HMAC-SHA256 digest encoded as a lowercase hex string. */
const HMAC_HEX_LENGTH = 64;

const DELIMITER = ':';

/**
 * Generates a cryptographically random secret and its HMAC-SHA256 hash.
 *
 * Stateless — accepts `hmacSecret` as a parameter so it can live outside any class.
 * Synchronous: `crypto.randomBytes(N)` for small N reads from the OS entropy pool in <1 µs;
 * `createHmac().digest()` is pure in-process CPU at ~1 µs. Total: ~2 µs — three orders of
 * magnitude below measurable event-loop lag. No promisification needed.
 *
 * @param hmacSecret  Server-side HMAC key (`TOKEN_HMAC_SECRET` env var).
 * @param bytes       Length of the raw secret in bytes (default 64 → 128-char hex string).
 */
export function createOpaqueToken(
  hmacSecret: string,
  bytes = REFRESH_TOKEN_SECRET_BYTES,
): { rawSecret: string; tokenHash: string } {
  const rawSecret = crypto.randomBytes(bytes).toString('hex');
  const tokenHash = crypto.createHmac('sha256', hmacSecret).update(rawSecret).digest('hex');
  return { rawSecret, tokenHash };
}

export function parseOpaqueToken(token: string): null | { rawSecret: string; tokenId: string } {
  if (token.length <= UUID_LENGTH) return null;
  if (token[UUID_LENGTH] !== DELIMITER) return null;

  const tokenId = token.substring(0, UUID_LENGTH);
  if (!isUUID(tokenId)) return null;

  const rawSecret = token.substring(UUID_LENGTH + 1);
  if (rawSecret.length < MIN_RAW_SECRET_LENGTH) return null;

  return { rawSecret, tokenId };
}

/**
 * Verifies a raw secret against a stored HMAC-SHA256 hash using constant-time comparison.
 *
 * Returns `false` (not throws) when `storedHash` is not HMAC format — this handles the
 * post-B5 migration window where legacy bcrypt hashes still exist in the DB.
 * Callers are responsible for mapping `false` to the appropriate HTTP error.
 *
 * @param rawSecret   The plain-text secret from the user-supplied token.
 * @param storedHash  The hash stored in the DB column.
 * @param hmacSecret  Server-side HMAC key (`TOKEN_HMAC_SECRET` env var).
 */
export function verifyOpaqueToken(
  rawSecret: string,
  storedHash: string,
  hmacSecret: string,
): boolean {
  if (storedHash.length !== HMAC_HEX_LENGTH) return false;
  const candidateHash = crypto.createHmac('sha256', hmacSecret).update(rawSecret).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
}
