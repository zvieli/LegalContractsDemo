import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;
import { keccak256, toUtf8Bytes } from 'ethers';
import fs from 'fs';
import path from 'path';

// Frontend utilities (import via dynamic path resolution since compiled TS not used)
import { canonicalize, computeContentDigest, computeCidDigest } from './frontShim/evidenceCanonicalShim.js';

describe('Evidence pipeline unit', function(){
  it('canonicalize + contentDigest stable ordering', () => {
    const a = { b:2, a:1, z:{ y:3, x:[2,1] } };
    const b = { z:{ x:[2,1], y:3 }, a:1, b:2 };
    const ca = canonicalize(a); const cb = canonicalize(b);
    expect(ca).to.equal(cb);
    const da = computeContentDigest(a); const db = computeContentDigest(b);
    expect(da).to.equal(db);
  });

  it('computeCidDigest deterministic', () => {
    const cid = 'bafybeigdyrzt5a';
    const d1 = computeCidDigest(cid); const d2 = computeCidDigest(cid);
    expect(d1).to.equal(d2);
  });

  it('submitEvidence emits event & duplicate prevented', async () => {
    const [landlord, tenant] = await ethers.getSigners();
    const Price = await ethers.getContractFactory('MockPriceFeed');
    const pf = await Price.deploy(2000);
    await pf.waitForDeployment();
    const Rent = await ethers.getContractFactory('TemplateRentContract');
    const rent = await Rent.deploy(
      landlord.address,
      tenant.address,
      100,
      0,
      await pf.getAddress(),
      0,
      landlord.address,
      0,
      ''
    );
    await rent.waitForDeployment();
    
    const cid = 'bafybeigdyrzt5asamplecid';
    const contentDigest = keccak256(toUtf8Bytes('sample-content'));
    const recipientsHash = ethers.ZeroHash;
    
    // Create EIP-712 signature
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: rent.target
    };
    
    const types = {
      Evidence: [
        { name: 'caseId', type: 'uint256' },
        { name: 'contentDigest', type: 'bytes32' },
        { name: 'recipientsHash', type: 'bytes32' },
        { name: 'uploader', type: 'address' },
        { name: 'cid', type: 'string' }
      ]
    };
    
    const message = {
      caseId: 0,
      contentDigest: contentDigest,
      recipientsHash: recipientsHash,
      uploader: tenant.address,
      cid: cid
    };
    
    const signature = await tenant.signTypedData(domain, types, message);
    
    const tx = await rent.connect(tenant).submitEvidenceWithSignature(0, cid, contentDigest, recipientsHash, signature);
    const rc = await tx.wait();
    
    let found=false; let parsedArgs=null; 
    for(const log of rc.logs){ 
      try{ 
        const p=rent.interface.parseLog(log); 
        if(p.name==='EvidenceSubmittedDigest'){ 
          found=true; 
          parsedArgs=p.args; 
          break; 
        } 
      }catch(_){} 
    }
    
    expect(found).to.equal(true);
    const expectedDigest = keccak256(toUtf8Bytes(cid));
    expect(parsedArgs.cidDigest).to.equal(expectedDigest);
    expect(Number(parsedArgs.caseId)).to.equal(0);
    expect(parsedArgs.submitter.toLowerCase()).to.equal(tenant.address.toLowerCase());
    
    // Test duplicate prevention
    await expect(
      rent.connect(tenant).submitEvidenceWithSignature(0, cid, contentDigest, recipientsHash, signature)
    ).to.be.revertedWith('Evidence duplicate');
  });

  it('submitEvidenceWithDigest stores contentDigest mapping', async () => {
    const [landlord, tenant] = await ethers.getSigners();
    const Price = await ethers.getContractFactory('MockPriceFeed');
    const pf = await Price.deploy(2000);
    await pf.waitForDeployment();
    const Rent = await ethers.getContractFactory('TemplateRentContract');
    const rent = await Rent.deploy(
      landlord.address,
      tenant.address,
      100,
      0,
      await pf.getAddress(),
      0,
      landlord.address,
      0,
      ''
    );
    await rent.waitForDeployment();
    
    const cid = 'bafybeigdyrzt5aEXTdigest';
    const contentDigest = keccak256(toUtf8Bytes('canon-json-placeholder'));
    const recipientsHash = ethers.ZeroHash;
    
    // Create EIP-712 signature
    const domain = {
      name: 'TemplateRentContract',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: rent.target
    };
    
    const types = {
      Evidence: [
        { name: 'caseId', type: 'uint256' },
        { name: 'contentDigest', type: 'bytes32' },
        { name: 'recipientsHash', type: 'bytes32' },
        { name: 'uploader', type: 'address' },
        { name: 'cid', type: 'string' }
      ]
    };
    
    const message = {
      caseId: 1,
      contentDigest: contentDigest,
      recipientsHash: recipientsHash,
      uploader: tenant.address,
      cid: cid
    };
    
    const signature = await tenant.signTypedData(domain, types, message);
    
    const tx = await rent.connect(tenant).submitEvidenceWithSignature(1, cid, contentDigest, recipientsHash, signature);
    const rc = await tx.wait();
    
    let parsedArgs; 
    for(const log of rc.logs){ 
      try { 
        const p = rent.interface.parseLog(log); 
        if(p.name==='EvidenceSubmittedDigest'){ 
          parsedArgs=p.args; 
          break; 
        } 
      } catch(_){} 
    }
    
    expect(parsedArgs.contentDigest).to.equal(contentDigest);
    const stored = await rent.evidenceContentDigest(parsedArgs.cidDigest);
    expect(stored).to.equal(contentDigest);
  });
});
