// Chainlink Functions script: routes NDA case to an external AI and returns an on-chain decision.
// args: [chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash]
// secrets: { AI_ENDPOINT_URL: string, AI_API_KEY: string, ... }

const [chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash] = args;

// Baseline fallback (keeps tests deterministic): approve, 50% of requested, beneficiary=reporter, guilty=offender
function baselineDecision() {
  const half = (BigInt(requestedPenaltyWei) >= 2n) ? BigInt(requestedPenaltyWei) / 2n : 0n;
  return { approve: true, penaltyWei: half, beneficiary: reporter, guilty: offender };
}

function isHexAddress(s) {
  return typeof s === "string" && s.startsWith("0x") && s.length === 42;
}

function coerceDecision(data) {
  const out = baselineDecision();
  if (data == null || typeof data !== "object") return out;
  if (typeof data.approve === "boolean") out.approve = data.approve;
  if (typeof data.penaltyWei === "string") {
    try { out.penaltyWei = BigInt(data.penaltyWei); } catch {}
  } else if (typeof data.penaltyWei === "number") {
    try { out.penaltyWei = BigInt(Math.max(0, Math.floor(data.penaltyWei))); } catch {}
  }
  if (isHexAddress(data.beneficiary)) out.beneficiary = data.beneficiary;
  if (isHexAddress(data.guilty)) out.guilty = data.guilty;
  // Safety: never negative, and cap to requested (final clamp also done on-chain to offender deposit)
  if (out.penaltyWei < 0n) out.penaltyWei = 0n;
  if (out.penaltyWei > BigInt(requestedPenaltyWei)) out.penaltyWei = BigInt(requestedPenaltyWei);
  return out;
}

async function callAiEndpoint() {
  try {
    if (typeof secrets === "undefined") return null;
    const url = secrets.AI_ENDPOINT_URL;
    const key = secrets.AI_API_KEY;
    if (!url || !key) return null;

    const payload = {
      chainId,
      nda,
      caseId,
      reporter,
      offender,
      requestedPenaltyWei,
      evidenceHash,
    };

    const resp = await Functions.makeHttpRequest({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      data: payload,
      timeout: 10_000,
    });

    if (!resp || !resp.data) return null;

    // Expecting shape: { approve: boolean, penaltyWei: string|number, beneficiary?: address, guilty?: address }
    return coerceDecision(resp.data);
  } catch (err) {
    // Swallow to preserve baseline
    return null;
  }
}

let decision = baselineDecision();
const ai = await callAiEndpoint();
if (ai) decision = ai;

return Functions.encodeAbi([
  { type: "bool", name: "approve" },
  { type: "uint256", name: "penaltyWei" },
  { type: "address", name: "beneficiary" },
  { type: "address", name: "guilty" },
], [decision.approve, decision.penaltyWei.toString(), decision.beneficiary, decision.guilty]);
