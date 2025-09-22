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

    // start the pin-server process with ADMIN_PRIVATE_KEY set for admin signature auth
    // The test environment must provide ADMIN_PRIVATE_KEY; inherit from process.env if present
    const spawnEnv = Object.assign({}, process.env);
    if (!spawnEnv.ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY must be set for pin-server integration test');
    serverProc = spawn(process.execPath, ['tools/ipfs/pin-server.js'], { env: spawnEnv, stdio: ['ignore', 'pipe', 'pipe'] });
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

    // perform admin decrypt by signing admin typedData with ADMIN_PRIVATE_KEY
    if (!process.env.ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY must be set for this test');
    const { TypedDataEncoder, SigningKey } = (await import('ethers'));
    const adminTypedData = { domain: { name: 'PinServerAdmin', version: '1' }, types: { AdminReveal: [{ name: 'pinId', type: 'string' }] }, value: { pinId: testId } };
    const digest = TypedDataEncoder.hash(adminTypedData.domain, adminTypedData.types, adminTypedData.value);
    const sk = new SigningKey(process.env.ADMIN_PRIVATE_KEY);
    const sigObj = sk.sign(digest);
    const r = sigObj.r.replace(/^0x/, '');
    const s = sigObj.s.replace(/^0x/, '');
    const v = (typeof sigObj.yParity === 'number') ? (sigObj.yParity ? 28 : 27) : (sigObj.networkV || 27);
    const signature = '0x' + r + s + v.toString(16).padStart(2, '0');
    const res2 = await nodeFetch(`http://localhost:8080/admin/decrypt/${testId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminTypedData, adminSignature: signature }) });
    expect(res2.ok).to.be.true;
    const body = await res2.json();
    expect(body.decrypted).to.equal('decrypted(cipher123)');
    });
});
