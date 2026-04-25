import { seedWithProductionGuard } from './runner';

/**
 * Executes the guarded production seed entrypoint and converts failures into a non-zero exit code.
 */
async function main(): Promise<void> {
  try {
    await seedWithProductionGuard();
  } catch (error) {
    console.error('Seed script failed:', error);
    process.exit(1);
  }
}

void main();
