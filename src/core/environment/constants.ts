export const DEFAULT_VALUES = {
  PORT: 3000,
  ENV: '.env',
  NODE_HOSTNAME: 'localhost',
} as const;

export const envToEnvFileMap: Record<string, string> = {
  development: '.env.development.local',
  production: '.env.production.local',
  test: '.env.test.local',
} as const;
