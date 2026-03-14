import { DataSourceOptions } from 'typeorm';

export interface IDatabaseAdapter {
  /**
   * Get the connection string/URL for this database provider
   */
  getConnectionUrl(): string;

  /**
   * Get the TypeORM configuration for this database provider
   */
  getDataSourceOptions(): DataSourceOptions;

  /**
   * Get the TypeORM configuration for NestJS TypeOrmModule (without migrations)
   */
  getModuleOptions(): Omit<DataSourceOptions, 'migrations'>;

  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Validate that required environment variables are set
   */
  validateConfig(): void;
}
