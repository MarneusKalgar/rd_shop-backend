import dotenv from 'dotenv';
import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '@/config/typeORM';

console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

const AppDataSource = new DataSource(getTypeOrmConfig());

export default AppDataSource;
