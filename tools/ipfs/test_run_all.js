(async () => {
  try {
    const PIN_SERVER = process.env.PIN_SERVER_URL || 'http://127.0.0.1:8080';
  // Admin private key must be set for admin decrypt flow
  const ADMIN_PRIV = process.env.ADMIN_PRIVATE_KEY || process.env.PIN_SERVER_ADMIN_PRIVATE_KEY;

    const message = 'TEST EVIDENCE: ' + 'A'.repeat(1024);
    console.log('Posting to', `${PIN_SERVER}/pin`);
    const res = await fetch(`${PIN_SERVER}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cipherStr: message, pin: false, metadata: { test: 'docker-integration' } })
    });
    if (!res.ok) throw new Error('Pin request failed: ' + res.status);
    const j = await res.json();
    if (!j.id) throw new Error('Pin response missing id');
    const id = j.id;
    console.log('Pinned id', id);

    console.log('Requesting admin decrypt for', id);
    // Build simple admin typedData and sign it with ADMIN_PRIVATE_KEY
    if (!ADMIN_PRIV) throw new Error('ADMIN_PRIVATE_KEY not set');
    const { Wallet, TypedDataEncoder, SigningKey } = await import('ethers');
    const adminTypedData = { domain: { name: 'PinServerAdmin', version: '1' }, types: { AdminReveal: [{ name: 'pinId', type: 'string' }] }, value: { pinId: id } };
    const digest = TypedDataEncoder.hash(adminTypedData.domain, adminTypedData.types, adminTypedData.value);
    const sk = new SigningKey(ADMIN_PRIV);
    const sigObj = sk.sign(digest);
    const r = sigObj.r.replace(/^0x/, '');
    const s = sigObj.s.replace(/^0x/, '');
    const v = (typeof sigObj.yParity === 'number') ? (sigObj.yParity ? 28 : 27) : (sigObj.networkV || 27);
    const signature = '0x' + r + s + v.toString(16).padStart(2, '0');
    const res2 = await fetch(`${PIN_SERVER}/admin/decrypt/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminTypedData: adminTypedData, adminSignature: signature }) });
    if (!res2.ok) throw new Error('Admin decrypt failed: ' + res2.status);
    const j2 = await res2.json();
    console.log('Admin decrypt response', j2);
    const plain = j2.decrypted;
    if (plain === message || plain === `decrypted(${message})`) {
      console.log('Docker pin-server test: OK');
      process.exit(0);
    } else {
      console.error('Unexpected decrypted payload');
      process.exit(2);
    }
  } catch (err) {
    console.error('Test failed:', err && err.message);
    process.exit(1);
  }
})();
