import dotenv from 'dotenv';
import { join } from 'node:path';

/**
 * Load e2e environment variables into the Jest process.
 * override:false means values already set in the environment (e.g., STAGE_VALIDATION_BASE_URL injected by CI)
 * take precedence over the committed defaults in .env.e2e.
 * The .env.e2e file lives next to this file in test/e2e/.
 */
dotenv.config({ override: false, path: join(__dirname, '.env.e2e') });
