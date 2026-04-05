import { LogLevel } from '@nestjs/common';

const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

const DEFAULT_LOG_LEVEL: LogLevel = 'log';

const isValidLogLevel = (level: string): level is LogLevel => {
  return LOG_LEVELS.includes(level as LogLevel);
};

const getLevelsUpTo = (level: LogLevel): LogLevel[] => {
  const index = LOG_LEVELS.indexOf(level);
  return index === -1 ? [DEFAULT_LOG_LEVEL] : LOG_LEVELS.slice(0, index + 1);
};

export const getLogLevels = (): LogLevel[] => {
  const envLogLevel = process.env.APP_LOG_LEVEL?.toLowerCase();

  if (!envLogLevel) {
    return getLevelsUpTo(DEFAULT_LOG_LEVEL);
  }

  if (!isValidLogLevel(envLogLevel)) {
    console.warn(
      `Invalid APP_LOG_LEVEL: "${envLogLevel}". Valid values are: ${LOG_LEVELS.join(', ')}. Falling back to "${DEFAULT_LOG_LEVEL}".`,
    );
    return getLevelsUpTo(DEFAULT_LOG_LEVEL);
  }

  return getLevelsUpTo(envLogLevel);
};
