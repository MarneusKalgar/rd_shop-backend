export const DEFAULT_VALUES = {
  ENV: '.env',
  NODE_HOSTNAME: 'localhost',
  PORT: 3000,
} as const;

export const envToEnvFileMap: Record<string, string> = {
  development: '.env.development.local',
  production: '.env.production.local',
  test: '.env.test.local',
} as const;
