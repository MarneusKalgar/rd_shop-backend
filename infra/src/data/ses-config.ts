import { getFoundationRuntimeConfig } from './runtime-config-config';

export interface FoundationSesConfig {
  fromAddress: string;
  region: string;
}

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

function validateFromAddress(fromAddress: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error('shopSesFromAddress must be a valid email address.');
  }
}
