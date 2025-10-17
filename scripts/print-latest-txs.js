// scripts/print-latest-txs.js
// מדפיס את כל הטרנזקציות ב-10 בלוקים האחרונים

import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const provider = ethers.provider;
  const latestBlock = await provider.getBlock("latest");
  console.log(`Latest block: ${latestBlock.number}`);
  for (let i = latestBlock.number; i > latestBlock.number - 5; i--) {
    const block = await provider.getBlock(i);
    if (block && block.transactions.length > 0) {
      console.log(`\nBlock ${i} - ${block.transactions.length} txs:`);
      for (const txHash of block.transactions) {
        const tx = await provider.getTransaction(txHash);
        console.log({
          blockNumber: tx.blockNumber,
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          gasUsed: tx.gasLimit.toString(),
          nonce: tx.nonce,
          data: tx.data
        });
      }
    }
  }
}

main().catch(console.error);