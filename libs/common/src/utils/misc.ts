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
