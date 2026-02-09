import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '@/config/typeORM';

config({ path: `.env.${process.env.NODE_ENV}` });

// Validate DATABASE_URL is available
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const AppDataSource = new DataSource(getTypeOrmConfig(process.env.DATABASE_URL));

export default AppDataSource;
