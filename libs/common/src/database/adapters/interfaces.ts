import { DataSourceOptions } from 'typeorm';

export interface IDatabaseAdapter {
  getConnectionUrl(): string;

  getDataSourceOptions(): DataSourceOptions;

  getModuleOptions(): Omit<DataSourceOptions, 'migrations'>;

  getProviderName(): string;

  validateConfig(): void;
}
