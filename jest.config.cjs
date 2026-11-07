/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2023',
          module: 'CommonJS',
          moduleResolution: 'Node',
        },
      },
    ],
  },
  clearMocks: true,
  collectCoverageFrom: ['packages/*/src/**/*.ts', '!packages/*/src/index.ts'],
};
