import { expect } from 'chai';
import pkg from 'hardhat';
const { ethers } = pkg;

describe('EIP712 on-chain verification (TemplateRentContract)', function () {
  // Helper: robustly sign EIP-712 typed data from a signer (tries signTypedData, then _signTypedData)
  async function signTyped(signer, domain, types, message) {
    if (typeof signer.signTypedData === 'function') return await signer.signTypedData(domain, types, message);
    if (typeof signer._signTypedData === 'function') return await signer._signTypedData(domain, types, message);
    throw new Error('Signer does not support typed-data signing');
  }
  it('accepts a valid EIP712 evidence signature from uploader', async function () {
    const [deployer, landlord, tenant, uploader] = await ethers.getSigners();

    // Deploy minimal TemplateRentContract
    const Template = await ethers.getContractFactory('TemplateRentContract');
    const priceFeedMock = deployer.address; // use address placeholder (contract reads price only in some flows)
    const startDate = Math.floor(Date.now() / 1000) + 60; // lease starts shortly
    const durationDays = 30;
    const rent = await Template.deploy(
      landlord.address,
      tenant.address,
      100, // rentAmount
      Math.floor(Date.now() / 1000) + 3600, // dueDate
      startDate,
      durationDays,
      priceFeedMock,
      0, // propertyId
      '0x0000000000000000000000000000000000000000', // arbitration_service
      0, // requiredDeposit
      '' // initialEvidenceUri
    );
    await rent.waitForDeployment?.() || rent.deployed && (await rent.deployed());

    // Build domain and message according to contract constants
    const chainId = (await uploader.provider.getNetwork()).chainId;
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: chainId,
      verifyingContract: rent.target ?? rent.address,
    };

    const types = {
      Evidence: [
        { name: 'caseId', type: 'uint256' },
        { name: 'contentDigest', type: 'bytes32' },
        { name: 'recipientsHash', type: 'bytes32' },
        { name: 'uploader', type: 'address' },
        { name: 'cid', type: 'string' },
      ],
    };

    const caseId = 1;
    const cid = 'bafybeiexamplecid';
    const contentDigest = ethers.keccak256(ethers.toUtf8Bytes('payload'));
    const recipientsHash = ethers.keccak256(ethers.toUtf8Bytes('[]'));

    const message = {
      caseId: caseId,
      contentDigest: contentDigest,
      recipientsHash: recipientsHash,
      uploader: uploader.address,
      cid: cid,
    };

    // Sign with uploader
    let signature;
    if (typeof uploader.signTypedData === 'function') {
      signature = await uploader.signTypedData(domain, types, message);
    } else if (typeof uploader._signTypedData === 'function') {
      signature = await uploader._signTypedData(domain, types, message);
    } else {
      signature = await uploader._signTypedData(domain, types, message);
    }

    // Call submitEvidenceWithSignature as uploader
    await expect(
      rent.connect(uploader).submitEvidenceWithSignature(caseId, cid, contentDigest, recipientsHash, signature)
    ).to.not.be.reverted;
  });

  it('rejects an invalid signature for evidence', async function () {
    const [deployer, landlord, tenant, uploader, attacker] = await ethers.getSigners();
    const Template = await ethers.getContractFactory('TemplateRentContract');
    const priceFeedMock = deployer.address;
  const startDate = Math.floor(Date.now() / 1000) + 60;
  const durationDays = 30;
  const rent = await Template.deploy(landlord.address, tenant.address, 100, Math.floor(Date.now() / 1000) + 3600, startDate, durationDays, priceFeedMock, 0, '0x0000000000000000000000000000000000000000', 0, '');
    await rent.waitForDeployment?.() || rent.deployed && (await rent.deployed());

    const chainId = (await uploader.provider.getNetwork()).chainId;
    const domain = { name: 'TemplateRentContract', version: '1', chainId, verifyingContract: rent.target ?? rent.address };
    const types = { Evidence: [ { name: 'caseId', type: 'uint256' }, { name: 'contentDigest', type: 'bytes32' }, { name: 'recipientsHash', type: 'bytes32' }, { name: 'uploader', type: 'address' }, { name: 'cid', type: 'string' } ] };
    const caseId = 2;
    const cid = 'bafybad';
    const contentDigest = ethers.keccak256(ethers.toUtf8Bytes('payload2'));
    const recipientsHash = ethers.keccak256(ethers.toUtf8Bytes('[]'));
    const message = { caseId, contentDigest, recipientsHash, uploader: uploader.address, cid };

    // attacker signs (not the uploader)
  const badSig = await signTyped(attacker, domain, types, message);

    await expect(rent.connect(uploader).submitEvidenceWithSignature(caseId, cid, contentDigest, recipientsHash, badSig)).to.be.revertedWith('Invalid signature');
  });

  it('rejects signatures created with wrong EIP712 domain', async function () {
    const [deployer, landlord, tenant, uploader] = await ethers.getSigners();
    const Template = await ethers.getContractFactory('TemplateRentContract');
    const priceFeedMock = deployer.address;
  const startDate = Math.floor(Date.now() / 1000) + 60;
  const durationDays = 30;
  const rent = await Template.deploy(landlord.address, tenant.address, 100, Math.floor(Date.now() / 1000) + 3600, startDate, durationDays, priceFeedMock, 0, '0x0000000000000000000000000000000000000000', 0, '');
    await rent.waitForDeployment?.() || rent.deployed && (await rent.deployed());

    const chainId = (await uploader.provider.getNetwork()).chainId;
    // WRONG domain name intentionally
    const wrongDomain = { name: 'WrongContractName', version: '1', chainId, verifyingContract: rent.target ?? rent.address };
    const types = { Evidence: [ { name: 'caseId', type: 'uint256' }, { name: 'contentDigest', type: 'bytes32' }, { name: 'recipientsHash', type: 'bytes32' }, { name: 'uploader', type: 'address' }, { name: 'cid', type: 'string' } ] };
    const caseId = 3;
    const cid = 'bafybad2';
    const contentDigest = ethers.keccak256(ethers.toUtf8Bytes('payload3'));
    const recipientsHash = ethers.keccak256(ethers.toUtf8Bytes('[]'));
    const message = { caseId, contentDigest, recipientsHash, uploader: uploader.address, cid };

  const sig = await signTyped(uploader, wrongDomain, types, message);

    await expect(rent.connect(uploader).submitEvidenceWithSignature(caseId, cid, contentDigest, recipientsHash, sig)).to.be.revertedWith('Invalid signature');
  });

  it('verifies signRent correctly: accepts correct signer and rejects mismatched recovered', async function () {
    const [deployer, landlord, tenant, someoneElse] = await ethers.getSigners();
    const Template = await ethers.getContractFactory('TemplateRentContract');
    const priceFeedMock = deployer.address;
  const startDate = Math.floor(Date.now() / 1000) + 60;
  const durationDays = 30;
  const rent = await Template.deploy(landlord.address, tenant.address, 100, Math.floor(Date.now() / 1000) + 3600, startDate, durationDays, priceFeedMock, 0, '0x0000000000000000000000000000000000000000', 0, '');
    await rent.waitForDeployment?.() || rent.deployed && (await rent.deployed());

    const chainId = (await landlord.provider.getNetwork()).chainId;
    const domain = { name: 'TemplateRentContract', version: '1', chainId, verifyingContract: rent.target ?? rent.address };
    const types = { RENT: [ { name: 'contractAddress', type: 'address' }, { name: 'landlord', type: 'address' }, { name: 'tenant', type: 'address' }, { name: 'rentAmount', type: 'uint256' }, { name: 'dueDate', type: 'uint256' } ] };
    const rentAmount = 100;
    const dueDate = Math.floor(Date.now() / 1000) + 3600;
    const value = { contractAddress: rent.target ?? rent.address, landlord: landlord.address, tenant: tenant.address, rentAmount, dueDate };

  // landlord signs (but does NOT submit yet)
  const sigL = await signTyped(landlord, domain, types, value);

  // tenant (a party) attempts to submit landlord's signature -> recovered != msg.sender -> SignatureMismatch
  await expect(rent.connect(tenant).signRent(sigL)).to.be.revertedWithCustomError(rent, 'SignatureMismatch');

  // now landlord may submit their signature successfully
  await expect(rent.connect(landlord).signRent(sigL)).to.emit(rent, 'RentSigned');
  });
});
