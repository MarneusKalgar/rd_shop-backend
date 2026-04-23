import { getFoundationRuntimeConfig } from './runtime-config-config';

export interface FoundationSesConfig {
  fromAddress: string;
  region: string;
}

/**
 * Step 1.5 SES config helper.
 * Accepts no arguments.
 * Resolves the SES sender address and region from the already-built runtime config, then validates the sender email.
 */
export function getFoundationSesConfig(): FoundationSesConfig {
  const runtimeConfig = getFoundationRuntimeConfig();
  const sesRegion = runtimeConfig.shop.parameterValues.AWS_SES_REGION;
  const fromAddress = runtimeConfig.shop.parameterValues.SES_FROM_ADDRESS;

  if (typeof sesRegion !== 'string') {
    throw new Error('AWS_SES_REGION must resolve to a string value.');
  }

  if (typeof fromAddress !== 'string') {
    throw new Error('SES_FROM_ADDRESS must resolve to a string value.');
  }

  validateFromAddress(fromAddress);

  return {
    fromAddress,
    region: sesRegion,
  };
}

/**
 * Step 1.5 validation helper.
 * Accepts the configured sender email address.
 * Throws when the address does not match a basic email shape.
 */
function validateFromAddress(fromAddress: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error('SES_FROM_ADDRESS must be a valid email address.');
  }
}
