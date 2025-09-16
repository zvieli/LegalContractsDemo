const { ethers } = require('ethers');

async function main() {
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const rentAddr = process.argv[3] || '0xb877880caf59ad50d8800f382fe47b45a8861330';
  const provider = new ethers.JsonRpcProvider(rpc);
  console.log('Using RPC:', rpc);
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - 200);
  console.log('Scanning blocks', from, '->', latest);
  const iface = new ethers.Interface(["event RentPaid(address indexed tenant, uint256 amount, bool late, address token)", "event PaymentCredited(address indexed to, uint256 amount)"]);
  const topicRentPaid = ethers.keccak256(ethers.toUtf8Bytes('RentPaid(address,uint256,bool,address)'));
  const topicPaymentCredited = ethers.keccak256(ethers.toUtf8Bytes('PaymentCredited(address,uint256)'));
  const filter = { address: rentAddr, fromBlock: from, toBlock: latest, topics: [[topicRentPaid, topicPaymentCredited]] };
  try {
    const logs = await provider.getLogs(filter);
    console.log('Found logs:', logs.length);
    for (const l of logs) {
      try {
        const parsed = iface.parseLog(l);
        console.log('Event:', parsed.name, parsed.args);
      } catch (e) {
        console.log('Unparsed log', l.topics[0]);
      }
    }
  } catch (e) {
    console.error('Error fetching logs:', e && e.message, e && e.data);
  }
}

main().catch(e=>{console.error(e);process.exit(1)});
