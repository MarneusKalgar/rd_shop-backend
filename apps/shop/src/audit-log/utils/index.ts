import { Request } from 'express';

import { REQUEST_ID_HEADER } from '@/common/constants';

import { AuditEventContext } from '../audit-log.types';

export const extractAuditContext = (req: Request): AuditEventContext => ({
  // req.id is set directly by pino-http (guaranteed when middleware runs).
  // Fall back to the header for requests that bypass pino-http (e.g. health checks).
  correlationId:
    (req.id as string | undefined) ?? (req.headers[REQUEST_ID_HEADER] as string | undefined),
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});
