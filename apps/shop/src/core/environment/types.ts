import { ConfigService } from '@nestjs/config';

import { DEFAULT_VALUES } from './constants';
import { EnvironmentVariables } from './schema';

export type DefaultEnvKey = keyof typeof DEFAULT_VALUES;
export type EnvVariable<K extends keyof EnvironmentVariables> = EnvironmentVariables[K];
export type TypedConfigService = ConfigService<EnvironmentVariables, true>;
