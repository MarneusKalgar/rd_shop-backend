import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Sorts SRV records for a single-target gRPC dial.
 * Lower priority wins; within the same priority bucket, higher weight wins.
 */
export function compareSrvRecords(
  left: { priority: number; weight: number },
  right: { priority: number; weight: number },
): number {
  return left.priority - right.priority || right.weight - left.weight;
}

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
