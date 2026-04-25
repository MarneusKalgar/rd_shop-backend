import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { resolveSrv } from 'node:dns/promises';
import { join } from 'node:path';
import { defer, mergeMap, Observable } from 'rxjs';

import { compareSrvRecords } from './utils';

export interface PaymentsGrpcClient {
  getService<T extends object>(name: string): T;
}

interface CloseableClientGrpc extends ClientGrpc {
  close?: () => void;
}

type GrpcObservableMethod = (...args: unknown[]) => Observable<unknown>;

interface PaymentsSrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

/**
 * Stateful gRPC client wrapper for payments.
 *
 * The service keeps a cached low-level Nest gRPC client and a cache of typed service proxies,
 * but resolves the target endpoint lazily on each call. That lets ECS/Cloud Map registration
 * settle after startup while still reusing the same client when DNS resolution stays stable.
 */
@Injectable()
export class PaymentsGrpcClientService implements OnModuleDestroy, PaymentsGrpcClient {
  private cachedClient: CloseableClientGrpc | undefined;
  private cachedUrl: string | undefined;
  private readonly host: string;
  private readonly logger = new Logger(PaymentsGrpcClientService.name);
  private readonly port: number;
  private readonly protoPath = join(__dirname, '../proto/payments.proto');
  private readonly serviceCache = new Map<string, unknown>();

  constructor(private readonly configService: ConfigService) {
    this.host = this.configService.getOrThrow<string>('PAYMENTS_GRPC_HOST');
    this.port = this.configService.get<number>('PAYMENTS_GRPC_PORT') ?? 5001;
  }

  /**
   * Returns a stable proxy for a gRPC service name.
   *
   * The proxy defers endpoint resolution and underlying client acquisition until a concrete
   * RPC method is invoked, which keeps the public API synchronous for consumers while still
   * allowing late SRV discovery and client rotation.
   */
  getService<T extends object>(serviceName: string): T {
    const cachedService = this.serviceCache.get(serviceName);

    if (cachedService) {
      return cachedService as T;
    }

    // Keep one proxy instance per service name so callers reuse the same typed facade even if
    // the underlying gRPC client rotates after DNS changes.
    const service = new Proxy(
      {},
      {
        get: (_target, propertyKey) => {
          if (typeof propertyKey !== 'string') {
            return undefined;
          }

          return (...args: unknown[]) =>
            defer(async () => {
              const client = await this.getClient();
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

    this.serviceCache.set(serviceName, service);
    return service;
  }

  /**
   * Closes the cached underlying client during Nest shutdown.
   */
  onModuleDestroy() {
    this.cachedClient?.close?.();
  }

  /**
   * Returns the current low-level gRPC client.
   *
   * If SRV resolution now points at a different host:port, the previous client is closed and a
   * new one is created so subsequent RPCs follow the fresh discovery target.
   */
  private async getClient(): Promise<CloseableClientGrpc> {
    const resolvedUrl = await this.resolvePaymentsGrpcUrl();

    if (!this.cachedClient || this.cachedUrl !== resolvedUrl) {
      this.cachedClient?.close?.();
      this.cachedClient = ClientProxyFactory.create({
        options: {
          loader: { enums: String },
          package: 'payments',
          protoPath: this.protoPath,
          url: resolvedUrl,
        },
        transport: Transport.GRPC,
      }) as CloseableClientGrpc;
      this.cachedUrl = resolvedUrl;
    }

    return this.cachedClient;
  }

  /**
   * Resolves the payments endpoint for the next RPC.
   *
   * ECS bridge-mode service discovery exposes SRV records, so the service first tries SRV lookup.
   * Local Docker and simpler environments may not publish SRV, so the configured host:port remains
   * the supported fallback path.
   */
  private async resolvePaymentsGrpcUrl() {
    const configuredUrl = `${this.host}:${this.port}`;

    try {
      const records: PaymentsSrvRecord[] = await resolveSrv(this.host);

      if (records.length === 0) {
        this.logger.log(`Using configured payments gRPC endpoint ${configuredUrl}`);
        return configuredUrl;
      }

      const [record] = records
        .slice()
        .sort((left: PaymentsSrvRecord, right: PaymentsSrvRecord) =>
          compareSrvRecords(left, right),
        );

      if (!record) {
        this.logger.log(`Using configured payments gRPC endpoint ${configuredUrl}`);
        return configuredUrl;
      }

      const resolvedHost = record.name.replace(/\.$/, '');
      const resolvedUrl = `${resolvedHost}:${record.port}`;

      this.logger.log(`Resolved payments gRPC endpoint via SRV ${this.host} -> ${resolvedUrl}`);
      return resolvedUrl;
    } catch (error: unknown) {
      const errorCode = (error as { code?: string }).code;

      if (errorCode === 'ENODATA' || errorCode === 'ENOTFOUND' || errorCode === 'SERVFAIL') {
        this.logger.log(
          `Payments gRPC SRV not available for ${this.host} (${errorCode}); using configured endpoint ${configuredUrl}`,
        );

        return configuredUrl;
      }

      this.logger.warn(
        `Failed to resolve payments gRPC SRV for ${this.host} (${errorCode ?? 'unknown'}); falling back to configured endpoint ${configuredUrl}`,
      );

      return configuredUrl;
    }
  }
}
