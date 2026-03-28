import { DatabaseAdapterFactory } from '@app/common';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { getEnvFile } from './core';

config({ path: getEnvFile() });

// Validate DATABASE_URL is available before initializing the data source
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const provider = process.env.DATABASE_PROVIDER;

const adapter = provider
  ? DatabaseAdapterFactory.create(provider)
  : DatabaseAdapterFactory.create();

adapter.validateConfig();

const AppDataSource = new DataSource(adapter.getDataSourceOptions());

export default AppDataSource;
