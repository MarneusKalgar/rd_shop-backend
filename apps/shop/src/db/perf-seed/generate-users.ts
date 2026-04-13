import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

import { UserRole, UserScope } from '@/auth/permissions';
import { User } from '@/users/user.entity';

const FIRST_NAMES = [
  'Alice',
  'Bob',
  'Carol',
  'Dave',
  'Eve',
  'Frank',
  'Grace',
  'Henry',
  'Iris',
  'Jake',
];
const LAST_NAMES = [
  'Smith',
  'Jones',
  'Lee',
  'Brown',
  'Taylor',
  'Wilson',
  'Davis',
  'Moore',
  'Clark',
  'Hall',
];

/**
 * Bulk-inserts `count` users with pre-hashed passwords.
 * All users get roles=[user] and orders:read + orders:write scopes.
 * Passwords are pre-hashed once and reused across batches to keep seeding fast.
 *
 * @param dataSource - Active TypeORM DataSource
 * @param count - Number of users to insert (default 100)
 * @param saltRounds - bcrypt rounds for the shared seed password (default 10)
 */
export async function seedUsers(
  dataSource: DataSource,
  count = 100,
  saltRounds = 10,
): Promise<void> {
  const repo = dataSource.getRepository(User);

  // Hash a single shared password once — reused for all seed users
  const hashedPassword = await bcrypt.hash('Perf@12345', saltRounds);

  const chunkSize = 50;
  console.log(`  Seeding ${count} users…`);

  for (let offset = 0; offset < count; offset += chunkSize) {
    const batch = Array.from({ length: Math.min(chunkSize, count - offset) }).map((_, i) => {
      const seq = offset + i + 1;
      return repo.create({
        email: `perf-user-${seq}@test.local`,
        firstName: FIRST_NAMES[seq % FIRST_NAMES.length],
        isEmailVerified: true,
        lastName: LAST_NAMES[seq % LAST_NAMES.length],
        password: hashedPassword,
        roles: [UserRole.USER],
        scopes: [UserScope.ORDERS_READ, UserScope.ORDERS_WRITE, UserScope.PRODUCTS_READ],
      });
    });

    await repo.createQueryBuilder().insert().into(User).values(batch).orIgnore().execute();
  }

  console.log(`  ✓ ${count} users inserted`);
}
