import { ccipArbitrationIntegration } from '../server/modules/ccipArbitrationIntegration.js';

(async () => {
  try {
    await ccipArbitrationIntegration.initializeProvider();
    const addr = ccipArbitrationIntegration.config.ccipSenderAddress;
    if (!addr) {
      console.error('No CCIP sender address configured');
      process.exit(2);
    }
    console.log('Sender address:', addr);
    const provider = ccipArbitrationIntegration.provider;
    const code = await provider.getCode(addr);
    console.log('Bytecode length (bytes):', code ? (code.length - 2) / 2 : 0);
    console.log('Bytecode prefix:', code.slice(0, 200));

    const iface = ccipArbitrationIntegration.contracts.ccipSender ? ccipArbitrationIntegration.contracts.ccipSender.interface : null;
    if (!iface) {
      console.warn('Contract interface not available from instance, constructing from artifact if possible');
    }

    // Try to compute selector for the expected 7-arg signature
    let selector = null;
    try {
      if (iface) selector = iface.getSighash('sendArbitrationDecision(bytes32,bool,uint256,address,string,bytes32,uint8)');
    } catch (e) {
      // ignore
    }
    // fallback compute using keccak
    if (!selector) {
      const { keccak256, toUtf8Bytes } = await import('ethers').then(m => ({ keccak256: m.keccak256 || m.utils?.keccak256, toUtf8Bytes: m.toUtf8Bytes || m.utils?.toUtf8Bytes }));
      const sig = 'sendArbitrationDecision(bytes32,bool,uint256,address,string,bytes32,uint8)';
      selector = keccak256(toUtf8Bytes(sig)).slice(0, 10);
    }

    console.log('Computed selector:', selector);
    const found = code && code.toLowerCase().includes(selector.replace('0x', '').toLowerCase());
    console.log('Selector present in bytecode?', found);

    // Also print whether the contract has been verified as a proxy-like (small code length)
    if (code && code.length <= 2 + 8) {
      console.warn('Bytecode appears very small - likely an empty account or minimal proxy');
    }

    process.exit(found ? 0 : 0);
  } catch (err) {
    console.error('Error checking bytecode:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
