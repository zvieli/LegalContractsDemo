const fs = require('fs');
const path = require('path');
const pkg = require('hardhat');

async function main() {
  const { ethers } = pkg;
  const provider = ethers.provider || new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

  const artifactPath = path.join(__dirname, '../front/src/utils/contracts/TemplateRentContractABI.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact ABI not found at', artifactPath);
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const deployedBytecode = artifact.bytecode || artifact.deployedBytecode || null;
  if (!deployedBytecode) {
    console.error('No bytecode found in artifact; ensure ABI copy includes bytecode');
    process.exit(1);
  }

  // Normalize to lowercase and strip 0x
  const target = deployedBytecode.toLowerCase().replace(/^0x/, '');
  console.log('Searching for deployed bytecode match (length', target.length / 2, 'bytes) in recent blocks');

  const latest = await provider.getBlockNumber();
  const span = parseInt(process.argv[2] || '200', 10);
  const start = Math.max(0, latest - span + 1);

  const found = [];
  for (let b = start; b <= latest; ++b) {
    const hex = '0x' + b.toString(16);
    const block = await provider.send('eth_getBlockByNumber', [hex, true]);
    if (!block || !block.transactions) continue;
    for (const tx of block.transactions) {
      if (!tx.to) {
        // contract creation tx
        const receipt = await provider.send('eth_getTransactionReceipt', [tx.hash]);
        const addr = receipt && receipt.contractAddress;
        if (addr) {
          const code = await provider.send('eth_getCode', [addr, 'latest']);
          if (!code || code === '0x') continue;
          const c = code.toLowerCase().replace(/^0x/, '');
          if (c === target || c.startsWith(target) || target.startsWith(c)) {
            found.push({ address: addr, tx: tx.hash, block: b });
          }
        }
      }
    }
  }

  if (found.length === 0) {
    console.log('No matching contract creations found in the last', span, 'blocks.');
  } else {
    console.log('Found matching contracts:');
    for (const f of found) console.log(' -', f.address, 'tx', f.tx, 'block', f.block);
  }
}

main().catch((err) => { console.error(err && err.message || err); process.exit(1); });
