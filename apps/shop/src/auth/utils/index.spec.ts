import * as crypto from 'node:crypto';

import { createOpaqueToken, verifyOpaqueToken } from '.';
import { ONE_TIME_TOKEN_SECRET_BYTES, REFRESH_TOKEN_SECRET_BYTES } from '../constants';

const TEST_SECRET = 'test-hmac-secret-32-chars-minimum!';

describe('createOpaqueToken', () => {
  it('returns rawSecret and tokenHash', () => {
    const { rawSecret, tokenHash } = createOpaqueToken(TEST_SECRET);
    expect(typeof rawSecret).toBe('string');
    expect(typeof tokenHash).toBe('string');
  });

  it('rawSecret length = bytes * 2 (hex encoding)', () => {
    const { rawSecret } = createOpaqueToken(TEST_SECRET, REFRESH_TOKEN_SECRET_BYTES);
    expect(rawSecret).toHaveLength(REFRESH_TOKEN_SECRET_BYTES * 2);
  });

  it('rawSecret length = ONE_TIME_TOKEN_SECRET_BYTES * 2 for one-time tokens', () => {
    const { rawSecret } = createOpaqueToken(TEST_SECRET, ONE_TIME_TOKEN_SECRET_BYTES);
    expect(rawSecret).toHaveLength(ONE_TIME_TOKEN_SECRET_BYTES * 2);
  });

  it('tokenHash is always a 64-char HMAC-SHA256 hex string', () => {
    const { tokenHash } = createOpaqueToken(TEST_SECRET);
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens on each call', () => {
    const a = createOpaqueToken(TEST_SECRET);
    const b = createOpaqueToken(TEST_SECRET);
    expect(a.rawSecret).not.toBe(b.rawSecret);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('tokenHash is deterministic given the same rawSecret and hmacSecret', () => {
    const rawSecret = crypto.randomBytes(64).toString('hex');
    const hash1 = crypto.createHmac('sha256', TEST_SECRET).update(rawSecret).digest('hex');
    const hash2 = crypto.createHmac('sha256', TEST_SECRET).update(rawSecret).digest('hex');
    expect(hash1).toBe(hash2);
  });
});

describe('verifyOpaqueToken', () => {
  it('returns true when rawSecret matches storedHash', () => {
    const { rawSecret, tokenHash } = createOpaqueToken(TEST_SECRET);
    expect(verifyOpaqueToken(rawSecret, tokenHash, TEST_SECRET)).toBe(true);
  });

  it('returns false when rawSecret is tampered', () => {
    const { rawSecret, tokenHash } = createOpaqueToken(TEST_SECRET);
    const tampered = rawSecret.slice(0, -1) + (rawSecret.endsWith('a') ? 'b' : 'a');
    expect(verifyOpaqueToken(tampered, tokenHash, TEST_SECRET)).toBe(false);
  });

  it('returns false when hmacSecret differs (wrong key)', () => {
    const { rawSecret, tokenHash } = createOpaqueToken(TEST_SECRET);
    expect(verifyOpaqueToken(rawSecret, tokenHash, TEST_SECRET + '-wrong')).toBe(false);
  });

  it('returns false (not throws) when storedHash is a bcrypt-format string', () => {
    // bcrypt hashes are 60 chars: $2b$10$...
    const bcryptHash = '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
    const { rawSecret } = createOpaqueToken(TEST_SECRET);
    expect(() => verifyOpaqueToken(rawSecret, bcryptHash, TEST_SECRET)).not.toThrow();
    expect(verifyOpaqueToken(rawSecret, bcryptHash, TEST_SECRET)).toBe(false);
  });

  it('returns false (not throws) when storedHash is empty', () => {
    const { rawSecret } = createOpaqueToken(TEST_SECRET);
    expect(verifyOpaqueToken(rawSecret, '', TEST_SECRET)).toBe(false);
  });

  it('returns false when storedHash length is 64 but content does not match', () => {
    const { rawSecret } = createOpaqueToken(TEST_SECRET);
    const wrongHash = '0'.repeat(64);
    expect(verifyOpaqueToken(rawSecret, wrongHash, TEST_SECRET)).toBe(false);
  });
});
