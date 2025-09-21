const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

describe('Pin server integration', function () {
    this.timeout(10000);
    let serverProc;
    const storeDir = path.join(__dirname, '..', 'tools', 'ipfs', 'store');
    const testId = 'test1';

    before(async () => {
        // ensure store dir and write a test file
        fs.mkdirSync(storeDir, { recursive: true });
        const rec = { id: testId, cipherStr: 'cipher123', meta: { filename: 'evidence.pdf' } };
        fs.writeFileSync(path.join(storeDir, `${testId}.json`), JSON.stringify(rec));

        // start the pin-server process with a known API key and poll the HTTP endpoint until available
        serverProc = spawn(process.execPath, ['tools/ipfs/pin-server.js'], { env: Object.assign({}, process.env, { PIN_SERVER_API_KEY: 'dev-secret', ADMIN_PRIVATE_KEY: 'priv' }), stdio: ['ignore', 'pipe', 'pipe'] });
        serverProc.stdout.on('data', (d) => console.log('pin-server-out:', d.toString().trim()));
        serverProc.stderr.on('data', (d) => console.error('pin-server-err:', d.toString().trim()));

        // poll the HTTP server until it responds on /pin/test
        const nodeFetch = (await import('node-fetch')).default;
        const max = Date.now() + 10000;
        let ok = false;
        while (Date.now() < max) {
            try {
                const r = await nodeFetch('http://localhost:8080/pin/test', { method: 'OPTIONS' });
                if (r && (r.status === 204 || r.status === 200 || r.status === 404)) { ok = true; break; }
            } catch (e) {
                // ignore and retry
            }
            await new Promise(r => setTimeout(r, 200));
        }
        if (!ok) throw new Error('pin-server did not start in time');
    });

    after(() => {
        try { serverProc && serverProc.kill(); } catch (e) {}
        try { fs.unlinkSync(path.join(storeDir, `${testId}.json`)); } catch (e) {}
    });

    it('fetches pinned record and admin decrypts', async () => {
        // dynamically import node-fetch to avoid CJS/ESM interop problems in mocha
        const nodeFetch = (await import('node-fetch')).default;
        const res = await nodeFetch(`http://localhost:8080/pin/${testId}`);
        expect(res.ok).to.be.true;
        const rec = await res.json();
        expect(rec.id).to.equal(testId);

        const res2 = await nodeFetch(`http://localhost:8080/admin/decrypt/${testId}`, { method: 'POST', headers: { 'X-API-KEY': 'dev-secret' } });
        expect(res2.ok).to.be.true;
        const body = await res2.json();
        expect(body.decrypted).to.equal('decrypted(cipher123)');
    });
});
