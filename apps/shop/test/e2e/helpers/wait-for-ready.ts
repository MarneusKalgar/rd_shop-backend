/**
 * Polls a URL until it responds with 2xx or the timeout is exceeded.
 * Used in beforeAll to gate tests until the Docker stack is fully ready.
 */
export async function waitForReady(
  url: string,
  timeoutMs = 120_000,
  intervalMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Service at ${url} did not become ready within ${timeoutMs}ms. Last error: ${reason}`,
  );
}
