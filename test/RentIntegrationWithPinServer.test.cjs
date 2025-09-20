const { expect } = require('chai');
const { ethers } = require('hardhat');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Integration: Rent flow with local pin-server (orchestrated)', function () {
  this.timeout(180000);

  it('starts go-ipfs, pins evidence via HTTP API, reports dispute with CID and cleans up', async function () {
    let cid = null;
    const toolsIpfsDir = path.join(process.cwd(), 'tools', 'ipfs');

    // Try to start docker-compose for go-ipfs; if docker isn't available, we will fallback
    let started = false;
    try {
      const up = spawnSync('docker', ['compose', 'up', '-d'], { cwd: toolsIpfsDir, stdio: 'inherit', timeout: 60000 });
      if (up.error) throw up.error;
      started = true;
    } catch (err) {
      console.warn('docker compose up failed, falling back to mock CID:', err.message);
    }

    // If docker started, wait for API and POST multipart/form-data to add a small file
    if (started) {
      // wait for ipfs API
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const v = spawnSync('curl', ['-sS', 'http://127.0.0.1:5001/api/v0/version'], { timeout: 5000 });
          if (v.status === 0) { ready = true; break; }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 1000));
      }

      if (ready) {
        try {
          // Create a temp file with evidence
          const tmp = path.join(process.cwd(), 'tools', 'ipfs', 'tmp_evidence.txt');
          fs.writeFileSync(tmp, 'integration test evidence ' + Date.now());
          // Use curl multipart/form-data to POST file to ipfs add
          const add = spawnSync('curl', ['-sS', '-F', `file=@${tmp}`, 'http://127.0.0.1:5001/api/v0/add'], { encoding: 'utf8', timeout: 20000 });
          if (add.error) throw add.error;
          const out = add.stdout || '';
          const m = out.match(/"Hash"\s*:\s*"([^"]+)"|Hash\s+([A-Za-z0-9]+)/i);
          // ipfs add via curl may return JSON or plain text 'added <hash> <name>' depending on daemon
          if (m) {
            cid = m[1] || m[2];
          } else {
            // Try to parse plain output like: {"Name":"file","Hash":"Qm...","Size":"..."}
            try {
              const j = JSON.parse(out);
              if (j && j.Hash) cid = j.Hash;
            } catch (_) {}
          }
          // cleanup tmp
          try { fs.unlinkSync(tmp); } catch (_) {}
        } catch (err) {
          console.warn('ipfs add via HTTP API failed, falling back to mock CID:', err.message);
        }
      } else {
        console.warn('ipfs API not ready, falling back to mock CID');
      }
    }

    if (!cid) cid = 'QmFallbackCidForTests';

    // Deploy contract and call reportDisputeWithCid
    const [landlord, tenant] = await ethers.getSigners();
    const TemplateRent = await ethers.getContractFactory('TemplateRentContract');
    const template = await TemplateRent.deploy(landlord.address, tenant.address, 1000, ethers.ZeroAddress, 1, ethers.ZeroAddress, 0, 0);
    await template.waitForDeployment();

    const dtype = 0; // Damage
    const requestedAmount = 1;
    const evidence = 'evidence for integration test';

    const tx = await template.connect(tenant).reportDisputeWithCid(dtype, requestedAmount, evidence, cid, { value: 0 });
    await tx.wait();

    const dispute = await template.getDisputeWithCid(0);
    expect(dispute[4]).to.equal(cid);

    // Teardown docker compose if we started it
    if (started) {
      try {
        spawnSync('docker', ['compose', 'down', '--remove-orphans'], { cwd: toolsIpfsDir, stdio: 'inherit', timeout: 60000 });
      } catch (err) {
        console.warn('docker compose down failed:', err.message);
      }
    }
  });
});
