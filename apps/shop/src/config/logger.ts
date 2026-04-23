import { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';

import { REQUEST_ID_HEADER } from '@/common/constants';
import { isProduction } from '@/utils/env';

export const getPinoLoggerConfig = (): Params => {
  const isProd = isProduction();

  let logLevel = process.env.APP_LOG_LEVEL ?? 'info';
  if (process.env.NODE_ENV === 'test' && process.env.VERBOSE_TEST_LOGS !== 'true') {
    logLevel = 'silent';
  }

  return {
    // nestjs-pino defaults to path:'*' which throws in Express 5 (path-to-regexp v8).
    // '/{*path}' is the Express 5 equivalent that matches every route.
    forRoutes: ['/{*path}'],

    pinoHttp: {
      autoLogging: {
        ignore: (req: IncomingMessage & { url?: string }) =>
          req.url?.startsWith('/health') ?? false,
      },

      genReqId: (req: IncomingMessage) => {
        const fromHeader = req.headers[REQUEST_ID_HEADER];
        const id = (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ?? randomUUID();
        // Write back so extractAuditContext and Pino share the exact same value.
        req.headers[REQUEST_ID_HEADER] = id;
        return id;
      },

      level: logLevel,

      redact: ['req.headers.authorization', 'req.headers.cookie'],

      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          method: req.method,
          requestId: req.id,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },

      transport: isProd
        ? undefined
        : {
            options: { colorize: true, translateTime: 'SYS:standard' },
            target: 'pino-pretty',
          },
    },
  };
};
