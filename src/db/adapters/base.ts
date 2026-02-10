import { DataSourceOptions } from 'typeorm';

import { getTypeOrmPaths } from '@/config';
import { isDevelopment, omit } from '@/utils';

import { IDatabaseAdapter } from './interfaces';

export abstract class BasePostgresAdapter implements IDatabaseAdapter {
  protected abstract connectionUrl: string;

  abstract getConnectionUrl(): string;

  getDataSourceOptions(): DataSourceOptions {
    const { entities, migrations } = getTypeOrmPaths();
    const isDev = isDevelopment();

    return {
      entities,
      logger: isDev ? 'advanced-console' : 'simple-console',
      logging: isDev ? ['query', 'error', 'schema', 'warn'] : ['error', 'warn'],
      migrations,
      ssl: this.getSslConfig(),
      synchronize: false,
      type: 'postgres',
      url: this.getConnectionUrl(),
    };
  }

  /**
   * Get configuration for NestJS TypeOrmModule (without migrations)
   */
  getModuleOptions(): Omit<DataSourceOptions, 'migrations'> {
    const options = this.getDataSourceOptions();
    // const { migrations, ...optionsWithoutMigrations } = options;

    const optionsWithoutMigrations = omit(options, 'migrations');

    return {
      ...optionsWithoutMigrations,
      migrationsRun: false,
    };
  }

  abstract getProviderName(): string;

  abstract validateConfig(): void;

  protected getSslConfig(): boolean | { rejectUnauthorized: boolean } {
    // Override in child classes if different SSL config is needed
    return true;
  }
}
