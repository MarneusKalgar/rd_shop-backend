import dotenv from 'dotenv';
import { join } from 'path';

/**
 * Load e2e environment variables into the Jest process.
 * override:true ensures these values win over any ambient shell env vars.
 * The .env.e2e file lives next to this file in test/e2e/.
 */
dotenv.config({ override: true, path: join(__dirname, '.env.e2e') });
