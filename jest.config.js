/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  projects: [
    {
      displayName: 'shop',
      rootDir: 'apps/shop',
      setupFilesAfterEnv: ['<rootDir>/../../jest.setup.ts'],
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: {
        '^.+\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@app/common(/.*)$': '<rootDir>/../../libs/common/src$1',
        '^@app/common$': '<rootDir>/../../libs/common/src',
      },
      testEnvironment: 'node',
      collectCoverageFrom: [
        'src/**/*.(t|j)s',
        '!src/**/*.spec.ts',
        '!src/**/*.module.ts',
        '!src/main.ts',
        '!src/data-source.ts',
        '!src/proto/**',
        '!src/db/migrations/**',
      ],
    },
    {
      displayName: 'payments',
      rootDir: 'apps/payments',
      setupFilesAfterEnv: ['<rootDir>/../../jest.setup.ts'],
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: {
        '^.+\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@app/common(/.*)$': '<rootDir>/../../libs/common/src$1',
        '^@app/common$': '<rootDir>/../../libs/common/src',
      },
      testEnvironment: 'node',
      collectCoverageFrom: [
        'src/**/*.(t|j)s',
        '!src/**/*.spec.ts',
        '!src/**/*.module.ts',
        '!src/main.ts',
        '!src/data-source.ts',
        '!src/proto/**',
        '!src/db/migrations/**',
      ],
    },
  ],
};
