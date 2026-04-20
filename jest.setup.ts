import { Logger } from '@nestjs/common';

/**
 * Silences NestJS Logger output in unit tests by default.
 * Set VERBOSE_TEST_LOGS=true to let logs flow through (useful for debugging failures).
 *
 * @example
 *   VERBOSE_TEST_LOGS=true npm test
 */
if (process.env.VERBOSE_TEST_LOGS !== 'true') {
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let verboseSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    verboseSpy = jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    logSpy?.mockRestore();
    debugSpy?.mockRestore();
    verboseSpy?.mockRestore();
    warnSpy?.mockRestore();
    errorSpy?.mockRestore();
  });
}
