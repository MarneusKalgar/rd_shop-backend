import { STAGE_VALIDATION_DEFAULT_BASE_URL, STAGE_VALIDATION_DEFAULT_NAMESPACE } from './constants';

type StageValidationRuntimeOperation = 'cleanup' | 'seed';

/** Ensures the stage-validation entrypoint runs only against the stage runtime. */
export function assertStageValidationRuntime(operation: StageValidationRuntimeOperation): void {
  if (process.env.DEPLOYMENT_ENVIRONMENT !== 'stage') {
    throw new Error(
      `Stage validation ${operation} requires DEPLOYMENT_ENVIRONMENT=stage, received ${process.env.DEPLOYMENT_ENVIRONMENT ?? 'unset'}`,
    );
  }
}

/** Returns the HTTP base URL used by e2e validation traffic. */
export function getStageValidationBaseUrl(): string {
  return getOptionalEnvValue('STAGE_VALIDATION_BASE_URL') ?? STAGE_VALIDATION_DEFAULT_BASE_URL;
}

/** Returns the namespace used to derive validation-owned users and records. */
export function getStageValidationNamespace(): string {
  return getOptionalEnvValue('STAGE_VALIDATION_NAMESPACE') ?? STAGE_VALIDATION_DEFAULT_NAMESPACE;
}

/** Returns the optional pinned validation product ID used by stage validation. */
export function getStageValidationProductId(): null | string {
  return getOptionalEnvValue('STAGE_VALIDATION_PRODUCT_ID');
}

/** Returns the optional validation user password used by stage validation. */
export function getStageValidationUserPassword(): null | string {
  return getOptionalEnvValue('STAGE_VALIDATION_USER_PASSWORD');
}

/** Returns whether the e2e suite should target pre-seeded stage-validation fixtures. */
export function isStageValidationE2EEnabled(): boolean {
  const hasProductId = getStageValidationProductId() !== null;
  const hasUserPassword = getStageValidationUserPassword() !== null;

  if (hasProductId !== hasUserPassword) {
    throw new Error(
      'Stage validation e2e requires STAGE_VALIDATION_PRODUCT_ID and STAGE_VALIDATION_USER_PASSWORD to be set together',
    );
  }

  return hasProductId;
}

/** Returns the required pinned validation product ID for seed and cleanup tasks. */
export function requireStageValidationProductId(): string {
  return requireEnvValue('STAGE_VALIDATION_PRODUCT_ID');
}

/** Returns the required validation user password for seed tasks. */
export function requireStageValidationUserPassword(): string {
  return requireEnvValue('STAGE_VALIDATION_USER_PASSWORD');
}

function getOptionalEnvValue(name: string): null | string {
  return process.env[name]?.trim() ?? null;
}

function requireEnvValue(name: string): string {
  const value = getOptionalEnvValue(name);

  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }

  return value;
}
