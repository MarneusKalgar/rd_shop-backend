/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  coverageDirectory: './coverage',
  collectCoverageFrom: ['apps/**/*.(t|j)s'],
  projects: [
    {
      displayName: 'shop',
      rootDir: 'apps/shop',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@app/common(/.*)$': '<rootDir>/../../libs/common/src$1',
        '^@app/common$': '<rootDir>/../../libs/common/src',
      },
      testEnvironment: 'node',
    },
    {
      displayName: 'payments',
      rootDir: 'apps/payments',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@app/common(/.*)$': '<rootDir>/../../libs/common/src$1',
        '^@app/common$': '<rootDir>/../../libs/common/src',
      },
      testEnvironment: 'node',
    },
  ],
};
