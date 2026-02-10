import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { DatabaseAdapterFactory } from '@/db/adapters';

config({ path: `.env.${process.env.NODE_ENV}` });

// Validate DATABASE_URL is available
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
