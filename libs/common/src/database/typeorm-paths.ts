import { isProduction } from '../utils/env';

export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  const resolvedProject = process.env.APP?.toLowerCase()?.trim();

  if (!resolvedProject) {
    throw new Error('APP environment variable is not set or invalid');
  }

  if (isProd) {
    return {
      entities: [`../../dist/apps/${resolvedProject}/**/*.entity.js`],
      migrations: [`../../dist/apps/${resolvedProject}/db/migrations/*.js`],
    };
  }

  return {
    entities: [`src/**/*.entity{.ts,.js}`],
    migrations: [`src/db/migrations/*{.ts,.js}`],
  };
};
