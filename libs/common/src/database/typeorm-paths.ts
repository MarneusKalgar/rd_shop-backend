import { resolve } from 'node:path';

import { isProduction } from '../utils/env';

export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  const resolvedProject = process.env.APP?.toLowerCase()?.trim();

  if (!resolvedProject) {
    throw new Error('APP environment variable is not set or invalid');
  }

  if (isProd) {
    // ECS one-off migration tasks run from /app, not from apps/<service>.
    // Resolve against the compiled helper location so paths stay correct in both cases.
    const projectDistRoot = resolve(__dirname, '../../../..');

    return {
      entities: [resolve(projectDistRoot, '**/*.entity.js')],
      migrations: [resolve(projectDistRoot, 'db/migrations/*.js')],
    };
  }

  return {
    entities: [`src/**/*.entity{.ts,.js}`],
    migrations: [`src/db/migrations/*{.ts,.js}`],
  };
};
