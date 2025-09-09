// Lightweight Gemini provider wrapper using global fetch

import fs from 'fs';
import path from 'path';

// In-memory cooldown window to avoid rapid retries after RESOURCE_EXHAUSTED
let geminiRateLimitUntil = 0;

export async function callGemini(apiKey, model, prompt) {
  const nowTs = Date.now();
  if (nowTs < geminiRateLimitUntil) {
    // Quick short-circuit when we've recently observed a quota exhaustion
    return { status: 'rate_limited', text: null, parsed: null, _raw: null };
  }
  // Return shape: { status, text, parsed } where parsed is JSON if parseable else null
  if (!apiKey) return { status: 'no_key', text: null, parsed: null };
  // Prefer explicit model argument, then env override, then a more capable default
  // Prefer explicit model argument, then env override; default to low-latency flash model
  const m = model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  // For API keys (AIza...) we'll send as query param ?key=API_KEY. For OAuth/Bearer tokens (ya29...) we'll use Authorization header.
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  const hasBearer = typeof apiKey === 'string' && apiKey.startsWith('ya29');
  if (!hasBearer) {
    // append key param for API-key style credentials
    url += `?key=${encodeURIComponent(apiKey)}`;
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [ { text: prompt } ]
      }
    ],
    generationConfig: {
      // slightly lower temperature for consistency but keep some diversity
      temperature: 0.1,
      topP: 0.95,
      // increase token budget for richer JSON/rationale outputs
      maxOutputTokens: 1024
    }
  };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (hasBearer) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  const data = await res.json();
    // DEBUG: slice of provider response to help diagnose format issues
    try { console.log('DEBUG: provider response status=', res.status, 'bodySlice=', JSON.stringify(data).slice(0,2000)); } catch(e){}
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Keep raw text for logs, then try multiple cleaning heuristics to extract JSON
    const raw = String(text || '');
    let cleaned = raw.replace(/^\s*Response:\s*/i, '').trim();
    // remove common markdown fences and explanatory leading/trailing lines
    cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
    // If the model produced a "Decision:" header, strip leading words up to first brace
    if (!cleaned.startsWith('{')) {
      const braceIdx = cleaned.indexOf('{');
      if (braceIdx > -1) cleaned = cleaned.slice(braceIdx).trim();
    }

    let parsed = null;
    // Try direct JSON parse
    try { parsed = JSON.parse(cleaned); } catch (err) { parsed = null; }

    // If direct parse failed, try to extract structured JSON-like blocks heuristically
    if (!parsed && cleaned) {
      // try fenced JSON blocks inside text (```json ... ```)
      const fenceMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
      if (fenceMatch && fenceMatch[1]) {
        try { parsed = JSON.parse(fenceMatch[1].trim()); console.log('DEBUG: parsed from fenced block'); } catch(e) { parsed = null; }
      }
    }

    if (!parsed && cleaned) {
      // try to extract largest {...} block
      const braceMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)];
      if (braceMatches.length) {
        // pick the longest block (heuristic)
        const longest = braceMatches.map(m => m[0]).sort((a,b)=>b.length-a.length)[0];
        try { parsed = JSON.parse(longest); console.log('DEBUG: parsed from largest-brace block'); } catch(e) { parsed = null; }
      }
    }

    if (!parsed && cleaned) {
      // try to convert key=value or "k: v" lines into JSON-ish structure
      const lines = cleaned.split('\n').map(l=>l.trim()).filter(Boolean);
      const kv = {};
      let found = false;
      for (const line of lines) {
        const m1 = line.match(/^\s*"?([a-zA-Z0-9_\- ]+)"?\s*:\s*(".*"|\d+|true|false|null|\[.*\]|\{.*\})\s*$/);
        const m2 = line.match(/^\s*([a-zA-Z0-9_\- ]+)\s*=\s*(.+)$/);
        if (m1) {
          found = true;
          try { kv[m1[1].trim()] = JSON.parse(m1[2]); } catch(e) { kv[m1[1].trim()] = m1[2].replace(/^"|"$/g,''); }
        } else if (m2) {
          found = true;
          let v = m2[2].trim();
          if (/^[0-9]+$/.test(v)) v = Number(v);
          else v = v.replace(/^"|"$/g,'');
          kv[m2[1].trim()] = v;
        }
      }
      if (found) parsed = kv;
    }

    // If provider reports a quota/rate-limit (429), try to extract suggested retry info
    if (res.status === 429 || (data && data.error && data.error.status === 'RESOURCE_EXHAUSTED')) {
      try {
        // Look for RetryInfo in details
        const details = data?.error?.details || [];
        for (const d of details) {
          if (d && d['@type'] && d['@type'].includes('RetryInfo') && d.retryDelay) {
            // retryDelay is a string like '2s' or '500ms'
            const s = String(d.retryDelay || '');
            const m = s.match(/([0-9]+)\s*(ms|s|m)?/i);
            if (m) {
              const val = Number(m[1]);
              const unit = (m[2] || 's').toLowerCase();
              let delayMs = val * 1000;
              if (unit === 'ms') delayMs = val;
              else if (unit === 'm') delayMs = val * 60 * 1000;
              geminiRateLimitUntil = Date.now() + delayMs + 1000; // small buffer
              console.warn('WARN: Gemini rate-limited, backoff until', new Date(geminiRateLimitUntil).toISOString());
              break;
            }
          }
        }
      } catch (e) { /* ignore parsing errors */ }
    }

    // ensure logs directory exists
    try { fs.mkdirSync(path.join(process.cwd(),'server','logs'), { recursive: true }); } catch(e){}
    try {
      const logLine = JSON.stringify({ ts: (new Date()).toISOString(), status: res.status, raw: raw.slice(0,20000) }) + '\n';
      fs.appendFileSync(path.join(process.cwd(),'server','logs','ai_responses.log'), logLine);
    } catch (e) { console.error('WARN: failed to write ai_responses.log', e && e.message); }

    return { status: res.status, text: cleaned || null, parsed, _raw: raw };
  } catch (err) {
    try { fs.mkdirSync(path.join(process.cwd(),'server','logs'), { recursive: true }); } catch(e){}
    try { fs.appendFileSync(path.join(process.cwd(),'server','logs','ai_responses.log'), JSON.stringify({ ts: (new Date()).toISOString(), status: 'error', error: String(err) }) + '\n'); } catch(e){}
    return { status: 'error', text: null, parsed: null, _raw: String(err) };
  }
}
