// Chainlink Functions script: routes NDA case to an external AI and returns an on-chain decision.
// args: [chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash]
// secrets: { AI_ENDPOINT_URL: string, AI_API_KEY: string, ... }

const [chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash] = args;

// Baseline fallback (deterministic): severity-based percentage of requested amount.
// Rules:
//  - trivial (<0.01 ETH) => deny (approve=false, penalty=0)
//  - <=0.1 ETH => 60%
//  - <=0.3 ETH => 70%
//  - <=0.5 ETH => 80%
//  - >0.5 ETH => 90%
//  Keyword bumps (+5 each, capped at 95%): source|code|gist|roadmap|customer|earnings
//  Minor keywords (+2 each): investor|pitch
//  Penalty = requested * factor/100 (integer division). Addresses retained as provided.
// Category taxonomy with keyword sets and severity weights
const CATEGORY_RULES = [
  { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
  { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
  { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
  { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
  { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
];

function detectCategory(text) {
  const t = text.toLowerCase();
  let best = { key: 'generic', weight: 0 };
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (t.includes(kw)) {
        if (rule.weight > best.weight) best = { key: rule.key, weight: rule.weight };
        break;
      }
    }
  }
  return best;
}

function baselineDecision() {
  let req;
  try { req = BigInt(requestedPenaltyWei); } catch { req = 0n; }
  if (req < 0n) req = 0n;
  // Quick ETH magnitude approximation (safe for small test values)
  const ethScaled = Number(req) / 1e18; // only safe for < ~9e15 wei (fine here)
  let factor = 0;
  if (ethScaled < 0.01) {
    factor = 0; // trivial => deny
  } else if (ethScaled <= 0.1) {
    factor = 60;
  } else if (ethScaled <= 0.3) {
    factor = 70;
  } else if (ethScaled <= 0.5) {
    factor = 80;
  } else {
    factor = 90;
  }
  const lowerHash = (evidenceHash || '').toLowerCase();
  const cat = detectCategory(lowerHash);
  const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
  const minorKeywords = ['investor','pitch'];
  for (const k of bumpKeywords) { if (lowerHash.includes(k)) factor += 5; }
  for (const k of minorKeywords) { if (lowerHash.includes(k)) factor += 2; }
  factor += cat.weight; // add category severity
  if (factor > 95) factor = 95;
  let penalty = 0n;
  if (factor > 0) {
    penalty = (req * BigInt(factor)) / 100n;
    if (penalty > req) penalty = req;
  }
  const approve = factor >= 60 && penalty > 0n && reporter !== offender;
  // Basic classification heuristic
  let severityBand = 'low';
  if (factor >= 80) severityBand = 'high'; else if (factor >= 60) severityBand = 'medium';
  const classification = cat.key; // store category key as classification
  const rationale = `cat=${cat.key};catWeight=${cat.weight};band=${severityBand};factor=${factor};requestedWei=${requestedPenaltyWei}`;
  return { approve, penaltyWei: penalty, beneficiary: reporter, guilty: offender, classification, rationale };
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
  if (typeof data.classification === 'string') out.classification = data.classification.slice(0,64);
  if (typeof data.rationale === 'string') out.rationale = data.rationale.slice(0,256);
  return out;
}

async function callAiEndpoint() {
  try {
    if (typeof secrets === "undefined") return null;
    const url = secrets.AI_ENDPOINT_URL;
    const key = secrets.AI_API_KEY;
  // Allow calling without API key: only require URL. If key missing, omit Authorization header.
  if (!url) return null;

    const payload = {
      chainId,
      nda,
      caseId,
      reporter,
      offender,
      requestedPenaltyWei,
      evidenceHash,
    };

    const headers = { "Content-Type": "application/json" };
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const resp = await Functions.makeHttpRequest({
      url,
      method: "POST",
      headers,
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
  { type: "string", name: "classification" },
  { type: "string", name: "rationale" },
], [decision.approve, decision.penaltyWei.toString(), decision.beneficiary, decision.guilty, decision.classification, decision.rationale]);
