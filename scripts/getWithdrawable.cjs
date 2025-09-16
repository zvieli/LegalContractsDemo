const { ethers } = require('ethers');

async function main(){
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const rent = process.argv[3] || '0xb877880caf59ad50d8800f382fe47b45a8861330';
  const acct = process.argv[4] || '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
  const provider = new ethers.JsonRpcProvider(rpc);
  const abi = ["function withdrawable(address) view returns (uint256)"];
  const c = new ethers.Contract(rent, abi, provider);
  const w = await c.withdrawable(acct);
  console.log('withdrawable (wei):', w.toString());
}

main().catch(e=>{console.error(e && e.message); process.exit(1)});