import { join } from 'node:path';

export const MIGRATIONS_GLOB = join(__dirname, '../src/db/migrations/*{.ts,.js}');
