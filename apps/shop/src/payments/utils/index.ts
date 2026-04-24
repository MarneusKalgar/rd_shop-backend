import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { resolveSrv } from 'node:dns/promises';

export function mapGrpcError(err: unknown): never {
  const grpc = err as { code?: number; message?: string };
  const message = grpc.message ?? 'Payment service error';

  switch (grpc.code) {
    case GrpcStatus.NOT_FOUND:
      throw new NotFoundException(message);
    case GrpcStatus.INVALID_ARGUMENT:
      throw new BadRequestException(message);
    case GrpcStatus.ALREADY_EXISTS:
      throw new ConflictException(message);
    case GrpcStatus.UNAVAILABLE:
      throw new ServiceUnavailableException('Payment service is unavailable');
    case GrpcStatus.DEADLINE_EXCEEDED:
      throw new GatewayTimeoutException('Payment service request timed out');
    default:
      throw new ServiceUnavailableException(message);
  }
}

export async function resolvePaymentsGrpcUrl({
  host,
  logger,
  port,
}: {
  host: string;
  logger: Logger;
  port: number;
}) {
  const configuredUrl = `${host}:${port}`;

  try {
    const records = await resolveSrv(host);

    if (records.length === 0) {
      logger.log(`Using configured payments gRPC endpoint ${configuredUrl}`);
      return configuredUrl;
    }

    const record = records
      .slice()
      .sort((left, right) => left.priority - right.priority || right.weight - left.weight)[0];
    const resolvedHost = record.name.replace(/\.$/, '');
    const resolvedUrl = `${resolvedHost}:${record.port}`;

    logger.log(`Resolved payments gRPC endpoint via SRV ${host} -> ${resolvedUrl}`);
    return resolvedUrl;
  } catch (error: unknown) {
    const errorCode = (error as { code?: string }).code;

    if (errorCode === 'ENODATA' || errorCode === 'ENOTFOUND' || errorCode === 'SERVFAIL') {
      logger.log(`Using configured payments gRPC endpoint ${configuredUrl}`);
      return configuredUrl;
    }

    logger.warn(
      `Failed to resolve payments gRPC SRV for ${host}; falling back to configured endpoint ${configuredUrl}`,
    );
    return configuredUrl;
  }
}
