// scripts/printReceipt.js
const hre = require('hardhat');
async function main() {
  const txHash = process.argv[2];
  if (!txHash) throw new Error('Provide tx hash as first arg');
  const tx = await hre.ethers.provider.getTransaction(txHash);
  const r  = await hre.ethers.provider.getTransactionReceipt(txHash);
  console.log('TX:', JSON.stringify(tx || null, null, 2));
  console.log('RECEIPT:', JSON.stringify(r || null, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });