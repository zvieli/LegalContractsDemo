// --- Express server wrapper ---
// Load local .env into process.env for convenience in dev
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const PORT = 8787;

app.use(bodyParser.json({ limit: '4mb' }));

// Health check
app.get('/', async (req, res) => {
  const info = {
    name: 'nda-ai-endpoint',
    version: '1',
    usage: 'POST JSON: { reporter, offender, requestedPenaltyWei, evidenceHash?, evidenceText? }',
    note: 'Returns structured decision JSON. This GET is a health/usage endpoint only.'
  };
  res.json(info);
});

// Main AI decision endpoint
app.post('/', async (req, res) => {
  try {
    // Simulate the env object from .env
    const env = {
      AI_API_KEY: process.env.AI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL
    };
    // Build a Request-like object
    const headers = new Map();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, v);
    const request = {
      method: req.method,
      headers: {
        get: (key) => headers.get(key.toLowerCase()) || '',
      },
      json: async () => req.body
    };
    const response = await (await import('./index.js')).default.fetch(request, env);
    const body = await response.text();
    res.status(response.status || 200);
    for (const [k, v] of Object.entries(response.headers)) res.setHeader(k, v);
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

app.options('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`AI server listening on http://127.0.0.1:${PORT}`);
  console.log('DEBUG: GEMINI_API_KEY present=', !!process.env.GEMINI_API_KEY, 'GEMINI_MODEL=', process.env.GEMINI_MODEL);
});
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

import { callGemini } from './provider_gemini.js';
let RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
let RATE_LIMIT_MAX = 120; // per IP per window
const rlState = new Map(); // ip => {windowStart,count}
function checkRateLimit(ip){
  const now = Date.now();
  let st = rlState.get(ip);
  if(!st || now - st.windowStart > RATE_LIMIT_WINDOW_MS){ st={windowStart:now,count:0}; }
  st.count++;
  rlState.set(ip, st);
  return st.count <= RATE_LIMIT_MAX;
}

function _parseRequested(body){
  let v = body?.requestedPenaltyWei ?? body?.requestedAmountWei ?? 0;
  try { return BigInt(v); } catch { return 0n; }
}

function baselineDecisionNDA(body){
  const reporter = isHexAddress(body?.reporter) ? body.reporter : '0x0000000000000000000000000000000000000000';
  const offender = isHexAddress(body?.offender) ? body.offender : '0x0000000000000000000000000000000000000000';
  let req = _parseRequested(body); if (req < 0n) req = 0n;
  const ethScaled = Number(req) / 1e18;
  let factor = 0;
  if (ethScaled < 0.01) factor = 0; else if (ethScaled <= 0.1) factor = 60; else if (ethScaled <= 0.3) factor = 70; else if (ethScaled <= 0.5) factor = 80; else factor = 90;
  const evidenceStr = (body?.evidenceHash || body?.evidenceText || '').toLowerCase();
  const CATEGORY_RULES = [
    { key: 'source_code', keywords: ['source','code','gist'], weight: 15 },
    { key: 'financial_forecast', keywords: ['earnings','guidance','forecast'], weight: 12 },
    { key: 'customer_data', keywords: ['customer','customers','client','clientlist','customerlist'], weight: 10 },
    { key: 'roadmap', keywords: ['roadmap','timeline','releaseplan','milestone'], weight: 8 },
    { key: 'investor_material', keywords: ['investor','pitch','deck'], weight: 6 },
  ];
  function detectCategory(t){ let best={ key:'generic', weight:0}; for(const r of CATEGORY_RULES){ for(const kw of r.keywords){ if(t.includes(kw)){ if(r.weight>best.weight) best={key:r.key,weight:r.weight}; break; }}} return best; }
  const cat = detectCategory(evidenceStr);
  const bumpKeywords = ['source','code','gist','roadmap','customer','earnings'];
  const minorKeywords = ['investor','pitch'];
  for (const k of bumpKeywords) if (evidenceStr.includes(k)) factor += 5;
  for (const k of minorKeywords) if (evidenceStr.includes(k)) factor += 2;
  factor += cat.weight; if (factor > 95) factor = 95;
  let penalty = 0n; if (factor > 0) penalty = (req * BigInt(factor)) / 100n; if (penalty > req) penalty = req;
  const approve = factor >= 60 && penalty > 0n && reporter !== offender;
  let band = 'low'; if (factor >= 80) band = 'high'; else if (factor >= 60) band='medium';
  const classification = cat.key;
  const rationale = `domain=NDA;cat=${cat.key};catWeight=${cat.weight};band=${band};factor=${factor};requested=${body?.requestedPenaltyWei||body?.requestedAmountWei||0}`;
  return { reporter, offender, approve, penaltyWei: penalty.toString(), classification, rationale };
}

function baselineDecisionRent(body){
  const reporter = isHexAddress(body?.reporter) ? body.reporter : '0x0000000000000000000000000000000000000000';
  const offender = isHexAddress(body?.offender) ? body.offender : '0x0000000000000000000000000000000000000000';
  let req = _parseRequested(body); if (req < 0n) req = 0n;
  const disputeTypeRaw = (body?.disputeType || '').toString();
  const dt = disputeTypeRaw.toLowerCase();
  let base = 50; // default
  if (dt === 'damage') base = 75;
  else if (dt === 'conditionend') base = 65;
  else if (dt === 'conditionstart') base = 55;
  else if (dt === 'quality') base = 60;
  else if (dt === 'depositsplit') base = 50;
  else if (dt === 'earlyterminationjustcause') base = 70;
  else if (dt === 'externalvaluation') base = 45;
  let factor = base;
  const evidence = (body?.evidenceText || body?.evidenceHash || '').toLowerCase();
  const severePlus = ['severe','major','extensive','fire','flood','mold','structural'];
  const minorMinus = ['minor','cosmetic'];
  for (const kw of severePlus) if (evidence.includes(kw)) factor += 10;
  for (const kw of minorMinus) if (evidence.includes(kw)) factor -= 5;
  if (factor < 0) factor = 0; if (factor > 95) factor = 95;
  let penalty = 0n; if (factor > 0) penalty = (req * BigInt(factor)) / 100n; if (penalty > req) penalty = req;
  const approve = factor >= 60 && penalty > 0n && reporter !== offender;
  let band='low'; if (factor >= 80) band='high'; else if (factor >= 60) band='medium';
  const classification = `rent_${dt||'generic'}`.slice(0,64);
  const rationale = `domain=RENT;type=${dt};band=${band};factor=${factor};requested=${body?.requestedPenaltyWei||body?.requestedAmountWei||0}`;
  return { reporter, offender, approve, penaltyWei: penalty.toString(), classification, rationale };
}

function selectBaseline(body){
  const domain = (body?.domain || 'NDA').toUpperCase();
  if (domain === 'RENT') return baselineDecisionRent(body);
  return baselineDecisionNDA(body);
}

function coerceDecision(body, raw) {
  const base = selectBaseline(body);
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
  if (typeof raw.classification === 'string') {
    const domain = (body?.domain || 'NDA').toUpperCase();
    const rc = raw.classification.slice(0,64);
    // Only accept raw classification when it follows domain-safe patterns
    if (domain === 'RENT') {
      if (rc.toLowerCase().startsWith('rent_')) out.classification = rc;
    } else {
      // NDA: accept only if it contains NDA-related keywords or is one of known categories
      const safe = ['nda','source','financial','customer','roadmap','investor','generic'];
      const low = rc.toLowerCase();
      for (const s of safe) { if (low.includes(s)) { out.classification = rc; break; } }
    }
  }
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
      // evidence length guard
      if (body && typeof body.evidenceText === 'string' && body.evidenceText.length > 2048) {
        body.evidenceText = body.evidenceText.slice(0,2048);
      }
  // rate limit (best-effort; prefer standard proxy headers or fallback to local)
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'local';
      if(!checkRateLimit(ip)) return new Response('Rate Limited', {status:429, headers: cors});

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

  // Gemini provider (fallback heuristic if null).
      // Call provider; provider now returns {status, text, parsed}
      let aiDecision = { status: 'none', text: null, parsed: null };
      if (env.GEMINI_API_KEY) {
        try {
          aiDecision = await callGemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || 'gemini-1.5-flash', prompt);
          console.log('DEBUG: callGemini status=', aiDecision?.status);
          if (aiDecision?.text) console.log('DEBUG: ai text (slice)=', aiDecision.text.slice(0,1000));
        } catch (err) {
          console.warn('DEBUG: callGemini failed:', err?.message || err);
        }
      } else {
        console.log('DEBUG: no GEMINI_API_KEY found in env, using baseline fallback');
      }

      // Prefer parsed JSON from provider, fallback to null
      const parsedAi = aiDecision?.parsed || null;
      const decision = coerceDecision(body, parsedAi);

      // Compose response with all fields expected by tests
      const now = Date.now();
  const response = {
        caseId: body?.caseId || '',
        status: decision.approve ? 'resolved' : 'rejected',
        awardedWei: Number(decision.penaltyWei ? String(decision.penaltyWei) : '0'),
        decision: decision.classification || '',
        rationale: decision.rationale || '',
        resolvedAt: now,
        // original fields for compatibility
        ...decision
  };
  // expose raw ai text for debugging in Node (no secrets)
  try { response._raw = aiDecision?.text ?? null; } catch {}
      // audit log (Node only)
      try {
        if (typeof process !== 'undefined' && process?.versions?.node) {
          const fs = await import('fs');
          const rec = { ts: now, ip, domain: body?.domain||'NDA', approve: decision.approve, classification: decision.classification, penaltyWei: decision.penaltyWei, requested: body?.requestedPenaltyWei||body?.requestedAmountWei||'0' };
          fs.appendFileSync('server/logs/ai_decisions.jsonl', JSON.stringify(rec)+'\n');
        }
      } catch {}

      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json', ...cors },
      });
    } catch (err) {
  const decision = selectBaseline({});
      return new Response(JSON.stringify(decision), { status: 200, headers: { 'content-type': 'application/json', ...cors } });
    }
  }
};
