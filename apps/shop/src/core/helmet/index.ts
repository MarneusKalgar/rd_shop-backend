import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

export const setupHelmet = (app: NestExpressApplication): void => {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
};
