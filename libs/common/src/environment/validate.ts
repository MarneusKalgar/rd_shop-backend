import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

export function createValidate<T extends object>(cls: ClassConstructor<T>) {
  return function validate(config: Record<string, unknown>): T {
    const validatedConfig = plainToInstance(cls, config, {
      enableImplicitConversion: true,
    });

    const errors = validateSync(validatedConfig, {
      skipMissingProperties: false,
    });

    if (errors.length > 0) {
      const errorMessages = errors
        .map((err) => Object.values(err.constraints ?? {}).join(', '))
        .join('\n');
      throw new Error(`Environment validation failed:\n${errorMessages}`);
    }

    return validatedConfig;
  };
}
