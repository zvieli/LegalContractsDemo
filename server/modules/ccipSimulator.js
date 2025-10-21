import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';

// Load ABI for MockCCIPRouter from server/config if available
function loadMockRouterAbi() {
  try {
    const abiPath = path.join(process.cwd(), 'server', 'config', 'contracts', 'MockCCIPRouter.json');
    const raw = fs.readFileSync(abiPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.abi || parsed;
  } catch (e) {
    console.warn('Could not load MockCCIPRouter ABI from server/config; falling back to bundled ABI');
    return null;
  }
}

export async function simulateDecisionTo(routerAddress, params) {
  if (!routerAddress) throw new Error('Router address required');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const abi = loadMockRouterAbi();
  if (!abi) throw new Error('MockCCIPRouter ABI not found in server/config/contracts');
  const router = new ethers.Contract(routerAddress, abi, provider.getSigner ? provider.getSigner() : provider);

  // params: { receiver, messageId, sourceChainSelector, requestSender, disputeId, approved, appliedAmount, beneficiary, rationale, oracleId, targetContract, caseId }
  const tx = await router.simulateDecisionTo(
    params.receiver,
    params.messageId,
    params.sourceChainSelector || 0,
    params.requestSender || ethers.ZeroAddress,
    params.disputeId,
    params.approved,
    params.appliedAmount || 0,
    params.beneficiary || ethers.ZeroAddress,
    params.rationale || '',
    params.oracleId || ethers.ZeroHash,
    params.targetContract || ethers.ZeroAddress,
    params.caseId || 0
  );

  const receipt = await tx.wait();
  return receipt;
}
