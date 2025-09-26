// List all DisputeResolved events in the connected JSON-RPC chain
// Run with: npx hardhat run scripts/listAllDisputeResolved.cjs --network localhost
const hre = require('hardhat');

async function main() {
  const ethers = hre.ethers;
  const provider = ethers.provider;
  const topic = ethers.id('DisputeResolved(uint256,bool,uint256,address)');
  console.log('Searching for topic:', topic);
  const latest = await provider.getBlockNumber();
  console.log('Latest block:', latest);
  const logs = await provider.getLogs({ fromBlock: 0, toBlock: latest, topics: [topic] });
  console.log('Found logs:', logs.length);
  const iface = new ethers.Interface([
    'event DisputeResolved(uint256 indexed caseId, bool approved, uint256 appliedAmount, address beneficiary)'
  ]);
  for (const l of logs) {
    console.log('---');
    console.log('block', l.blockNumber, 'tx', l.transactionHash, 'address', l.address);
    try {
      const parsed = iface.parseLog(l);
      console.log('caseId:', parsed.args.caseId ? parsed.args.caseId.toString() : (parsed.args[0] ? String(parsed.args[0]) : undefined));
      console.log('approved:', parsed.args.approved);
      console.log('appliedAmount:', parsed.args.appliedAmount ? parsed.args.appliedAmount.toString() : (parsed.args[2] ? String(parsed.args[2]) : undefined));
      console.log('beneficiary:', parsed.args.beneficiary);
    } catch (e) {
      console.log('parse failed:', e && e.message ? e.message : e);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
