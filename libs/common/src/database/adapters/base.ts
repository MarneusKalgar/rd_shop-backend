import { DataSourceOptions } from 'typeorm';

import { isDevelopment, omit } from '../../utils';
import { getTypeOrmPaths } from '../typeorm-paths';
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

  getModuleOptions(): Omit<DataSourceOptions, 'migrations'> {
    const options = this.getDataSourceOptions();
    const optionsWithoutMigrations = omit(options, 'migrations');

    return {
      ...optionsWithoutMigrations,
      migrationsRun: false,
    };
  }

  abstract getProviderName(): string;

  abstract validateConfig(): void;

  protected getSslConfig(): boolean | { rejectUnauthorized: boolean } {
    const url = this.getConnectionUrl();
    if (url) {
      try {
        const urlObj = new URL(url);
        const sslMode = urlObj.searchParams.get('sslmode');

        if (sslMode === 'disable') {
          return false;
        }
        if (sslMode === 'require') {
          return { rejectUnauthorized: false };
        }
        if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
          return true;
        }
        if (sslMode === 'prefer' || sslMode === 'allow') {
          return { rejectUnauthorized: false };
        }
      } catch {
        console.warn(
          '⚠ Unable to parse DATABASE_URL for SSL configuration, falling back to defaults',
        );
      }
    }

    const isDev = isDevelopment();

    if (isDev) {
      return false;
    }

    return { rejectUnauthorized: true };
  }
}
