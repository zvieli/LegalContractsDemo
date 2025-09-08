import 'dotenv/config';
import pkg from 'hardhat';

const { ethers, network } = pkg;

async function main(){
  const router = process.env.ORACLE_FUNCTIONS_ROUTER;
  if(!router){
    console.error('Missing ORACLE_FUNCTIONS_ROUTER in .env');
    process.exit(1);
  }
  if(!ethers.isAddress(router)){
    console.error('Value is not a valid address:', router);
    process.exit(1);
  }
  const code = await ethers.provider.getCode(router);
  if(!code || code === '0x'){
    console.error(`NO CODE at ${router} on ${network.name}`);
    process.exit(2);
  }
  console.log(`Router OK on ${network.name}: ${router} (bytecode length ${code.length-2} hex chars)`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
