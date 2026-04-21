import { config, projectPrefix } from '../bootstrap';

const defaultCloudMapNamespaceName = `${projectPrefix}.local`;
const defaultDesiredCount = 1;
const defaultImageTag = 'latest';

export interface ComputeServicesConfig {
  cloudMapNamespaceName: string;
  paymentsDesiredCount: number;
  paymentsImageTag: string;
  paymentsImageUri?: string;
  shopDesiredCount: number;
  shopImageTag: string;
  shopImageUri?: string;
}

export function getComputeServicesConfig(): ComputeServicesConfig {
  const cloudMapNamespaceName = config.get('cloudMapNamespaceName') ?? defaultCloudMapNamespaceName;
  const shopDesiredCount = config.getNumber('shopDesiredCount') ?? defaultDesiredCount;
  const paymentsDesiredCount = config.getNumber('paymentsDesiredCount') ?? defaultDesiredCount;
  const shopImageTag = config.get('shopImageTag') ?? defaultImageTag;
  const paymentsImageTag = config.get('paymentsImageTag') ?? defaultImageTag;
  const shopImageUri = normalizeOptionalValue(config.get('shopImageUri'));
  const paymentsImageUri = normalizeOptionalValue(config.get('paymentsImageUri'));

  validateDesiredCount('shopDesiredCount', shopDesiredCount);
  validateDesiredCount('paymentsDesiredCount', paymentsDesiredCount);
  validateDnsName('cloudMapNamespaceName', cloudMapNamespaceName);
  validateTag('shopImageTag', shopImageTag);
  validateTag('paymentsImageTag', paymentsImageTag);

  return {
    cloudMapNamespaceName,
    paymentsDesiredCount,
    paymentsImageTag,
    paymentsImageUri,
    shopDesiredCount,
    shopImageTag,
    shopImageUri,
  };
}

function normalizeOptionalValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function validateDesiredCount(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function validateDnsName(label: string, value: string) {
  if (!/^[a-z0-9.-]+$/.test(value) || !value.includes('.')) {
    throw new Error(`${label} must look like a valid private DNS zone, e.g. rd-shop.local.`);
  }
}

function validateTag(label: string, value: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
}
