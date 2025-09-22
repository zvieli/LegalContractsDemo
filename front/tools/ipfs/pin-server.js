#!/usr/bin/env node
// ESM-compatible shim to forward to the repository-level pin-server implementation.
// Some tests run with `front` as cwd and expect this path. Delegate to root implementation.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  // Compute root path relative to this shim: ../../../tools/ipfs/pin-server.js
  const rootShim = path.join(__dirname, '..', '..', '..', 'tools', 'ipfs', 'pin-server.js');
  const rootUrl = pathToFileURL(rootShim).href;
  // Dynamic import should work for CommonJS scripts as well in Node >= 12+; delegate execution
  await import(rootUrl);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('Failed to start pin-server shim:', err);
  throw err;
}
