/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/unit_tests', '<rootDir>/src'],
      testMatch: ['<rootDir>/unit_tests/**/*.spec.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      moduleNameMapper: {
        '^sequelize$': '<rootDir>/src/__mocks__/sequelize.mock.ts',
        // All relative paths that resolve to src/config/database map to
        // the mock. Each pattern covers a different caller depth so both
        // app code and unit test files share the same singleton.
        '^../config/database$': '<rootDir>/src/__mocks__/sequelize.mock.ts',
        '^../../config/database$': '<rootDir>/src/__mocks__/sequelize.mock.ts',
        '^../src/config/database$': '<rootDir>/src/__mocks__/sequelize.mock.ts',
        '^../../src/config/database$': '<rootDir>/src/__mocks__/sequelize.mock.ts',
      },
      // Per-suite teardown closes the winston console transport so the
      // worker process can exit cleanly. See unit_tests/jest.setup.ts.
      setupFilesAfterEnv: ['<rootDir>/unit_tests/jest.setup.ts'],
    },
    {
      displayName: 'api',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/API_tests', '<rootDir>/src'],
      testMatch: ['<rootDir>/API_tests/**/*.spec.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
      // Probes MySQL exactly once before any spec file loads. Stores
      // result in DB_AVAILABLE so specs can skip cleanly instead of
      // crashing with ECONNREFUSED. See API_tests/global-setup.ts.
      globalSetup: '<rootDir>/API_tests/global-setup.ts',
      // Per-suite teardown closes the winston console transport so the
      // worker process can exit cleanly. Same teardown as the unit
      // project — see unit_tests/jest.setup.ts.
      setupFilesAfterEnv: ['<rootDir>/unit_tests/jest.setup.ts'],
    },
  ],
};
