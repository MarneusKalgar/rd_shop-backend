import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ValidationError } from '@/common/errors';

import { EnvironmentVariables } from './schema';

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((err) => Object.values(err.constraints ?? {}).join(', '))
      .join('\n');
    throw new ValidationError('Environment validation failed', { details: errorMessages });
  }

  return validatedConfig;
}
