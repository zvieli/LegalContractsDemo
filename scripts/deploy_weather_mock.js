import 'dotenv/config';
import pkg from 'hardhat';

const { ethers, network } = pkg;

async function main(){
  const [deployer] = await ethers.getSigners();
  console.log('Network:', network.name, 'Deployer:', deployer.address);
  const Factory = await ethers.getContractFactory('WeatherConsumerMock');
  const mock = await Factory.deploy();
  await mock.waitForDeployment();
  const addr = await mock.getAddress();
  console.log('WeatherConsumerMock deployed:', addr);
  console.log('\nNext: run weather:simulate to simulate API fetch locally and fulfill.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
