// Minimal arbitration API client used by frontend arbitration UI
export async function getDisputeHistory(caseId) {
  if (!caseId) throw new Error('caseId required');
  const res = await fetch(`/api/dispute-history/${encodeURIComponent(caseId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load dispute history: ${res.status} ${text}`);
  }
  return res.json();
}

export async function requestArbitration(caseId, options = {}) {
  if (!caseId) throw new Error('caseId required');
  const body = { caseId, ...options };
  // prefer the v7 Ollama endpoint if available
  const res = await fetch('/api/v7/arbitration/ollama', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Arbitration request failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function triggerArbitrateBatch(payload) {
  // fallback endpoint for batch arbitration flow
  const res = await fetch('/api/arbitrate-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Arbitrate batch failed: ${res.status} ${text}`);
  }
  return res.json();
}
