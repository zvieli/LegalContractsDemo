import fetch from 'node-fetch';
import fs from 'fs';

async function run() {
  try {
    // Prepare sample evidence
    const evidence = {
      type: 'customClause',
      content: 'This is test evidence for an end-to-end forwarder run.',
      description: 'E2E test evidence',
      metadata: { contractAddress: '0x0000000000000000000000000000000000000000', disputeType: 'TEST' }
    };

    // Upload to backend evidence endpoint to get a helia CID
    const uploadRes = await fetch('http://localhost:3001/api/evidence/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(evidence)
    });
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok) {
      console.error('Upload failed:', uploadJson);
      process.exit(1);
    }
    console.log('Upload response:', uploadJson);
    const cid = uploadJson.cid;
    const heliaRef = `helia://${cid}`;

    // Determine admin key: prefer runtime env, fall back to server/.env values
    let adminKey = process.env.VITE_PLATFORM_ADMIN || process.env.PLATFORM_ADMIN_ADDRESS || '';
    if (!adminKey) {
      try {
        const envText = fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8');
        const match = envText.match(/^(?:VITE_PLATFORM_ADMIN|PLATFORM_ADMIN_ADDRESS)=(.+)$/m);
        if (match) adminKey = match[1].trim();
      } catch (e) {
        // ignore
      }
    }

    const forwardRes = await fetch('http://localhost:3001/api/admin/forwarder/forward-evidence', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': adminKey
      },
      body: JSON.stringify({ evidenceRef: heliaRef, caseId: `E2E-${Date.now()}`, contractAddress: '0x0000000000000000000000000000000000000000' })
    });
    const forwardJson = await forwardRes.json();
    console.log('Forward response:', forwardJson);
  } catch (err) {
    console.error('Error during upload_and_forward:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

run();
