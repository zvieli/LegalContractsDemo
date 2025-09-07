function isHexAddress(s) {
  return typeof s === 'string' && s.startsWith('0x') && s.length === 42;
}

function baselineDecision(body) {
  const reporter = isHexAddress(body?.reporter) ? body.reporter : '0x0000000000000000000000000000000000000000';
  const offender = isHexAddress(body?.offender) ? body.offender : '0x0000000000000000000000000000000000000000';
  let req = 0n; try { req = BigInt(body?.requestedPenaltyWei ?? 0); } catch {}
  if (req < 0n) req = 0n;
  const ethScaled = Number(req) / 1e18; // approximate for small test values
  let factor = 0;
  if (ethScaled < 0.01) factor = 0;        // deny trivial
  else if (ethScaled <= 0.1) factor = 60;
  else if (ethScaled <= 0.3) factor = 70;
  else if (ethScaled <= 0.5) factor = 80;
  else factor = 90;
  const evidenceStr = (body?.evidenceHash || body?.evidenceText || '').toLowerCase();
  const CATEGORY_RULES = [
    { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
    { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
    { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
    { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
    { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
  ];
  function detectCategory(t){
    let best={ key:'generic', weight:0};
    for(const r of CATEGORY_RULES){
      for(const kw of r.keywords){ if(t.includes(kw)){ if(r.weight>best.weight) best={key:r.key,weight:r.weight}; break; }}
    }
    return best;
  }
  const cat = detectCategory(evidenceStr);
  const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
  const minorKeywords = ['investor','pitch'];
  for (const k of bumpKeywords) if (evidenceStr.includes(k)) factor += 5;
  for (const k of minorKeywords) if (evidenceStr.includes(k)) factor += 2;
  factor += cat.weight;
  if (factor > 95) factor = 95;
  let penalty = 0n;
  if (factor > 0) penalty = (req * BigInt(factor)) / 100n;
  if (penalty > req) penalty = req;
  const approve = factor >= 60 && penalty > 0n && reporter !== offender;
  let band = 'low';
  if (factor >= 80) band = 'high'; else if (factor >= 60) band = 'medium';
  const classification = cat.key;
  const rationale = `cat=${cat.key};catWeight=${cat.weight};band=${band};factor=${factor};requested=${body?.requestedPenaltyWei||0}`;
  return {
    approve,
    penaltyWei: penalty.toString(),
    beneficiary: reporter,
    guilty: offender,
    classification,
    rationale,
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
  if (typeof raw.classification === 'string') out.classification = raw.classification.slice(0,64);
  if (typeof raw.rationale === 'string') out.rationale = raw.rationale.slice(0,512);
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
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET') {
      const info = {
        name: 'nda-ai-endpoint',
        version: '1',
        usage: 'POST JSON: { reporter, offender, requestedPenaltyWei, evidenceHash?, evidenceText? }',
        note: 'Returns structured decision JSON. This GET is a health/usage endpoint only.'
      };
      return new Response(JSON.stringify(info), { status: 200, headers: { 'content-type': 'application/json', ...cors } });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    try {
      // Optional API key check
      const auth = request.headers.get('authorization') || '';
      const expected = env.AI_API_KEY ? `Bearer ${env.AI_API_KEY}` : null;
  if (expected && auth !== expected) return new Response('Unauthorized', { status: 401, headers: cors });

      const body = await request.json();

      // Build a strict prompt for JSON-only output
      const reporter = body?.reporter;
      const offender = body?.offender;
      const requestedPenaltyWei = body?.requestedPenaltyWei;
      const evidenceHash = body?.evidenceHash;
      const evidenceText = body?.evidenceText; // optional

  const prompt = `Given the NDA dispute context, output ONLY valid JSON with keys: approve (boolean), penaltyWei (string integer wei), beneficiary (hex), guilty (hex), classification (short string <=64), rationale (short string <=256). No explanations, no markdown.
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
        headers: { 'content-type': 'application/json', ...cors },
      });
    } catch (err) {
      const decision = baselineDecision({});
      return new Response(JSON.stringify(decision), { status: 200, headers: { 'content-type': 'application/json', ...cors } });
    }
  }
};
