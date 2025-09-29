const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');

async function main() {
  const txHash = process.argv[2];
  if (!txHash) throw new Error('Provide tx hash');
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('Receipt not found');

  const idx = parseInt(process.argv[3] || '1', 10); // default to log index 1
  const log = receipt.logs[idx];
  if (!log) throw new Error('Log index not found');

  const iface = new ethers.Interface([
    'event DisputeReportedWithUri(uint256 indexed caseId, string evidenceUri)'
  ]);

  const parsed = iface.decodeEventLog('DisputeReportedWithUri', log.data, log.topics);
  console.log('Parsed event args:', parsed);
  const evidence = parsed.evidenceUri;
  console.log('evidenceUri (raw):', evidence);

  // If it looks like hex-within-string (starts with 0x and hex chars), show it
  if (typeof evidence === 'string' && /^0x[0-9a-fA-F]+$/.test(evidence)) {
    try {
      const ascii = Buffer.from(evidence.slice(2), 'hex').toString('utf8');
      console.log('evidenceUri as ascii:', ascii);
    } catch (e) {
      // ignore
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
