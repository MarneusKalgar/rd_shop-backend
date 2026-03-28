export function simulateExternalService(delay: number): Promise<void> {
  const parsedDelay = Number(delay);
  const isNotValidNumber = isNaN(parsedDelay) || parsedDelay < 0;
  const actualDelay = isNotValidNumber ? 0 : parsedDelay + Math.floor(Math.random() * 200);

  return new Promise((resolve) => setTimeout(resolve, actualDelay));
}
