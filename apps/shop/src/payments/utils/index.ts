import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientGrpc, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { resolveSrv } from 'node:dns/promises';
import { defer, mergeMap, Observable } from 'rxjs';

export interface PaymentsGrpcClient {
  getService<T extends object>(name: string): T;
}

interface CloseableClientGrpc extends ClientGrpc {
  close?: () => void;
}

type GrpcObservableMethod = (...args: unknown[]) => Observable<unknown>;

export function createPaymentsGrpcClient({
  host,
  logger,
  port,
  protoPath,
}: {
  host: string;
  logger: Logger;
  port: number;
  protoPath: string;
}): PaymentsGrpcClient {
  let cachedClient: CloseableClientGrpc | undefined;
  let cachedUrl: string | undefined;
  const serviceCache = new Map<string, unknown>();

  const getClient = async () => {
    const resolvedUrl = await resolvePaymentsGrpcUrl({ host, logger, port });

    if (!cachedClient || cachedUrl !== resolvedUrl) {
      cachedClient?.close?.();
      cachedClient = ClientProxyFactory.create({
        options: {
          loader: { enums: String },
          package: 'payments',
          protoPath,
          url: resolvedUrl,
        },
        transport: Transport.GRPC,
      }) as CloseableClientGrpc;
      cachedUrl = resolvedUrl;
    }

    return cachedClient;
  };

  return {
    getService<T extends object>(serviceName: string) {
      const cachedService = serviceCache.get(serviceName);

      if (cachedService) {
        return cachedService as T;
      }

      const service = new Proxy(
        {},
        {
          get(_target, propertyKey) {
            if (typeof propertyKey !== 'string') {
              return undefined;
            }

            return (...args: unknown[]) =>
              defer(async () => {
                const client = await getClient();
                const grpcService =
                  client.getService<Record<string, GrpcObservableMethod>>(serviceName);
                const method = grpcService[propertyKey];

                if (typeof method !== 'function') {
                  throw new Error(
                    `Payments gRPC method ${serviceName}.${propertyKey} is not available.`,
                  );
                }

                return method(...args);
              }).pipe(mergeMap((result) => result));
          },
        },
      ) as T;

      serviceCache.set(serviceName, service);
      return service;
    },
  };
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
      logger.log(
        `Payments gRPC SRV not available for ${host} (${errorCode}); using configured endpoint ${configuredUrl}`,
      );
      return configuredUrl;
    }

    logger.warn(
      `Failed to resolve payments gRPC SRV for ${host} (${errorCode ?? 'unknown'}); falling back to configured endpoint ${configuredUrl}`,
    );
    return configuredUrl;
  }
}
