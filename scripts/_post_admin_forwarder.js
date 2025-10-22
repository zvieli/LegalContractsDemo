import fetch from 'node-fetch';

(async () => {
  try {
    const res = await fetch('http://localhost:3001/api/admin/forwarder/forward-evidence', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      },
      body: JSON.stringify({ evidenceRef: 'test-evidence://manual', caseId: 'TEST', contractAddress: '0x0' })
    });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log('BODY', text);
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(1);
  }
})();
