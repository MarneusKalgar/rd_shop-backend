import { CookieOptions } from 'express';

import { isProduction } from '@/utils';

export const REFRESH_COOKIE_NAME = 'refreshToken';
export const UUID_LENGTH = 36;

const API_PREFIX = 'api';
const DEFAULT_VERSION = '1';
const AUTH_PATH = `/${API_PREFIX}/v${DEFAULT_VERSION}/auth`;

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  path: AUTH_PATH,
  sameSite: 'strict',
  secure: isProduction(),
};

/** Build cookie options using the TTL derived from `TokenService.ttlMs` to keep DB expiry and cookie lifetime in sync. */
export const buildRefreshCookieOptions = (maxAge: number): CookieOptions => ({
  ...BASE_COOKIE_OPTIONS,
  maxAge,
});

/** Used when clearing the cookie — path must match the set options */
export const REFRESH_COOKIE_CLEAR_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
};
