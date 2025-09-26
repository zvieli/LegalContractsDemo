import hre from 'hardhat';

async function main() {
  const { ethers } = hre;
  console.log('Running debugDeployArb');
  const [owner] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('ArbitrationService');
  console.log('Factory interface deploy inputs length:', Factory.interface && Factory.interface.deploy ? Factory.interface.deploy.inputs.length : '(no)');
  try {
    const tx = await Factory.getDeployTransaction();
    console.log('getDeployTransaction result keys:', Object.keys(tx));
  } catch (e) {
    console.error('getDeployTransaction error:', e && e.stack || e);
  }
  try {
    const inst = await Factory.deploy();
    console.log('deploy succeeded, address:', inst.target || inst.address);
  } catch (e) {
    console.error('deploy error:', e && e.stack || e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
