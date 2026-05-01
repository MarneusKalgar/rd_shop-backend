export const DEFAULT_VALUES = {
  APP: 'shop',
  APP_LOG_LEVEL: 'log',
  APP_URL: 'http://localhost:5173',
  BCRYPT_SALT_ROUNDS: 10,
  ENV: '.env',
  JWT_ACCESS_EXPIRES_IN: '15m',
  NODE_HOSTNAME: 'localhost',
  OBSERVABILITY_METRICS_ENABLED: 'false',
  PORT: 3000,
} as const;
