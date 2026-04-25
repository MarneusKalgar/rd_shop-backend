import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, Observable, of } from 'rxjs';

import { PaymentsGrpcClientService } from './payments-grpc-client.service';

interface MockClientProxyCreateArgs {
  options: {
    url: string;
  };
}

interface MockGrpcClient {
  close: jest.Mock<void, []>;
  getService: jest.MockedFunction<(serviceName: string) => TestPaymentsService>;
}

interface MockSrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

interface TestPaymentsResponse {
  status: string;
}

interface TestPaymentsService {
  ping(): Observable<TestPaymentsResponse>;
}

const mockCreateClientProxy: jest.MockedFunction<
  (args: MockClientProxyCreateArgs) => MockGrpcClient
> = jest.fn();
const mockResolveSrv: jest.MockedFunction<(host: string) => Promise<MockSrvRecord[]>> = jest.fn();

jest.mock('node:dns/promises', () => ({
  resolveSrv: (host: string) => mockResolveSrv(host),
}));

jest.mock('@nestjs/microservices', () => ({
  ClientProxyFactory: {
    create: (args: MockClientProxyCreateArgs) => mockCreateClientProxy(args),
  },
  Transport: {
    GRPC: 'GRPC',
  },
}));

function createMockClient(grpcService: TestPaymentsService): MockGrpcClient {
  return {
    close: jest.fn<void, []>(),
    getService: jest.fn<TestPaymentsService, [serviceName: string]>().mockReturnValue(grpcService),
  };
}

function expectLastCreatedUrl(expectedUrl: string) {
  const lastCall = mockCreateClientProxy.mock.calls.at(-1);

  expect(lastCall?.[0].options.url).toBe(expectedUrl);
}

describe('PaymentsGrpcClientService', () => {
  const getMock = jest.fn();
  const getOrThrowMock = jest.fn();
  const loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  let service: PaymentsGrpcClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockReturnValue(5001);
    getOrThrowMock.mockReturnValue('payments.rd-shop.local');

    service = new PaymentsGrpcClientService({
      get: getMock,
      getOrThrow: getOrThrowMock,
    } as Partial<ConfigService> as ConfigService);
  });

  afterAll(() => {
    loggerLogSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  it('prefers lower-priority and higher-weight SRV records', async () => {
    mockResolveSrv.mockResolvedValue([
      { name: 'payments-low-weight.', port: 5001, priority: 10, weight: 5 },
      { name: 'payments-best.', port: 5002, priority: 10, weight: 20 },
      { name: 'payments-worse-priority.', port: 5003, priority: 20, weight: 100 },
    ]);

    const grpcService = { ping: jest.fn().mockReturnValue(of({ status: 'ok' })) };
    mockCreateClientProxy.mockReturnValue(createMockClient(grpcService));

    const paymentsService = service.getService<TestPaymentsService>('Payments');
    await firstValueFrom(paymentsService.ping());

    expectLastCreatedUrl('payments-best:5002');
  });

  it('falls back to the configured host when SRV lookup is unavailable', async () => {
    mockResolveSrv.mockRejectedValue({ code: 'ENOTFOUND' });

    const grpcService = { ping: jest.fn().mockReturnValue(of({ status: 'ok' })) };
    mockCreateClientProxy.mockReturnValue(createMockClient(grpcService));

    const paymentsService = service.getService<TestPaymentsService>('Payments');
    await firstValueFrom(paymentsService.ping());

    expectLastCreatedUrl('payments.rd-shop.local:5001');
  });

  it('returns a cached proxy and reuses the same client when the resolved URL is unchanged', async () => {
    mockResolveSrv.mockResolvedValue([
      { name: 'payments-stable.', port: 5001, priority: 10, weight: 10 },
    ]);

    const grpcService = { ping: jest.fn().mockReturnValue(of({ status: 'ok' })) };
    mockCreateClientProxy.mockReturnValue(createMockClient(grpcService));

    const firstProxy = service.getService<TestPaymentsService>('Payments');
    const secondProxy = service.getService<TestPaymentsService>('Payments');

    expect(firstProxy).toBe(secondProxy);

    await firstValueFrom(firstProxy.ping());
    await firstValueFrom(secondProxy.ping());

    expect(mockCreateClientProxy).toHaveBeenCalledTimes(1);
  });

  it('recreates the underlying client when the resolved endpoint changes', async () => {
    mockResolveSrv
      .mockResolvedValueOnce([{ name: 'payments-first.', port: 5001, priority: 10, weight: 10 }])
      .mockResolvedValueOnce([{ name: 'payments-second.', port: 5002, priority: 10, weight: 10 }]);

    const firstClient = createMockClient({
      ping: jest.fn().mockReturnValue(of({ status: 'ok' })),
    });
    const secondClient = createMockClient({
      ping: jest.fn().mockReturnValue(of({ status: 'ok' })),
    });
    mockCreateClientProxy.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const paymentsService = service.getService<TestPaymentsService>('Payments');
    await firstValueFrom(paymentsService.ping());
    await firstValueFrom(paymentsService.ping());

    expect(mockCreateClientProxy).toHaveBeenCalledTimes(2);
    expect(firstClient.close).toHaveBeenCalledTimes(1);
  });

  it('closes the cached client on module destroy', async () => {
    mockResolveSrv.mockResolvedValue([
      { name: 'payments-destroy.', port: 5001, priority: 10, weight: 10 },
    ]);

    const client = createMockClient({ ping: jest.fn().mockReturnValue(of({ status: 'ok' })) });
    mockCreateClientProxy.mockReturnValue(client);

    const paymentsService = service.getService<TestPaymentsService>('Payments');
    await firstValueFrom(paymentsService.ping());

    service.onModuleDestroy();

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
