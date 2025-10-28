#!/usr/bin/env node
// ESM diagnostic fetch script that prints response status, headers and body.
import fs from 'fs';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/diagFetch.js <url> [outFilePrefix]');
    process.exit(2);
  }
  const prefix = process.argv[3] || 'tmp/diag';
  try {
    if (typeof global.fetch !== 'function') {
      try {
        const nf = await import('node-fetch');
        global.fetch = nf.default || nf;
      } catch (e) {
        // ignore; Node v18+ should have fetch
      }
    }
    console.log('Fetching', url);
    const resp = await fetch(url, { method: 'GET' });
    console.log('HTTP', resp.status, resp.statusText);
    const headers = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    console.log('Headers:', JSON.stringify(headers, null, 2));
    const text = await resp.text();
    console.log('Body length:', text ? text.length : 0);
    const outPath = `${prefix}-${Date.now()}.txt`;
    try {
      fs.mkdirSync('tmp', { recursive: true });
      fs.writeFileSync(outPath, text, 'utf8');
      console.log('Saved body to', outPath);
    } catch (e) {
      console.warn('Failed to save body:', e && e.message ? e.message : String(e));
    }
    console.log('Response body preview:\n', text.slice(0, 200));
    process.exit(resp.ok ? 0 : 1);
  } catch (err) {
    console.error('Fetch error:', err && err.message ? err.message : err);
    process.exit(3);
  }
}

main();
