import { resolve } from 'node:path';

import { isProduction } from '../utils/env';

export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  const resolvedProject = process.env.APP?.toLowerCase()?.trim();

  if (!resolvedProject) {
    throw new Error('APP environment variable is not set or invalid');
  }

  if (isProd) {
    // The runtime helper used by the CLI is emitted to dist/libs/common/database.
    // Resolve the dist root from there, then search only inside the current app subtree.
    // That supports both flat app output (dist/apps/<app>/...) and nested output
    // (dist/apps/<app>/apps/<app>/src/...).
    const projectDistRoot = resolve(__dirname, '../../..');
    const projectAppDistRoot = resolve(projectDistRoot, 'apps', resolvedProject);

    return {
      entities: [resolve(projectAppDistRoot, '**/*.entity.js')],
      migrations: [resolve(projectAppDistRoot, '**/db/migrations/*.js')],
    };
  }

  return {
    entities: [`src/**/*.entity{.ts,.js}`],
    migrations: [`src/db/migrations/*{.ts,.js}`],
  };
};
