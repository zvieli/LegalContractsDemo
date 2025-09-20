const { expect } = require('chai');

describe('ipfs util buildCidUrl', function() {
  const CID = 'QmTestCid12345';
  const originalProcessEnv = { ...process.env };
  const originalGlobal = { __VITE_PIN_SERVER_URL__: global.__VITE_PIN_SERVER_URL__ };
  const originalLocalStorage = global.localStorage;

  afterEach(() => {
    // restore
    process.env = { ...originalProcessEnv };
    if (originalGlobal.__VITE_PIN_SERVER_URL__ !== undefined) global.__VITE_PIN_SERVER_URL__ = originalGlobal.__VITE_PIN_SERVER_URL__;
    else delete global.__VITE_PIN_SERVER_URL__;
    if (originalLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalLocalStorage;
  });

  it('prefers VITE import.meta env (simulated via global shim)', async () => {
    global.__VITE_PIN_SERVER_URL__ = 'http://vite-pin.local:8080';
    delete process.env.REACT_APP_PIN_SERVER_URL;
    delete global.localStorage;
    const mod = await import('../front/src/utils/ipfs.js');
    const url = mod.buildCidUrl(CID);
    expect(url).to.equal('http://vite-pin.local:8080/ipfs/' + CID);
  });

  it('falls back to REACT_APP_PIN_SERVER_URL when vite not present', async () => {
    delete global.__VITE_PIN_SERVER_URL__;
    process.env.REACT_APP_PIN_SERVER_URL = 'http://react-pin.local:3000';
    delete global.localStorage;
    const mod = await import('../front/src/utils/ipfs.js');
    const url = mod.buildCidUrl(CID);
    expect(url).to.equal('http://react-pin.local:3000/ipfs/' + CID);
  });

  it('normalizes trailing slash on configured gateway', async () => {
    delete global.__VITE_PIN_SERVER_URL__;
    // include trailing slash
    process.env.REACT_APP_PIN_SERVER_URL = 'http://react-pin.local:3000/';
    delete global.localStorage;
    const mod = await import('../front/src/utils/ipfs.js');
    const url = mod.buildCidUrl(CID);
    // should not introduce double slashes
    expect(url).to.equal('http://react-pin.local:3000/ipfs/' + CID);
  });

  it('uses localStorage.PIN_SERVER_URL when present', async () => {
    delete global.__VITE_PIN_SERVER_URL__;
    delete process.env.REACT_APP_PIN_SERVER_URL;
    global.localStorage = {
      getItem: (k) => (k === 'PIN_SERVER_URL' ? 'http://local-pin:4000' : null)
    };
    const mod = await import('../front/src/utils/ipfs.js');
    const url = mod.buildCidUrl(CID);
    expect(url).to.equal('http://local-pin:4000/ipfs/' + CID);
  });

  it('falls back to ipfs.io when nothing configured', async () => {
    delete global.__VITE_PIN_SERVER_URL__;
    delete process.env.REACT_APP_PIN_SERVER_URL;
    delete global.localStorage;
    const mod = await import('../front/src/utils/ipfs.js');
    const url = mod.buildCidUrl(CID);
    expect(url).to.equal('https://ipfs.io/ipfs/' + CID);
  });

  it('normalizeGatewayUrl handles multiple trailing slashes and whitespace', async () => {
    const mod = await import('../front/src/utils/ipfs.js');
    const cases = [
      { in: 'http://example.com///', out: 'http://example.com' },
      { in: '  http://example.com//  ', out: 'http://example.com' },
      { in: '\nhttp://example.com/\t', out: 'http://example.com' }
    ];
    for (const c of cases) {
      const n = mod.normalizeGatewayUrl(c.in);
      expect(n).to.equal(c.out);
    }
  });
});
