import dotenv from 'dotenv';
import { join } from 'path';

/**
 * Load all static test stubs from .env.test.
 * override:true ensures these values win over any ambient shell env var,
 * keeping the test environment hermetic.
 * DATABASE_URL is provided here as a placeholder; the integration test's
 * beforeAll replaces it with the real testcontainer URL before compile().
 */
dotenv.config({ override: true, path: join(__dirname, `.env.${process.env.NODE_ENV}`) });
