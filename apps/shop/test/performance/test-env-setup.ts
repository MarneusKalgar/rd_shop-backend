import dotenv from 'dotenv';
import { join } from 'path';

/**
 * Load all static performance test stubs from .env.perf.
 * override:true keeps the environment hermetic.
 * DATABASE_URL is a placeholder — bootstrapPerfTest() replaces it
 * with the real Testcontainers URL before app bootstrap.
 */
dotenv.config({ override: true, path: join(__dirname, '.env.perf') });
