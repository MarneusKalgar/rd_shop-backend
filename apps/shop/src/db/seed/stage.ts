import { seedStage as runStageSeed } from './runner';

/**
 * Executes the stage-only seed entrypoint and converts failures into a non-zero exit code.
 */
async function main(): Promise<void> {
  try {
    await runStageSeed();
  } catch (error) {
    console.error('Stage seed script failed:', error);
    process.exit(1);
  }
}

void main();
