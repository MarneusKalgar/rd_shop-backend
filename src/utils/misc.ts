/**
 * Creates a shallow copy of an object, omitting the specified key
 * @param obj - The object to copy
 * @param keyToOmit - The key to exclude from the copy
 * @returns A new object without the specified key
 */
export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keyToOmit: K,
): Omit<T, K> {
  const result: Record<string, any> = {};

  for (const key in obj) {
    if (key !== (keyToOmit as string) && Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key];
    }
  }

  return result as Omit<T, K>;
}

/**
 * Simulates an external service call with a random delay
 * @param delay
 * @returns A promise that resolves after the specified delay plus a random additional delay
 */
export function simulateExternalService(delay: number): Promise<void> {
  const parsedDelay = Number(delay);
  const isNotValidNumber = isNaN(parsedDelay) || parsedDelay < 0;
  const actualDelay = isNotValidNumber ? 0 : parsedDelay + Math.floor(Math.random() * 200);

  return new Promise((resolve) => setTimeout(resolve, actualDelay));
}
