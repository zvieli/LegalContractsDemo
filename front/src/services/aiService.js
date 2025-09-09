// Simple AI decision client for the NDA arbitration demo.
// Reads env vars: AI_ENDPOINT_URL, AI_API_KEY, GEMINI_API_KEY, AI_TIMEOUT.

const ENDPOINT = process.env.AI_ENDPOINT_URL;
const API_KEY = process.env.AI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Increase default timeout to 60s to allow slower AI responses (large models / cold starts)
const TIMEOUT = Number(process.env.AI_TIMEOUT || 60000);

function abortableFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}


export async function requestAIDecision(caseData) {
  if (!ENDPOINT) throw new Error('AI endpoint not configured (AI_ENDPOINT_URL)');

  // Forward the full case object so server can use domain/disputeType/etc
  const body = {
    ...caseData,
    requestedPenaltyWei: caseData?.requestedPenaltyWei?.toString?.() || caseData?.requestedAmountWei?.toString?.() || String(caseData?.requestedPenaltyWei || caseData?.requestedAmountWei || '0'),
    ts: Date.now(),
    geminiApiKey: GEMINI_API_KEY // Pass Gemini API key if needed
  };

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const resp = await abortableFetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, TIMEOUT);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI endpoint HTTP ${resp.status}: ${text}`);
  }
  let data;
  try { data = await resp.json(); } catch { throw new Error('Failed to parse AI JSON'); }

  // Return full server response (tests expect caseId, status, awardedWei, etc.)
  const caseId = data.caseId || body.caseId || '';
  const approve = typeof data.approve === 'boolean' ? data.approve : !!data.approve;
  const penaltyWei = data.penaltyWei || (typeof data.penaltyWei === 'number' ? String(data.penaltyWei) : '0');
  const awardedWei = (typeof data.awardedWei === 'number') ? data.awardedWei : (parseInt(data.awardedWei || penaltyWei || '0', 10) || 0);
  const status = data.status || (approve === true ? 'resolved' : (approve === false ? 'rejected' : 'pending'));
  const decision = data.decision || data.classification || '';
  const rationale = data.rationale || '';
  const resolvedAt = data.resolvedAt || Date.now();

  return {
    ...data,
    caseId,
    status,
    approve: !!approve,
    penaltyWei: penaltyWei || '0',
    awardedWei,
    decision,
    rationale,
    resolvedAt,
    beneficiary: data.beneficiary || body.reporter,
    guilty: data.guilty || body.offender,
    _raw: data
  };
}


