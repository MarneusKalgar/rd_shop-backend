/**
 * Perf scenario: HMAC token ops — AFTER B5
 *
 * Validates two things:
 *   1. Latency — 100 sequential POST /auth/refresh calls complete with
 *      mean latency < 20 ms per call (vs ~100 ms with bcryptjs).
 *      Remaining cost is DB lookup + DB update + JWT sign; HMAC itself is ~1 µs.
 *   2. Security — a tampered rawSecret (one hex char flipped) is rejected
 *      with 401. Guards against accidental weakening of the HMAC verify path.
 *
 * Baseline (before B5): each refresh = 2 bcrypt ops ≈ 200 ms token work alone.
 * After B5:             each refresh = 2 HMAC ops   ≈   2 µs token work.
 *
 * Run: npm run test:perf (from apps/shop/)
 */
import {
  bootstrapPerfTest,
  PerfTestContext,
  savePerfResults,
  teardownPerfTest,
} from '@test/performance/helpers/bootstrap';
import request from 'supertest';

import { seedUsers } from '@/db/perf-seed/generate-users';

const USER_EMAIL = 'perf-user-1@test.local';
const USER_PASSWORD = 'Perf@12345';
/** Low rounds — only for the seeding step; measurement is the refresh loop, not signin. */
const SEED_SALT_ROUNDS = 1;
const REFRESH_ITERATIONS = 100;

let ctx: PerfTestContext;
/**
 * Holds the `name=value` segment of the current refresh cookie (no attributes).
 * Rotated after every successful refresh so each request sends a live token.
 */
let currentCookie: string;

/**
 * Extracts just the `refreshToken=<encoded-value>` segment from a Set-Cookie header.
 * Strips Path / HttpOnly / SameSite attributes — those are irrelevant for Cookie headers.
 * The encoded value is kept as-is; cookie-parser on the server decodes it automatically.
 */
function extractRefreshCookie(rawSetCookie: unknown): string {
  const arr = Array.isArray(rawSetCookie)
    ? (rawSetCookie as string[])
    : rawSetCookie
      ? [rawSetCookie as string]
      : [];
  return arr.find((c) => c.startsWith('refreshToken='))?.split(';')[0] ?? '';
}

describe('[After B5] HMAC token ops — refresh latency and tamper rejection', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedUsers(ctx.dataSource, 1, SEED_SALT_ROUNDS);

    const signinRes = await request(ctx.app.getHttpServer() as unknown as string)
      .post('/api/v1/auth/signin')
      .send({ email: USER_EMAIL, password: USER_PASSWORD });

    expect(signinRes.status).toBe(200);

    currentCookie = extractRefreshCookie(signinRes.headers['set-cookie']);
    expect(currentCookie).not.toBe('');
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it(`${REFRESH_ITERATIONS} sequential refreshes complete with mean < 20 ms`, async () => {
    const start = Date.now();

    for (let i = 0; i < REFRESH_ITERATIONS; i++) {
      const res = await request(ctx.app.getHttpServer() as unknown as string)
        .post('/api/v1/auth/refresh')
        .set('Cookie', currentCookie);

      expect(res.status).toBe(200);

      // Each successful refresh issues a new token and revokes the old one.
      // Rotate currentCookie so the next iteration sends the live token.
      const next = extractRefreshCookie(res.headers['set-cookie']);
      if (next) currentCookie = next;
    }

    const totalMs = Date.now() - start;
    const meanMs = totalMs / REFRESH_ITERATIONS;

    savePerfResults('token-hmac-refresh-latency', [
      { iterations: REFRESH_ITERATIONS, mean_ms: meanMs.toFixed(2), total_ms: String(totalMs) },
    ]);
    console.table([
      { metric: 'iterations', value: REFRESH_ITERATIONS },
      { metric: 'total_ms', value: totalMs },
      { metric: 'mean_ms', value: meanMs.toFixed(2) },
    ]);

    // If HMAC regresses to bcrypt the mean jumps to ~100 ms; 20 ms catches that.
    expect(meanMs).toBeLessThan(20);
  });

  it('tampered rawSecret is rejected with 401', async () => {
    // currentCookie holds the last valid token from the latency test (not yet consumed).
    // Express encodes the cookie value with encodeURIComponent: uuid%3Ahex
    const encodedVal = currentCookie.replace('refreshToken=', '');
    const decoded = decodeURIComponent(encodedVal);
    const colonIdx = decoded.indexOf(':');
    const tokenId = decoded.slice(0, colonIdx);
    const rawSecret = decoded.slice(colonIdx + 1);

    // Flip the last hex char — syntactically valid but HMAC will not match.
    const flipped = rawSecret.slice(0, -1) + (rawSecret.at(-1) === 'a' ? 'b' : 'a');
    const tamperedCookie = `refreshToken=${encodeURIComponent(`${tokenId}:${flipped}`)}`;

    const res = await request(ctx.app.getHttpServer() as unknown as string)
      .post('/api/v1/auth/refresh')
      .set('Cookie', tamperedCookie);

    // verifyOpaqueToken returns false → service throws UnauthorizedException
    expect(res.status).toBe(401);
  });
});
