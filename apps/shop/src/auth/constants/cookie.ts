import { CookieOptions } from 'express';

import { isProduction } from '@/utils';

export const REFRESH_COOKIE_NAME = 'refreshToken';

const API_PREFIX = 'api';
const DEFAULT_VERSION = '1';
const AUTH_PATH = `/${API_PREFIX}/v${DEFAULT_VERSION}/auth`;

const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  path: AUTH_PATH,
  sameSite: 'strict',
  secure: isProduction(),
};

export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** Used when clearing the cookie — path must match the set options */
export const REFRESH_COOKIE_CLEAR_OPTIONS: CookieOptions = {
  ...BASE_COOKIE_OPTIONS,
};
