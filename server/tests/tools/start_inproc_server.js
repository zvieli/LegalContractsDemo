#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const cwd = path.resolve(process.cwd());
const outLog = path.join(cwd, 'server.out.log');
const errLog = path.join(cwd, 'server.err.log');

function startServer() {
  const env = { ...process.env };
  env.SERVER_PORT = env.SERVER_PORT || '3002';
  env.HELIA_LOCAL_API = env.HELIA_LOCAL_API || 'inproc://local';
  env.START_INPROC_HELIA = 'true';

  const out = fs.openSync(outLog, 'a');
  const err = fs.openSync(errLog, 'a');

  const child = spawn(process.execPath, ['index.js'], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', out, err]
  });

  child.unref();
  console.log('Started server PID', child.pid, 'logs ->', outLog, errLog);
  return { pid: child.pid };
}

async function waitForHealth(url = 'http://localhost:3002/api/v7/arbitration/health', timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method: 'GET', timeout: 2000 });
      if (res.ok) {
        const j = await res.json();
        if (j && (j.healthy === true || j.health === 'healthy')) {
          console.log('Server health OK');
          return true;
        }
      }
    } catch (e) {
      // ignore and retry
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error('Timeout waiting for server health');
  return false;
}

async function main() {
  startServer();
  const ok = await waitForHealth();
  process.exit(ok ? 0 : 2);
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(10); });
