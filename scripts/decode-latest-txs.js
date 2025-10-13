// scripts/decode-latest-txs.js
// מפענח את כל הטרנזקציות ב-10 בלוקים האחרונים לפי ABI של החוזים

import hardhat from "hardhat";
import fs from "fs";
const { ethers } = hardhat;

// טען ABI של החוזים המרכזיים
const contractAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ContractFactory.sol/ContractFactory.json", "utf8")).abi;
const rentAbi = JSON.parse(fs.readFileSync("artifacts/contracts/EnhancedRentContract.sol/EnhancedRentContract.json", "utf8")).abi;
const ndaAbi = JSON.parse(fs.readFileSync("artifacts/contracts/NDA/NDATemplate.sol/NDATemplate.json", "utf8")).abi;

const abis = [contractAbi, rentAbi, ndaAbi];

function decodeTxData(data) {
  for (const abi of abis) {
    try {
      const iface = new ethers.Interface(abi);
      return iface.parseTransaction({ data });
    } catch {}
  }
  return null;
}

async function main() {
  const provider = ethers.provider;
  const latestBlock = await provider.getBlock("latest");
  for (let i = latestBlock.number; i > latestBlock.number - 30; i--) {
    const block = await provider.getBlock(i);
    if (block && block.transactions.length > 0) {
      console.log(`\nBlock ${i} - ${block.transactions.length} txs:`);
      for (const txHash of block.transactions) {
        const tx = await provider.getTransaction(txHash);
        const decoded = decodeTxData(tx.data);
        console.log({
          blockNumber: tx.blockNumber,
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          gasUsed: tx.gasLimit.toString(),
          nonce: tx.nonce,
          method: decoded ? decoded.name : null,
          args: decoded ? decoded.args : null
        });
      }
    }
  }
}

main().catch(console.error);