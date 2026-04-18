import CircuitBreaker from 'opossum';

export const PAYMENTS_GRPC_CLIENT = 'PAYMENTS_GRPC_CLIENT';

export const BREAKER_OPTIONS: CircuitBreaker.Options = {
  errorThresholdPercentage: 50,
  resetTimeout: 10_000,
  timeout: false, // rxjs timeout is the inner guard; breaker timeout is disabled to avoid double-wrapping
  volumeThreshold: 5,
};
