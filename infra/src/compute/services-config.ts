import { config, projectPrefix } from '../bootstrap';
import { getFoundationComputeConfig } from './compute-config';

const defaultCloudMapNamespaceName = `${projectPrefix}.local`;
const defaultDesiredCount = 1;
const defaultImageTag = 'latest';
const constrainedDeploymentMaximumPercent = 100;
const constrainedDeploymentMinimumHealthyPercent = 0;
const defaultShopHealthCheckGracePeriodSeconds = 120;
const rollingDeploymentMaximumPercent = 200;
const rollingDeploymentMinimumHealthyPercent = 100;

export interface ComputeServicesConfig {
  cloudMapNamespaceName: string;
  paymentsDeploymentMaximumPercent: number;
  paymentsDeploymentMinimumHealthyPercent: number;
  paymentsDesiredCount: number;
  paymentsImageTag: string;
  paymentsImageUri?: string;
  shopDeploymentMaximumPercent: number;
  shopDeploymentMinimumHealthyPercent: number;
  shopDesiredCount: number;
  shopHealthCheckGracePeriodSeconds: number;
  shopImageTag: string;
  shopImageUri?: string;
}

export function getComputeServicesConfig(): ComputeServicesConfig {
  const defaultDeploymentSettings = getDefaultDeploymentSettings();
  const cloudMapNamespaceName = config.get('cloudMapNamespaceName') ?? defaultCloudMapNamespaceName;
  const paymentsDeploymentMaximumPercent =
    config.getNumber('paymentsDeploymentMaximumPercent') ??
    defaultDeploymentSettings.maximumPercent;
  const paymentsDeploymentMinimumHealthyPercent =
    config.getNumber('paymentsDeploymentMinimumHealthyPercent') ??
    defaultDeploymentSettings.minimumHealthyPercent;
  const shopDesiredCount = config.getNumber('shopDesiredCount') ?? defaultDesiredCount;
  const shopDeploymentMaximumPercent =
    config.getNumber('shopDeploymentMaximumPercent') ?? defaultDeploymentSettings.maximumPercent;
  const shopDeploymentMinimumHealthyPercent =
    config.getNumber('shopDeploymentMinimumHealthyPercent') ??
    defaultDeploymentSettings.minimumHealthyPercent;
  const shopHealthCheckGracePeriodSeconds =
    config.getNumber('shopHealthCheckGracePeriodSeconds') ??
    defaultShopHealthCheckGracePeriodSeconds;
  const paymentsDesiredCount = config.getNumber('paymentsDesiredCount') ?? defaultDesiredCount;
  const shopImageTag = config.get('shopImageTag') ?? defaultImageTag;
  const paymentsImageTag = config.get('paymentsImageTag') ?? defaultImageTag;
  const shopImageUri = normalizeOptionalValue(config.get('shopImageUri'));
  const paymentsImageUri = normalizeOptionalValue(config.get('paymentsImageUri'));

  validateDesiredCount('shopDesiredCount', shopDesiredCount);
  validateDesiredCount('paymentsDesiredCount', paymentsDesiredCount);
  validateDeploymentPercentages(
    'shop',
    shopDeploymentMinimumHealthyPercent,
    shopDeploymentMaximumPercent,
  );
  validateDeploymentPercentages(
    'payments',
    paymentsDeploymentMinimumHealthyPercent,
    paymentsDeploymentMaximumPercent,
  );
  validateDnsName('cloudMapNamespaceName', cloudMapNamespaceName);
  validateGracePeriod('shopHealthCheckGracePeriodSeconds', shopHealthCheckGracePeriodSeconds);
  validateTag('shopImageTag', shopImageTag);
  validateTag('paymentsImageTag', paymentsImageTag);

  return {
    cloudMapNamespaceName,
    paymentsDeploymentMaximumPercent,
    paymentsDeploymentMinimumHealthyPercent,
    paymentsDesiredCount,
    paymentsImageTag,
    paymentsImageUri,
    shopDeploymentMaximumPercent,
    shopDeploymentMinimumHealthyPercent,
    shopDesiredCount,
    shopHealthCheckGracePeriodSeconds,
    shopImageTag,
    shopImageUri,
  };
}

function getDefaultDeploymentSettings() {
  const computeConfig = getFoundationComputeConfig();
  const constrainedSingleHost =
    computeConfig.desiredCapacity === 1 &&
    computeConfig.maxSize === 1 &&
    computeConfig.minSize === 1 &&
    computeConfig.instanceType === 't3.micro';

  return constrainedSingleHost
    ? {
        maximumPercent: constrainedDeploymentMaximumPercent,
        minimumHealthyPercent: constrainedDeploymentMinimumHealthyPercent,
      }
    : {
        maximumPercent: rollingDeploymentMaximumPercent,
        minimumHealthyPercent: rollingDeploymentMinimumHealthyPercent,
      };
}

function normalizeOptionalValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function validateDeploymentPercentages(
  label: string,
  minimumHealthyPercent: number,
  maximumPercent: number,
) {
  if (
    !Number.isInteger(minimumHealthyPercent) ||
    minimumHealthyPercent < 0 ||
    minimumHealthyPercent > 100
  ) {
    throw new Error(
      `${label}DeploymentMinimumHealthyPercent must be an integer between 0 and 100.`,
    );
  }

  if (!Number.isInteger(maximumPercent) || maximumPercent < 100 || maximumPercent > 200) {
    throw new Error(`${label}DeploymentMaximumPercent must be an integer between 100 and 200.`);
  }

  if (maximumPercent < minimumHealthyPercent) {
    throw new Error(
      `${label} deployment maximum percent must be greater than or equal to minimum healthy percent.`,
    );
  }
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

function validateGracePeriod(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function validateTag(label: string, value: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
}
