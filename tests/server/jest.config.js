const path = require('path');
const serverRoot = path.resolve(__dirname, '../../server');

// Ensure NODE_ENV=test before any module is loaded
process.env.NODE_ENV = 'test';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  // NOTE: server suites share the singleton `db` (server/src/db) against a
  // persistent SQLite file, so a full run must start from a freshly-migrated
  // DB (the npm test flow does this). Cross-suite data isolation is known-
  // fragile and tracked separately; run with --runInBand on a fresh DB for
  // deterministic results.
  maxWorkers: 1,
  moduleDirectories: ['node_modules', path.join(serverRoot, 'node_modules')],
  transform: {
    '^.+\\.tsx?$': [
      path.join(serverRoot, 'node_modules/ts-jest'),
      {
        tsconfig: path.join(serverRoot, 'tsconfig.test.json'),
        diagnostics: { ignoreCodes: ['TS2307'] },
      },
    ],
  },
};
