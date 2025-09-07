// Simple AI decision client for the NDA arbitration demo.
// Reads Vite env vars: VITE_AI_ENDPOINT, VITE_AI_API_KEY, VITE_AI_TIMEOUT.

const ENDPOINT = import.meta.env.VITE_AI_ENDPOINT;
const API_KEY = import.meta.env.VITE_AI_API_KEY;
const TIMEOUT = Number(import.meta.env.VITE_AI_TIMEOUT || 10000);

function abortableFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

export async function requestAIDecision({ reporter, offender, requestedPenaltyWei, evidenceHash = '0x', evidenceText = '' }) {
  if (!ENDPOINT) throw new Error('AI endpoint not configured (VITE_AI_ENDPOINT)');

  const body = {
    reporter,
    offender,
    requestedPenaltyWei: requestedPenaltyWei?.toString?.() || String(requestedPenaltyWei || '0'),
    evidenceHash,
    evidenceText,
    ts: Date.now()
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

  // Coerce minimal fields
  return {
    approve: !!data.approve,
    penaltyWei: data.penaltyWei || '0',
    beneficiary: data.beneficiary || reporter,
    guilty: data.guilty || offender,
    _raw: data
  };
}
