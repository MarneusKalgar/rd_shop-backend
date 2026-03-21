import dotenv from 'dotenv';
import { join } from 'path';

// Override NODE_ENV first so that getEnvFile() (called at AppModule class-
// decoration time) returns '.env.test' and ConfigModule finds the right file.
process.env.NODE_ENV = 'test';

// Load all static test stubs from .env.test.
// override:true ensures these values win over any ambient shell env var,
// keeping the test environment hermetic.
// DATABASE_URL is provided here as a placeholder; the integration test's
// beforeAll replaces it with the real testcontainer URL before compile().
dotenv.config({ override: true, path: join(__dirname, '.env.test') });
