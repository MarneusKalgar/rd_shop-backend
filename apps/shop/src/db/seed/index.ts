import { runSeed } from './runner';

/**
 * Executes the unguarded development seed entrypoint and converts failures into a non-zero exit code.
 */
async function main(): Promise<void> {
  try {
    await runSeed();
  } catch (error) {
    console.error('Seed script failed:', error);
    process.exit(1);
  }
}

void main();
