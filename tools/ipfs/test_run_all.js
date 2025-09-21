(async () => {
  try {
    const PIN_SERVER = process.env.PIN_SERVER_URL || 'http://127.0.0.1:8080';
    const ADMIN_KEY = process.env.PIN_SERVER_ADMIN_KEY || 'dev-secret';

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
    const res2 = await fetch(`${PIN_SERVER}/admin/decrypt/${id}`, {
      method: 'POST',
      headers: { 'X-API-KEY': ADMIN_KEY }
    });
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
