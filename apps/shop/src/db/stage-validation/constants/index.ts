export const STAGE_VALIDATION_DEFAULT_BASE_URL = 'http://localhost:8092';
export const STAGE_VALIDATION_DEFAULT_NAMESPACE = 'stage-validation';

export const STAGE_VALIDATION_USER_SCENARIOS = ['cart', 'order', 'orders-query'] as const;

export type StageValidationUserScenario = (typeof STAGE_VALIDATION_USER_SCENARIOS)[number];

/** Builds the deterministic validation email for a given scenario slug. */
export function getStageValidationUserEmail(
  scenario: StageValidationUserScenario,
  namespace: string,
): string {
  return `${namespace}-${scenario}@test.local`;
}

/** Returns all deterministic validation emails for the current namespace. */
export function getStageValidationUserEmails(namespace: string): string[] {
  return STAGE_VALIDATION_USER_SCENARIOS.map((scenario) =>
    getStageValidationUserEmail(scenario, namespace),
  );
}
