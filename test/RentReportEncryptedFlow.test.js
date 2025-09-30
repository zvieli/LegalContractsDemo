import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';
import EthCrypto from 'eth-crypto';
import ecies from '../tools/crypto/ecies.js';

describe('TemplateRentContract - encrypted evidence flow', function () {
  this.timeout(120000);

  it('client encrypts to admin pubkey, contract stores evidence digest, admin can decrypt locally', async function () {
    const [deployer] = await ethers.getSigners();

    const Rent = await ethers.getContractFactory('TemplateRentContract');
    const rent = await Rent.deploy(deployer.address, deployer.address, 1, 0, ethers.ZeroAddress, 0, ethers.ZeroAddress, 0, '0x' + '00'.repeat(32));
    await rent.waitForDeployment();

  const adminIdentity = EthCrypto.createIdentity();
  const pubRaw = adminIdentity.publicKey.startsWith('0x') ? adminIdentity.publicKey.slice(2) : (adminIdentity.publicKey.startsWith('04') ? adminIdentity.publicKey.slice(2) : adminIdentity.publicKey);
  const pubHex = adminIdentity.publicKey.startsWith('0x') ? adminIdentity.publicKey.slice(2) : adminIdentity.publicKey;

  const plaintext = 'Important evidence: ' + 'E'.repeat(512);
  // Use canonical ECIES (server-side) to encrypt the payload
  const encrypted = await ecies.encryptWithPublicKey(pubHex.startsWith('04') ? pubHex : ('04' + pubHex), String(plaintext));
    const payloadStr = JSON.stringify(encrypted);
    const digest = ethers.keccak256(ethers.toUtf8Bytes(payloadStr));

    const requestedAmount = 1000; // wei (test value)
    const requiredBond = Math.max(Math.floor((requestedAmount * 5) / 1000), 1);
    await rent.reportDispute(0, requestedAmount, digest, { value: requiredBond });

    const storedRef = await rent.getDisputeUri(0);
    const dispute = await rent.getDispute(0);
    const returnedRef = dispute[3];

    console.log('computed digest:', digest);
    console.log('storedRef      :', storedRef);
    console.log('returnedRef    :', returnedRef);

    expect(storedRef).to.equal(digest);
    expect(returnedRef).to.equal(digest);

    const dec = await ecies.decryptWithPrivateKey(adminIdentity.privateKey, encrypted);
    expect(dec).to.equal(plaintext);
  });
});
