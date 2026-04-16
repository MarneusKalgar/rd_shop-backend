/**
 * k6 load test — Token Refresh Stress — AFTER B5
 *
 * B5 fix: replaced bcrypt with HMAC-SHA256 (keyed on TOKEN_HMAC_SECRET) for
 * all opaque token operations — refresh, verification, and password-reset tokens.
 *
 * The refresh endpoint previously ran 2 bcrypt ops (~100 ms each):
 *   1. bcrypt.compare(rawSecret, storedHash)   — validate incoming token
 *   2. bcrypt.hash(newRawSecret, saltRounds)   — issue new token
 *
 * After B5 those are:
 *   1. HMAC-SHA256 verify  (~1 µs, constant-time)
 *   2. HMAC-SHA256 create  (~1 µs, synchronous)
 *
 * p(95) drops from ~25 000 ms (baseline) → ~8 000 ms (after B1 / bcryptjs)
 *                                         → <200 ms (after B5 / HMAC).
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
 *   npm run perf:after:auth:b5   (from apps/shop/)
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
    // After B5: token ops are HMAC-SHA256 (~1 µs each).
    // Remaining cost: DB row lookup + DB update + JWT sign.
    // At 30 VUs, p(95) should be well under 200 ms.
    'http_req_duration{name:auth_refresh}': ['p(95)<200', 'p(99)<23000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'auth_refresh_after_b5' },
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
