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
