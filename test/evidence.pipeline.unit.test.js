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
  const tx = await rent.connect(tenant).submitEvidence(0, cid);
  const rc = await tx.wait();
  let found=false; let parsedArgs=null; for(const log of rc.logs){ try{ const p=rent.interface.parseLog(log); if(p.name==='EvidenceSubmitted'){ found=true; parsedArgs=p.args; break; } }catch(_){} }
  expect(found).to.equal(true);
  const expectedDigest = keccak256(toUtf8Bytes(cid));
  expect(parsedArgs.cidDigest).to.equal(expectedDigest);
  expect(Number(parsedArgs.caseId)).to.equal(0);
  expect(parsedArgs.submitter.toLowerCase()).to.equal(tenant.address.toLowerCase());
    await expect(rent.connect(tenant).submitEvidence(0, cid)).to.be.revertedWith('Evidence duplicate');
  });
});
