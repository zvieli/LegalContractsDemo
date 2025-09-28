// Quick test: start evidence endpoint in-process on an ephemeral port, POST a sample payload,
// print the response, then stop the server and exit.
const { startEvidenceEndpoint, stopEvidenceEndpoint } = require('./evidence-endpoint.cjs');

(async () => {
  try {
    // Prefer noble for deterministic test runs in CI/local if available
    process.env.SUPPORT_NOBLE_SECP = process.env.SUPPORT_NOBLE_SECP || '1';
    process.env.TESTING = '1';

    console.error('Starting evidence endpoint (ephemeral port) ...');
    const server = await startEvidenceEndpoint(0);
    const addr = server.address();
    const port = addr && addr.port ? addr.port : 5001;
    console.error('Endpoint started on port', port);

    // POST sample evidence
    const payload = { note: 'test evidence from automated front-end check', ts: Date.now() };
    const url = `http://127.0.0.1:${port}/submit-evidence`;
    console.error('Posting to', url);

    // Use node fetch (available in Node >=18)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = await res.text(); }
    console.error('Response status', res.status);
    console.log('Response body:', body);

    console.error('Shutting down endpoint...');
    await stopEvidenceEndpoint(server);
    console.error('Done.');
    process.exit(0);
  } catch (e) {
    console.error('Test error', e && e.stack ? e.stack : e);
    process.exit(2);
  }
})();
