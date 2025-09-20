#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

// Compute repository root: if running from tools/ipfs, go up two levels to repo root,
// otherwise assume current working directory is already the repo root.
let root = path.resolve(process.cwd());
if (path.basename(root) === 'ipfs' && path.basename(path.dirname(root)) === 'tools') {
  root = path.resolve(root, '..', '..');
}
const serverScript = path.join(root, 'tools', 'ipfs', 'pin-server.js');
const testScript = path.join(root, 'tools', 'ipfs', 'test_pin_and_decrypt.js');

async function waitForServer(url, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url, { method: 'POST' });
      // pinging /api/v0/version or pin server root
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

(async () => {
  // If a server is already listening on 3002, reuse it. Otherwise start a new background server.
  console.log('Integration: checking for existing pin-server on port 3002...');
  let node = null;
  let serverAlreadyRunning = false;
  let broughtUpDocker = false;
  // If docker is available and no existing pin-server, bring up go-ipfs for deterministic CIDs
  try {
    if (!serverAlreadyRunning) {
      const which = spawnSync('docker', ['--version'], { stdio: 'ignore' });
      if (which.status === 0) {
        console.log('Integration: docker detected, starting go-ipfs container...');
        spawnSync('docker', ['compose', 'up', '-d'], { cwd: path.join(root, 'tools', 'ipfs'), stdio: 'inherit' });
        broughtUpDocker = true;
        // wait for go-ipfs API
        const max = Date.now() + 20000;
        while (Date.now() < max) {
          try {
            const v = await fetch('http://127.0.0.1:5001/api/v0/version', { method: 'POST' }).catch(() => null);
            if (v && v.ok) break;
          } catch (_) {}
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  } catch (e) {}
  try {
    const health = await fetch('http://127.0.0.1:3002/pin', { method: 'OPTIONS' }).catch(() => null);
    if (health && (health.status === 200 || health.status === 204 || health.status === 404)) {
      console.log('Integration: found existing pin-server, reusing it.');
      serverAlreadyRunning = true;
    }
  } catch (e) {}
  if (!serverAlreadyRunning) {
    console.log('Integration: starting pin-server as background process...');
    node = spawn(process.execPath, [serverScript], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
    // give server a moment
    await new Promise(r => setTimeout(r, 1000));
  }

  try {
  console.log('Integration: running test harness...');
  // Run the test harness from the repository root so it can locate tools/ipfs/.env
  const run = spawn(process.execPath, [testScript], { cwd: root, stdio: 'inherit' });
    const code = await new Promise(resolve => run.on('close', resolve));
    if (code !== 0) throw new Error('test harness failed with code ' + code);
    console.log('Integration: test harness completed successfully');
  } catch (e) {
    console.error('Integration: error', e);
    process.exit(1);
  } finally {
    if (node && !serverAlreadyRunning) {
      console.log('Integration: stopping background pin-server');
      try { process.kill(node.pid); } catch (e) {}
      if (broughtUpDocker) {
        try {
          console.log('Integration: tearing down go-ipfs docker-compose...');
          spawnSync('docker', ['compose', 'down', '--remove-orphans'], { cwd: path.join(root, 'tools', 'ipfs'), stdio: 'inherit' });
        } catch (e) {}
      }
    } else {
      console.log('Integration: leaving existing server running');
    }
  }
})();
