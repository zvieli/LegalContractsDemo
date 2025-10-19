#!/usr/bin/env node
// ensure-root.js
// Small helper: ensure tests are invoked from repository root (where hardhat.config.js exists)
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const rootMarker = ['hardhat.config.js', 'package.json'];

const found = rootMarker.some((m) => fs.existsSync(path.resolve(cwd, m)));

if (!found) {
  console.error(`
  ERROR: Tests should be run from the repository root.
  Current working directory: ${cwd}

  Please run tests from the project root (where hardhat.config.js exists), e.g.:

    cd ${path.resolve(cwd, '..')}
    npm test

  Or run from the repository root directly:

    (cd ${path.resolve(cwd, '..')} ; npm test)

  Running tests from subfolders (like /server) can lead to ENOENT errors while resolving fixtures.
  `);
  process.exitCode = 1;
  process.exit(1);
}

// all good
process.exit(0);
