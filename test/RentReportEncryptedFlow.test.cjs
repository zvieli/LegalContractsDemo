const { ethers } = require('hardhat');
const { expect } = require('chai');
const EthCrypto = require('eth-crypto');

describe('TemplateRentContract - encrypted evidence flow', function () {
  this.timeout(120000);

  it('client encrypts to admin pubkey, contract stores evidence digest, admin can decrypt locally', async function () {
    const [deployer] = await ethers.getSigners();

    // Deploy TemplateRentContract minimal args (owner fields unused for this test)
  const Rent = await ethers.getContractFactory('TemplateRentContract');
  // constructor now accepts an additional bytes32 initialEvidenceDigest; pass zero digest for tests that don't require it
  const rent = await Rent.deploy(deployer.address, deployer.address, 1, 0, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0, '0x' + '00'.repeat(32));
    await rent.waitForDeployment();

    // Test admin keypair (in real use admin private key stays offline). Use eth-crypto to make compatible keys.
    const adminIdentity = EthCrypto.createIdentity();
    // adminIdentity.publicKey is the unprefixed public key (starting with '04') sometimes; ensure we pass correct form
    const pubRaw = adminIdentity.publicKey.startsWith('0x') ? adminIdentity.publicKey.slice(2) : (adminIdentity.publicKey.startsWith('04') ? adminIdentity.publicKey.slice(2) : adminIdentity.publicKey);

  const plaintext = 'Important evidence: ' + 'E'.repeat(512);
  // EthCrypto expects the raw public key (no 0x, no leading 04 when using encryptWithPublicKey helper)
  const encrypted = await EthCrypto.encryptWithPublicKey(pubRaw, String(plaintext));
  const payloadStr = JSON.stringify(encrypted);
  const digest = ethers.keccak256(ethers.toUtf8Bytes(payloadStr));

  // Call contract method that stores only the digest (no on-chain ciphertext)
  // Provide a small requestedAmount and send the required reporter bond (0.5% of requestedAmount, min 1)
  const requestedAmount = 1000; // wei (test value)
  const requiredBond = Math.max(Math.floor((requestedAmount * 5) / 1000), 1);
  await rent.reportDispute(0, requestedAmount, digest, { value: requiredBond });

    // Read back stored digest
  const storedDigest = await rent.getDisputeDigest(0);
  const dispute = await rent.getDispute(0);
  const returnedDigest = dispute[3];

  console.log('computed digest:', digest);
  console.log('storedDigest   :', storedDigest);
  console.log('returnedDigest :', returnedDigest);

  expect(storedDigest).to.equal(digest);
  expect(returnedDigest).to.equal(digest);

    // Admin would decrypt the ciphertext locally — contract does not store ciphertext after this change.
    const decrypted = await EthCrypto.decryptWithPrivateKey(adminIdentity.privateKey, encrypted);
    expect(decrypted).to.equal(plaintext);
  });
});
