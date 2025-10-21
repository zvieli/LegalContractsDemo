import { ccipArbitrationIntegration } from '../server/modules/ccipArbitrationIntegration.js';

(async () => {
  try {
    await ccipArbitrationIntegration.initializeProvider();
    const reqId = 'test-' + Date.now();
    console.log('Running CCIP test via direct module call. RequestId:', reqId);
    const res = await ccipArbitrationIntegration.processCCIPArbitration(
      reqId,
      '31337',
      '0x' + '1'.repeat(40),
      {
        disputeType: 'test_dispute',
        evidenceDescription: 'Test evidence for direct module invocation',
        requestedAmount: '0.1',
        additionalContext: JSON.stringify({ test: true })
      }
    );
    console.log('Done, result (may be undefined):', res);
  } catch (e) {
    console.error('Error running CCIP test script:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
