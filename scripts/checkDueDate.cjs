const hre = require('hardhat');
async function main() {
  const [deployer, tenant] = await hre.ethers.getSigners();
  console.log('Using deployer', deployer.address);
  const Factory = await hre.ethers.getContractFactory('ContractFactory');
  const factory = await Factory.deploy();
  await factory.waitForDeployment?.();
  console.log('Factory deployed at', factory.target || factory.address);

  // Deploy a MockPriceFeed
  const MockPrice = await hre.ethers.getContractFactory('MockPriceFeed');
  const mock = await MockPrice.deploy(2000);
  await mock.waitForDeployment?.();
  console.log('MockPriceFeed at', mock.target || mock.address);

  const now = Math.floor(Date.now() / 1000);
  const durationDays = 30;
  const dueDate = now + durationDays * 24 * 3600;

  console.log('Creating rent contract with dueDate:', dueDate);
  const tx = await factory['createRentContract(address,uint256,address,uint256,uint256)'](tenant.address, hre.ethers.parseEther('0.5'), mock.target || mock.address, dueDate, 0);
  const rcpt = await tx.wait();
  const evt = rcpt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null } }).find(e => e && e.name === 'RentContractCreated');
  const addr = evt.args.contractAddress;
  console.log('Rent contract created at', addr);
  const Rent = await hre.ethers.getContractAt('TemplateRentContract', addr);
  const dd = await Rent.dueDate();
  console.log('Contract dueDate:', dd.toString());
}
main().catch(e=>{ console.error(e); process.exit(1); });
