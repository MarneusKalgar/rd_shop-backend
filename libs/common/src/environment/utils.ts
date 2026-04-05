export const getEnvFile = (): string => {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase().trim();

  if (!nodeEnv) {
    return '.env';
  }

  return `.env.${nodeEnv}`;
};
