import { config, stack } from './bootstrap';

const defaultProductionApiSubdomain = 'api';

export interface PublicDomainConfig {
  apiDomainName: string;
  hostedZoneId?: string;
  rootDomainName: string;
}

export function buildPublicApiDomainName(rootDomainName: string) {
  return stack === 'production'
    ? `${defaultProductionApiSubdomain}.${rootDomainName}`
    : `${defaultProductionApiSubdomain}-${stack}.${rootDomainName}`;
}

export function buildPublicApiUrl(rootDomainName: string) {
  return `https://${buildPublicApiDomainName(rootDomainName)}`;
}

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

function isDomainName(value: string) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function normalizeDomain(value: string | undefined) {
  const normalizedValue = normalizeOptionalValue(value)?.replace(/\.$/, '');
  return normalizedValue?.toLowerCase();
}

function normalizeOptionalValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

function validateApiDomainName(apiDomainName: string, rootDomainName: string) {
  if (!isDomainName(apiDomainName)) {
    throw new Error('publicApiDomainName must be a valid fully qualified domain name.');
  }

  if (apiDomainName === rootDomainName || !apiDomainName.endsWith(`.${rootDomainName}`)) {
    throw new Error('publicApiDomainName must be a subdomain of publicRootDomainName.');
  }
}

function validateHostedZoneId(hostedZoneId: string | undefined) {
  if (!hostedZoneId) {
    return;
  }

  if (!/^Z[A-Z0-9]+$/i.test(hostedZoneId)) {
    throw new Error('publicHostedZoneId must look like a valid Route 53 hosted zone ID.');
  }
}

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
