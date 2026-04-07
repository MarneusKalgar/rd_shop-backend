import { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';

import { isProduction } from '@/utils/env';

export const getPinoLoggerConfig = (): Params => {
  const isProd = isProduction();

  return {
    pinoHttp: {
      autoLogging: {
        ignore: (req: IncomingMessage & { url?: string }) =>
          req.url?.startsWith('/health') ?? false,
      },

      genReqId: (
        req: IncomingMessage & { headers: Record<string, string | string[] | undefined> },
      ) => {
        const fromHeader = req.headers['x-request-id'];
        return (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ?? randomUUID();
      },

      level: process.env.APP_LOG_LEVEL ?? 'info',

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
