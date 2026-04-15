/**
 * k6 load test — Token Refresh Stress — AFTER B1
 *
 * B1 fix: switched from native `bcrypt` to `bcryptjs`.
 * bcryptjs is pure JS and yields to the event loop after each round
 * (via setImmediate), so concurrent refresh requests interleave rather
 * than queue behind blocked libuv threads.
 *
 * The refresh endpoint runs 2 bcrypt ops:
 *   1. bcrypt.compare(rawSecret, storedHash)   — validate old token
 *   2. bcrypt.hash(newRawSecret, saltRounds)   — issue new token
 *
 * Baseline (auth-flow.js):  p(95) < 25 000 ms — native bcrypt saturates 4 libuv threads
 * After B1 (this file):     p(95) <  8 000 ms — bcryptjs non-blocking; event loop freed
 * After B5 (auth-flow-after-b5.js): p(95) < 200 ms — HMAC replaces bcrypt for tokens entirely
 *
 * Pre-requisites:
 *   - 100 users seeded with password "Perf@12345"
 *     emails: perf-user-1@test.local … perf-user-100@test.local
 *
 * Environment variables:
 *   BASE_URL          — default http://localhost:8090
 *   PERF_K6_VUS       — default 30
 *   PERF_K6_DURATION  — default "30s"
 *
 * Run:
 *   npm run perf:after:auth:b1   (from apps/shop/)
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8090';
const VUS = parseInt(__ENV.PERF_K6_VUS || '30', 10);
const DURATION = __ENV.PERF_K6_DURATION || '30s';
const USER_COUNT = 100;
const PASSWORD = 'Perf@12345';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('custom_error_rate');
const refreshLatency = new Trend('custom_refresh_latency', true);

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // After B1: bcryptjs yields between rounds → event loop freed.
    // Still 2 bcrypt ops per refresh but no thread-pool saturation.
    // Baseline was p(95)<25000; after B1 drops to <8000.
    // After B5 (HMAC) this tightens further to <200ms.
    'http_req_duration{name:auth_refresh}': ['p(95)<8000', 'p(99)<35000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'auth_refresh_after_b1' },
};

// ---------------------------------------------------------------------------
// setup() — sign in each VU sequentially before load phase begins
// ---------------------------------------------------------------------------
export function setup() {
  const tokens = [];
  for (let i = 0; i < VUS; i++) {
    const userIndex = (i % USER_COUNT) + 1;
    const email = `perf-user-${userIndex}@test.local`;
    const res = http.post(
      `${BASE_URL}/api/v1/auth/signin`,
      JSON.stringify({ email, password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status === 200) {
      const body = JSON.parse(res.body);
      const refreshCookie = res.cookies['refreshToken'];
      tokens.push({
        accessToken: body.accessToken,
        refreshToken: refreshCookie && refreshCookie[0] ? refreshCookie[0].value : null,
      });
    } else {
      tokens.push({ accessToken: null, refreshToken: null });
    }
  }
  return tokens;
}

let accessToken = null;
let refreshToken = null;

export default function (tokens) {
  if (!accessToken || !refreshToken) {
    const seed = tokens[__VU - 1] || {};
    accessToken = seed.accessToken || null;
    refreshToken = seed.refreshToken || null;
  }

  if (!accessToken || !refreshToken) {
    return;
  }

  group('auth_refresh', () => {
    const res = http.post(`${BASE_URL}/api/v1/auth/refresh`, null, {
      tags: { name: 'auth_refresh' },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Cookie: `refreshToken=${refreshToken}`,
      },
    });

    const ok = check(res, {
      'refresh 200': (r) => r.status === 200,
      'new accessToken': (r) => {
        try {
          return Boolean(JSON.parse(r.body).accessToken);
        } catch {
          return false;
        }
      },
    });

    refreshLatency.add(res.timings.duration);
    errorRate.add(!ok);

    if (ok) {
      try {
        const b = JSON.parse(res.body);
        if (b.accessToken) accessToken = b.accessToken;
        const newCookie = res.cookies['refreshToken'];
        if (newCookie && newCookie[0]) refreshToken = newCookie[0].value;
      } catch {
        // noop
      }
    }
  });

  sleep(0.1);
}
