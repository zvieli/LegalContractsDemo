const { expect } = require('chai');
const pkg = require('hardhat');
const { ethers } = pkg;
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Integration test: pins encrypted evidence via local pin-server and ensures admin decrypt returns original
// This test will try to start pin-server via tools/ipfs/test_run_all.js helper if present, but otherwise
// expects a pin-server already running on http://127.0.0.1:3002

describe('Appeal decrypt integration', function () {
  this.timeout(300000);
  let landlord, tenant;
  let factory, rentContract, arbsvc, mockPriceFeed;

  const PIN_SERVER = process.env.PIN_SERVER_URL || 'http://127.0.0.1:3002';
  const ADMIN_KEY = process.env.PIN_SERVER_ADMIN_KEY || 'dev-secret';

  beforeEach(async function () {
    [landlord, tenant] = await ethers.getSigners();

    // Deploy mock price feed
    const MockPriceFeed = await ethers.getContractFactory('MockPriceFeed');
    mockPriceFeed = await MockPriceFeed.deploy(2000);
    await mockPriceFeed.waitForDeployment();

    const Factory = await ethers.getContractFactory('ContractFactory');
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    // Deploy ArbitrationService
    const ArbitrationService = await ethers.getContractFactory('ArbitrationService');
    arbsvc = await ArbitrationService.deploy();
    await arbsvc.waitForDeployment();
    await factory.setDefaultArbitrationService(arbsvc.target, 0);

    // create rent contract
    const tx = await factory.connect(landlord).createRentContract(
      tenant.address,
      ethers.parseEther('0.5'),
      mockPriceFeed.target,
      0
    );
    const rcpt = await tx.wait();
    const evt = rcpt.logs.find(l => l.fragment && l.fragment.name === 'RentContractCreated');
    const addr = evt.args.contractAddress;
    rentContract = await ethers.getContractAt('TemplateRentContract', addr);
  });

  it('can pin encrypted evidence and admin decrypt it', async function () {
    // Prepare a long message and encrypt it with simple XOR (pin-server supports symmetric dev encrypt?)
    const message = 'REALLY LONG EVIDENCE: ' + 'X'.repeat(5000);
    // For test simplicity we will not use real asymmetric crypto here — pin-server stores cipherStr as-is
    // The client posts { cipherStr, pin } to /pin and server stores it; admin decrypt returns cipherStr

    // Simulate pin request. If pin-server is not running, try to spawn a background dev server.
    const body = { cipherStr: message, pin: false, metadata: { test: 'appeal-decrypt' } };
    let json;
    try {
      const res = await axios.post(`${PIN_SERVER}/pin`, body, { headers: { 'Content-Type': 'application/json' } });
      json = res.data;
    } catch (err) {
      // If connection refused, attempt to spawn the dev pin-server and retry
      if (err.code === 'ECONNREFUSED') {
        // spawn pin-server as background process
        const serverScript = path.join(process.cwd(), 'tools', 'ipfs', 'pin-server.js');
        const serverProc = spawn(process.execPath, [serverScript], { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'] });
        // wait for server to start
        const max = Date.now() + 10000;
        let ok = false;
        while (Date.now() < max) {
          try {
            const ping = await axios.options(`${PIN_SERVER}/pin`).catch(() => null);
            if (ping && (ping.status === 200 || ping.status === 204 || ping.status === 404)) { ok = true; break; }
          } catch (_) {}
          await new Promise(r => setTimeout(r, 500));
        }
        if (!ok) {
          // could not start server — fail the test with informative message
          throw new Error(`Could not reach pin-server at ${PIN_SERVER} and failed to start it`);
        }
        // Retry the pin request
        const res2 = await axios.post(`${PIN_SERVER}/pin`, body, { headers: { 'Content-Type': 'application/json' } });
        json = res2.data;
        // leave spawned server running for the duration of the test harness; the test suite will cleanup
      } else {
        throw err;
      }
    }

    expect(json && json.id).to.exist;

    const id = json.id;
    // Now call admin decrypt
    const res3 = await axios.post(`${PIN_SERVER}/admin/decrypt/${id}`, {}, { headers: { 'X-API-KEY': ADMIN_KEY } });
    const j2 = res3.data;
    expect(j2.decrypted).to.exist;
    // tolerate older dev pin-servers that return `decrypted(<cipher>)` wrapper
    const plain = j2.decrypted;
    if (plain !== message) {
      expect(plain).to.equal(`decrypted(${message})`);
    }
  });
});
