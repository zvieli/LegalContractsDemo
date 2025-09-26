import pkg from 'hardhat';
import fs from 'fs';
const { ethers } = pkg;

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const tenant = signers[1];
  console.log('deployer', deployer.address);
  const ContractFactory = await ethers.getContractFactory('ContractFactory');
  const factory = await ContractFactory.deploy();
  await factory.waitForDeployment();
  console.log('factory deployed at', await factory.getAddress());

  // Deploy a MockPriceFeed for local testing
  const MockPriceFeed = await ethers.getContractFactory('MockPriceFeed');
  const mockPrice = await MockPriceFeed.deploy(2000);
  await mockPrice.waitForDeployment();
  const mockPriceAddr = await mockPrice.getAddress();
  console.log('mock price feed at', mockPriceAddr);

  // get a sample initial digest
  const payload = JSON.stringify({ foo: 'bar', t: Date.now() });
  const digest = ethers.keccak256(ethers.toUtf8Bytes(payload));
  console.log('initial digest', digest);

  // call the new overload: createRentContract(address,uint256,address,uint256,uint256,bytes32)
  const tx = await factory['createRentContract(address,uint256,address,uint256,uint256,bytes32)'](
  tenant.address,
  ethers.parseEther('0.001'),
  mockPriceAddr,
    0,
    0,
    digest
  );
  const receipt = await tx.wait();
  console.log('tx mined, logs:', receipt.logs.length);
  // parse event for RentContractCreated
  const iface = factory.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'RentContractCreated') {
        console.log('Rent contract created:', parsed.args[0]);
      }
    } catch (e) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
