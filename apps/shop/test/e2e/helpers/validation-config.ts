import {
  getStageValidationUserEmail,
  type StageValidationUserScenario,
} from '@/db/stage-validation/constants';
import {
  getStageValidationNamespace,
  getStageValidationProductId,
  getStageValidationUserPassword,
  isStageValidationE2EEnabled,
} from '@/db/stage-validation/runtime';

const configuredNamespace = getStageValidationNamespace();
const configuredProductId = getStageValidationProductId();
const configuredUserPassword = getStageValidationUserPassword();
const stageValidationEnabled = isStageValidationE2EEnabled();

let checkoutSequence = 0;

/** Builds a unique idempotency key inside the configured validation namespace. */
export function buildCheckoutIdempotencyKey(): string | undefined {
  if (!stageValidationEnabled) {
    return undefined;
  }

  checkoutSequence += 1;
  return `${configuredNamespace}-${checkoutSequence}`;
}

/** Returns the pinned validation product ID when stage validation is enabled. */
export function getConfiguredProductId(): null | string {
  return configuredProductId;
}

/** Returns the scenario email, switching to the seeded validation user when requested. */
export function getScenarioUserEmail(
  scenario: StageValidationUserScenario,
  fallbackEmail: string,
): string {
  if (!stageValidationEnabled) {
    return fallbackEmail;
  }

  return getStageValidationUserEmail(scenario, configuredNamespace);
}

/** Returns the scenario password, preserving local defaults unless seeded users are enabled. */
export function getScenarioUserPassword(fallbackPassword: string): string {
  return configuredUserPassword ?? fallbackPassword;
}

/** Prefixes an explicit idempotency key so cleanup and diagnostics stay namespace-scoped. */
export function prefixValidationKey(key: string): string {
  if (!stageValidationEnabled) {
    return key;
  }

  return `${configuredNamespace}-${key}`;
}

/** Returns whether the e2e auth helper should sign in only instead of signup + signin. */
export function useStageValidationUsers(): boolean {
  return stageValidationEnabled;
}
