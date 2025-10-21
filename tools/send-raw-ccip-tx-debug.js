import { ccipArbitrationIntegration } from '../server/modules/ccipArbitrationIntegration.js';
import util from 'util';

(async () => {
  try {
    await ccipArbitrationIntegration.initializeProvider();
    const senderAddr = ccipArbitrationIntegration.config.ccipSenderAddress;
    const signer = ccipArbitrationIntegration.signer;
    const contract = ccipArbitrationIntegration.contracts.ccipSender;
    if (!contract || !signer) {
      console.error('Missing contract or signer');
      process.exit(2);
    }
    const iface = contract.interface;
    const requestId = 'test-debug-' + Date.now();
    const disputeId = await ccipArbitrationIntegration.provider ?
      (await import('ethers')).keccak256((await import('ethers')).toUtf8Bytes(String(requestId))) : '0x' + '0'.repeat(64);
    const approved = true;
    const appliedAmount = 0n;
    const beneficiary = '0x' + '1'.repeat(40);
    const rationale = 'DEBUG RATIONALE';
    const oracleId = '0x' + '0'.repeat(64);
    const payFeesIn = 0;
    const ifaceSig = 'sendArbitrationDecision(bytes32,bool,uint256,address,string,bytes32,uint8)';
    const calldata = iface.encodeFunctionData(ifaceSig, [disputeId, approved, appliedAmount, beneficiary, rationale, oracleId, payFeesIn]);
    console.log('Encoded calldata prefix:', calldata.slice(0, 300));
    const txReq = { to: senderAddr, data: calldata, value: 0, gasLimit: 500000 };
    try {
      const sent = await signer.sendTransaction(txReq);
      console.log('tx sent:', sent.hash);
      await sent.wait();
      console.log('tx confirmed');
    } catch (err) {
      console.error('Full error object:');
      console.error(util.inspect(err, { depth: 6, colors: false }));
    }
  } catch (e) {
    console.error('Script failed:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
