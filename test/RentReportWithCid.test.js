import pkg from 'hardhat';
const { ethers } = pkg;
import { expect } from 'chai';

describe('TemplateRentContract - reportDisputeWithCid (esm shim)', function () {
  it('noop shim - main test exists as .cjs', async function () {
    // The real tests are in the .cjs variant. This file is kept as ESM-compatible shim.
    expect(true).to.equal(true);
  });
});
