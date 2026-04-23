/**
 * k6 load test — Token Refresh Stress
 *
 * Measures the cheap JWT-verify path (POST /auth/refresh) at 30 VUs.
 * Tokens are pre-obtained in setup() sequentially so bcrypt never runs
 * during the measured phase — giving an uncontaminated refresh latency.
 *
 * For bcrypt saturation testing see signin-stress.js.
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
 * Thresholds (baseline):
 *   POST /auth/refresh p(95) < 200ms  (JWT verify + DB token lookup)
 *   http_req_failed    < 1%
 *
 * After B1 (bcrypt rounds env-var tuning), refresh should be unaffected.
 * After B2 (index on refresh_tokens.token), tighten refresh p(95) to 50ms.
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
    // Baseline: each refresh does 2 bcrypt ops (compare old + hash new token).
    // At 30 VUs × 2 bcrypt ops on 0.5 CPU, thread pool saturates → ~13s avg.
    // After B1 (bcryptjs, non-blocking): tighten to p(95) < 8000ms.
    // After B5 (HMAC replaces bcrypt for tokens): tighten to p(95) < 200ms.
    'http_req_duration{name:auth_refresh}': ['p(95)<25000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'auth_stress' },
};

// ---------------------------------------------------------------------------
// setup() — runs once before VUs start, single-threaded
// Sign in each of the VUS users sequentially so bcrypt never contends.
// Returns array of { accessToken, refreshToken } indexed by VU.
// ---------------------------------------------------------------------------
export function setup() {
  const tokens = [];
  for (let i = 0; i < VUS; i++) {
    const userIndex = (i % USER_COUNT) + 1; // 1-indexed
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

// Module-level per-VU state — each VU has its own JS runtime in k6 so these
// are isolated per VU and persist across iterations (unlike local variables
// inside default() which reset every call).
let accessToken = null;
let refreshToken = null;

export default function (tokens) {
  // Initialize from setup data on first iteration only
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

    // Rotate tokens for next iteration
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
