import { config, stack } from './bootstrap';

const defaultProductionApiSubdomain = 'api';

export interface PublicDomainConfig {
  apiDomainName: string;
  hostedZoneId?: string;
  rootDomainName: string;
}

/**
 * Step 2.4-2.5 domain helper.
 * Accepts the configured root domain name.
 * Returns the default API hostname for the current stack, using `api.` in production and `api-<stack>.` elsewhere.
 */
export function buildPublicApiDomainName(rootDomainName: string) {
  return stack === 'production'
    ? `${defaultProductionApiSubdomain}.${rootDomainName}`
    : `${defaultProductionApiSubdomain}-${stack}.${rootDomainName}`;
}

/**
 * Step 2.4-2.5 domain helper.
 * Accepts the configured root domain name.
 * Returns the HTTPS API URL derived from the stack-aware public API domain.
 */
export function buildPublicApiUrl(rootDomainName: string) {
  return `https://${buildPublicApiDomainName(rootDomainName)}`;
}

/**
 * Step 2.4-2.5 domain config helper.
 * Accepts no arguments.
 * Resolves the optional public-domain configuration, validates it, and returns the normalized values used by edge provisioning.
 */
export function getPublicDomainConfig(): PublicDomainConfig | undefined {
  const rootDomainName = normalizeDomain(config.get('publicRootDomainName'));

  if (!rootDomainName) {
    return undefined;
  }

  const apiDomainName =
    normalizeDomain(config.get('publicApiDomainName')) ?? buildPublicApiDomainName(rootDomainName);
  const hostedZoneId = normalizeOptionalValue(config.get('publicHostedZoneId'));

  validateRootDomainName(rootDomainName);
  validateApiDomainName(apiDomainName, rootDomainName);
  validateHostedZoneId(hostedZoneId);

  return {
    apiDomainName,
    hostedZoneId,
    rootDomainName,
  };
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts a candidate domain string.
 * Returns whether the value looks like a valid fully qualified domain name.
 */
function isDomainName(value: string) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

/**
 * Step 2.4-2.5 normalization helper.
 * Accepts an optional domain string from config.
 * Returns the trimmed, lower-cased domain without a trailing dot, or `undefined` when empty.
 */
function normalizeDomain(value: string | undefined) {
  const normalizedValue = normalizeOptionalValue(value)?.replace(/\.$/, '');
  return normalizedValue?.toLowerCase();
}

/**
 * Step 2.4-2.5 normalization helper.
 * Accepts an optional raw config value.
 * Returns the trimmed string when present, otherwise `undefined`.
 */
function normalizeOptionalValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the resolved API domain name and root domain name.
 * Throws when the API hostname is not a valid subdomain of the configured root domain.
 */
function validateApiDomainName(apiDomainName: string, rootDomainName: string) {
  if (!isDomainName(apiDomainName)) {
    throw new Error('publicApiDomainName must be a valid fully qualified domain name.');
  }

  if (apiDomainName === rootDomainName || !apiDomainName.endsWith(`.${rootDomainName}`)) {
    throw new Error('publicApiDomainName must be a subdomain of publicRootDomainName.');
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the optional hosted zone id override.
 * Throws when the value does not resemble a Route 53 hosted zone id.
 */
function validateHostedZoneId(hostedZoneId: string | undefined) {
  if (!hostedZoneId) {
    return;
  }

  if (!/^Z[A-Z0-9]+$/i.test(hostedZoneId)) {
    throw new Error('publicHostedZoneId must look like a valid Route 53 hosted zone ID.');
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the normalized root domain name.
 * Throws when the configured public root domain is malformed or not registrable.
 */
function validateRootDomainName(rootDomainName: string) {
  if (!isDomainName(rootDomainName)) {
    throw new Error('publicRootDomainName must be a valid domain name.');
  }

  if (rootDomainName.split('.').length < 2) {
    throw new Error(
      'publicRootDomainName must include a registrable root domain, e.g. example.com.',
    );
  }
}
