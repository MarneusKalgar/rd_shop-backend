import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { DatabaseAdapterFactory } from '@/db/adapters';

// import { getTypeOrmConfig } from '@/config/typeORM';

config({ path: `.env.${process.env.NODE_ENV}` });

// Validate DATABASE_URL is available
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

if (!process.env.DATABASE_PROVIDER) {
  throw new Error('DATABASE_PROVIDER environment variable is not set');
}

const adapter = DatabaseAdapterFactory.create(process.env.DATABASE_PROVIDER);
adapter.validateConfig();

console.log({
  connectionUrl: adapter.getConnectionUrl(),
  databaseProvider: adapter.getProviderName(),
});

const AppDataSource = new DataSource(adapter.getDataSourceOptions());

export default AppDataSource;
