function isHexAddress(s) {
  return typeof s === 'string' && s.startsWith('0x') && s.length === 42;
}

function baselineDecision(body) {
  const reporter = isHexAddress(body?.reporter) ? body.reporter : '0x0000000000000000000000000000000000000000';
  const offender = isHexAddress(body?.offender) ? body.offender : '0x0000000000000000000000000000000000000000';
  let penalty = 0n;
  try { penalty = BigInt(body?.requestedPenaltyWei ?? 0); } catch {}
  if (penalty > 1n) penalty = penalty / 2n; else penalty = 0n;
  return {
    approve: true,
    penaltyWei: penalty.toString(),
    beneficiary: reporter,
    guilty: offender,
  };
}

function coerceDecision(body, raw) {
  const base = baselineDecision(body);
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  if (typeof raw.approve === 'boolean') out.approve = raw.approve;
  if (typeof raw.penaltyWei === 'string') {
    try { out.penaltyWei = (BigInt(raw.penaltyWei) >= 0n ? raw.penaltyWei : '0'); } catch {}
  } else if (typeof raw.penaltyWei === 'number') {
    out.penaltyWei = Math.max(0, Math.floor(raw.penaltyWei)).toString();
  }
  if (isHexAddress(raw.beneficiary)) out.beneficiary = raw.beneficiary;
  if (isHexAddress(raw.guilty)) out.guilty = raw.guilty;
  // Cap to requested
  try {
    const req = BigInt(body?.requestedPenaltyWei ?? 0);
    let pen = 0n; try { pen = BigInt(out.penaltyWei); } catch {}
    if (pen < 0n) pen = 0n;
    if (pen > req) pen = req;
    out.penaltyWei = pen.toString();
  } catch {}
  return out;
}

async function callWorkersAiREST(env, prompt) {
  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CF_API_TOKEN;
  const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3-8b-instruct';
  if (!accountId || !apiToken) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are an arbitration assistant. Reply with ONLY a compact JSON. No prose.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  // Try extracting text from typical fields
  let text = '';
  if (typeof data === 'string') text = data;
  else if (typeof data?.result === 'string') text = data.result;
  else if (typeof data?.response === 'string') text = data.response;
  else if (typeof data?.output_text === 'string') text = data.output_text;
  else if (typeof data?.result?.response === 'string') text = data.result.response;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
      // Optional API key check
      const auth = request.headers.get('authorization') || '';
      const expected = env.AI_API_KEY ? `Bearer ${env.AI_API_KEY}` : null;
      if (expected && auth !== expected) return new Response('Unauthorized', { status: 401 });

      const body = await request.json();

      // Build a strict prompt for JSON-only output
      const reporter = body?.reporter;
      const offender = body?.offender;
      const requestedPenaltyWei = body?.requestedPenaltyWei;
      const evidenceHash = body?.evidenceHash;
      const evidenceText = body?.evidenceText; // optional

      const prompt = `Given the NDA dispute context, output ONLY valid JSON with keys: approve (boolean), penaltyWei (string integer wei), beneficiary (hex address), guilty (hex address). No explanations, no markdown.
Context:
- reporter: ${reporter}
- offender: ${offender}
- requestedPenaltyWei: ${requestedPenaltyWei}
- evidenceHash: ${evidenceHash}
- evidenceText: ${evidenceText ?? ''}`;

      // Try Cloudflare Workers AI via REST if configured
      let aiDecision = null;
      try {
        aiDecision = await callWorkersAiREST(env, prompt);
      } catch {}

      const decision = coerceDecision(body, aiDecision);

      return new Response(JSON.stringify(decision), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      const decision = baselineDecision({});
      return new Response(JSON.stringify(decision), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }
};
