import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

const defaultShortThrottleLimit = 3;

export function getThrottlerModuleOptions(configService: ConfigService): ThrottlerModuleOptions {
  return {
    skipIf: () => process.env.THROTTLE_SKIP === 'true',
    throttlers: [
      {
        limit: getShortThrottlerLimit(configService),
        name: 'short',
        ttl: 1000,
      },
      { limit: 20, name: 'medium', ttl: 10000 },
      { limit: 100, name: 'long', ttl: 60000 },
    ],
  };
}

function getShortThrottlerLimit(configService: ConfigService): number {
  const configuredLimit = configService.get<number>('THROTTLE_SHORT_LIMIT');

  return typeof configuredLimit === 'number' && configuredLimit > 0
    ? configuredLimit
    : defaultShortThrottleLimit;
}
