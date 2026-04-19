/**
 * Repeatedly calls `fn` until `predicate(result)` returns true or the
 * timeout is exceeded. Returns the last value that satisfied the predicate.
 */
export async function poll<T>(
  fn: () => Promise<T>,
  predicate: (val: T) => boolean,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastVal: T | undefined;

  while (Date.now() < deadline) {
    lastVal = await fn();
    if (predicate(lastVal)) return lastVal;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`poll timed out after ${timeoutMs}ms`);
}
