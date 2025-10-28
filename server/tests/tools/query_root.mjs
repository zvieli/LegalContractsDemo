import fs from 'fs';
import path from 'path';
import { JsonRpcProvider, Contract } from 'ethers';

(async () => {
  try {
    const base = path.join(path.resolve('.'));
    const configPath = path.join(base, 'config', 'merkleManager.json');
    const abiPath = path.join(base, 'config', 'MerkleEvidenceManager.json');
    const dataPath = path.join(base, 'data', 'evidence_batches.json');

    if (!fs.existsSync(configPath)) {
      console.error('Missing merkleManager.json');
      process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(configPath));
    const abi = JSON.parse(fs.readFileSync(abiPath));

    if (!fs.existsSync(dataPath)) {
      console.error('No evidence_batches.json found at', dataPath);
      process.exit(1);
    }

    const batchesObj = JSON.parse(fs.readFileSync(dataPath));
  const provider = new JsonRpcProvider(config.rpcUrl);
  const contract = new Contract(config.address, abi, provider);

  // Check that code exists at the configured address
  const code = await provider.getCode(config.address);
  console.log('Contract code length at', config.address, '=>', code && code.length);

    for (const [caseId, arr] of Object.entries(batchesObj)) {
      for (const b of arr) {
        console.log('--- case', caseId);
        console.log('merkleRoot:', b.merkleRoot);
        console.log('txHash  :', b.txHash || '<none>');

        try {
          const res = await contract.rootToBatchId(b.merkleRoot);
          console.log('rootToBatchId =>', res.toString());
        } catch (e) {
          console.error('rootToBatchId call failed:', e && e.message ? e.message : e);
        }

        if (b.txHash) {
          try {
            const receipt = await provider.getTransactionReceipt(b.txHash);
            const tx = await provider.getTransaction(b.txHash);
            console.log('tx.to:', tx ? tx.to : '<no tx>','tx.from:', tx?tx.from:'', 'dataLen:', tx?tx.data.length:0);
            if (!receipt) {
              console.log('No receipt found for', b.txHash);
            } else {
              console.log('tx receipt status:', receipt.status, 'blockNumber:', receipt.blockNumber, 'logs:', receipt.logs.length);
              for (let i = 0; i < Math.min(receipt.logs.length, 3); i++) {
                console.log(' log', i, 'topics', receipt.logs[i].topics);
              }
            }
          } catch (e) {
            console.error('getTransactionReceipt failed:', e && e.message ? e.message : e);
          }
        }

        console.log('');
      }
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
})();
