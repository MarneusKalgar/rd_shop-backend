import dataSource from '../../../data-source';

async function seed() {
  await dataSource.initialize();

  console.log('🌱 Starting database seeding...');

  try {
    // Add your seeding logic here
    console.log('✅ Seeding completed successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
