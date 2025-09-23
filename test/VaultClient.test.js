import http from 'http';
import { fetchFromVault } from '../tools/admin/vaultClient.js';
import assert from 'assert';

describe('Vault client (mock)', function() {
  it('fetches a secret from a mock KV v2 response', async function() {
    const secret = { data: { data: { privateKey: '0xdeadbeef' } } };

    const server = http.createServer((req, res) => {
      // simple matcher for any request - return the KV v2 shaped payload
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify(secret));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}`;

    try {
      const val = await fetchFromVault(url, 'fake-token', '/v1/secret/data/admin', 'privateKey');
      assert.strictEqual(val, '0xdeadbeef');
    } finally {
      server.close();
    }
  });
});
