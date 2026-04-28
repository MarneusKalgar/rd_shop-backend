import * as pulumi from '@pulumi/pulumi';

import { config, projectPrefix, stack } from '../bootstrap';
import { getFoundationComputeConfig } from './compute-config';

const defaultCloudMapNamespaceName = `${projectPrefix}.local`;
const defaultDesiredCount = 1;
const bootstrapPendingImageTag = 'bootstrap-pending-image';
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
  paymentsImageTag?: string;
  paymentsImageUri?: string;
  shopDeploymentMaximumPercent: number;
  shopDeploymentMinimumHealthyPercent: number;
  shopDesiredCount: number;
  shopHealthCheckGracePeriodSeconds: number;
  shopImageTag?: string;
  shopImageUri?: string;
}

interface ResolvedImageSource {
  forceZeroDesiredCount: boolean;
  imageTag?: string;
  imageUri?: string;
}

/**
 * Step 2.3-2.4 service-config helper.
 * Accepts no arguments.
 * Resolves the ECS service deployment settings, image-source settings, and Cloud Map namespace used by service provisioning.
 */
export function getComputeServicesConfig(): ComputeServicesConfig {
  const computeConfig = getFoundationComputeConfig();
  const defaultDeploymentSettings = getDefaultDeploymentSettings(computeConfig);
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
  const shopImageSource = resolveImageSource({
    imageTag: normalizeOptionalValue(config.get('shopImageTag')),
    imageUri: normalizeOptionalValue(config.get('shopImageUri')),
    service: 'shop',
  });
  const paymentsImageSource = resolveImageSource({
    imageTag: normalizeOptionalValue(config.get('paymentsImageTag')),
    imageUri: normalizeOptionalValue(config.get('paymentsImageUri')),
    service: 'payments',
  });

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
  validatePaymentsPlacement(paymentsDesiredCount, computeConfig.maxSize);
  validateDnsName('cloudMapNamespaceName', cloudMapNamespaceName);
  validateGracePeriod('shopHealthCheckGracePeriodSeconds', shopHealthCheckGracePeriodSeconds);
  return {
    cloudMapNamespaceName,
    paymentsDeploymentMaximumPercent,
    paymentsDeploymentMinimumHealthyPercent,
    paymentsDesiredCount: paymentsImageSource.forceZeroDesiredCount ? 0 : paymentsDesiredCount,
    paymentsImageTag: paymentsImageSource.imageTag,
    paymentsImageUri: paymentsImageSource.imageUri,
    shopDeploymentMaximumPercent,
    shopDeploymentMinimumHealthyPercent,
    shopDesiredCount: shopImageSource.forceZeroDesiredCount ? 0 : shopDesiredCount,
    shopHealthCheckGracePeriodSeconds,
    shopImageTag: shopImageSource.imageTag,
    shopImageUri: shopImageSource.imageUri,
  };
}

/**
 * Step 2.3-2.4 deployment helper.
 * Accepts the resolved compute-capacity config.
 * Returns the default ECS deployment percentages for either constrained single-host mode or rolling mode.
 */
function getDefaultDeploymentSettings(
  computeConfig: ReturnType<typeof getFoundationComputeConfig>,
) {
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

/**
 * Step 2.3-2.4 normalization helper.
 * Accepts an optional string config value.
 * Returns the trimmed value when present, otherwise `undefined`.
 */
function normalizeOptionalValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

/**
 * Step 2.3-2.4 image-source helper.
 * Accepts the service label plus optional image tag and image URI config values.
 * Returns the explicit image source, or a bootstrap placeholder with desired count forced to zero until a real image is configured.
 */
function resolveImageSource({
  imageTag,
  imageUri,
  service,
}: {
  imageTag: string | undefined;
  imageUri: string | undefined;
  service: 'payments' | 'shop';
}): ResolvedImageSource {
  validateImageSource(service, imageTag, imageUri);

  if (!imageTag && !imageUri) {
    if (stack === 'production') {
      throw new Error(
        `${service}ImageTag or ${service}ImageUri must be set explicitly for the production stack.`,
      );
    }

    void pulumi.log.warn(
      `${service}ImageTag or ${service}ImageUri is not set. Using the bootstrap placeholder image tag and forcing desired count to 0 until a real image is configured.`,
    );

    return {
      forceZeroDesiredCount: true,
      imageTag: bootstrapPendingImageTag,
      imageUri: undefined,
    };
  }

  return {
    forceZeroDesiredCount: false,
    imageTag,
    imageUri,
  };
}

/**
 * Step 2.3-2.4 validation helper.
 * Accepts the service label and its minimum/maximum deployment percentages.
 * Throws when the ECS deployment percentages fall outside the supported ranges.
 */
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

/**
 * Step 2.3-2.4 validation helper.
 * Accepts a desired-count label and value.
 * Throws when the desired count is negative or non-integer.
 */
function validateDesiredCount(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

/**
 * Step 2.3-2.4 validation helper.
 * Accepts the config label and Cloud Map namespace candidate.
 * Throws when the namespace does not resemble a usable private DNS zone.
 */
function validateDnsName(label: string, value: string) {
  if (!/^[a-z0-9.-]+$/.test(value) || !value.includes('.')) {
    throw new Error(`${label} must look like a valid private DNS zone, e.g. rd-shop.local.`);
  }
}

/**
 * Step 2.3-2.4 validation helper.
 * Accepts the config label and health-check grace period seconds.
 * Throws when the grace period is negative or non-integer.
 */
function validateGracePeriod(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

/**
 * Step 2.3-2.4 validation helper.
 * Accepts the service name plus its optional image tag and image URI inputs.
 * Throws when the image source is ambiguous.
 */
function validateImageSource(
  service: 'payments' | 'shop',
  imageTag: string | undefined,
  imageUri: string | undefined,
) {
  if (imageTag && imageUri) {
    throw new Error(
      `${service}ImageTag and ${service}ImageUri are mutually exclusive. Set only one explicit image source.`,
    );
  }
}

/**
 * Step 2.3-2.4 placement helper.
 * Accepts the payments desired count and ECS host max size.
 * Throws when fixed-port bridge-mode payments tasks would require more hosts than the ASG can supply.
 */
function validatePaymentsPlacement(paymentsDesiredCount: number, ecsMaxSize: number) {
  if (paymentsDesiredCount > ecsMaxSize) {
    throw new Error(
      'paymentsDesiredCount cannot exceed ecsMaxSize because payments uses fixed host port 5001 in bridge mode and only one payments task can run per ECS host.',
    );
  }
}
