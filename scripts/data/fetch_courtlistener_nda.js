#!/usr/bin/env node
/**
 * fetch_courtlistener_nda.js
 * -------------------------------------------------------
 * Fetch CourtListener opinions (NDA breach query) -> NDJSON stdout.
 * Adds rate‑limit awareness (logs X-RateLimit headers), paging, optional since-date filter.
 *
 * Usage examples:
 *   node scripts/data/fetch_courtlistener_nda.js "non-disclosure agreement breach" 80 > courtlistener.jsonl
 *   node scripts/data/fetch_courtlistener_nda.js "nda breach" 200 --since 2024-01-01 --maxPages 5 > out.jsonl
 *   COURTLISTENER_TOKEN=xxx node scripts/data/fetch_courtlistener_nda.js "trade secret" 100
 *
 * Positional:
 *   <query> <limit>
 * Flags:
 *   --since YYYY-MM-DD   Only opinions with date_filed >= given date
 *   --maxPages N         Stop after N pages even if limit not reached
 *   --quiet              Suppress progress logs (only errors to stderr)
 *
 * Env:
 *   COURTLISTENER_TOKEN        API token (recommended)
 *   COURTLISTENER_API_TOKEN    (alias)
 *   COURT_LISTENER_TOKEN       (alias)
 *   COURTLISTENER_BASE         Base URL (default https://www.courtlistener.com)
 *   COURTLISTENER_DELAY_MS     Base delay between pages (default 600)
 *   COURTLISTENER_BACKOFF_MAXS Max seconds for exponential backoff (default 30)
 *
 * Output: each opinion JSON (raw) as one line. Progress & rate usage to stderr.
 */

import 'dotenv/config';

const BASE = process.env.COURTLISTENER_BASE || 'https://www.courtlistener.com';
// Accept multiple possible env var spellings for convenience
const token = process.env.COURTLISTENER_TOKEN || process.env.COURTLISTENER_API_TOKEN || process.env.COURT_LISTENER_TOKEN;
const baseDelayMs = Number(process.env.COURTLISTENER_DELAY_MS || 600);
const backoffMax = Number(process.env.COURTLISTENER_BACKOFF_MAXS || 30);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchJson(url, attempt=0){
  const headers = { 'Accept': 'application/json' };
  if(token) headers['Authorization'] = `Token ${token}`;
  const res = await fetch(url,{ headers });
  const limitHdr = res.headers.get('X-RateLimit-Limit');
  const remHdr = res.headers.get('X-RateLimit-Remaining');
  const resetHdr = res.headers.get('X-RateLimit-Reset');
  const trace = `limit=${limitHdr||'?'} remaining=${remHdr||'?'} reset=${resetHdr||'?'} attempt=${attempt}`;
  if(res.status === 401){ throw new Error('401 Unauthorized – provide COURTLISTENER_TOKEN in env'); }
  if(res.status === 403){ throw new Error('403 Forbidden – token lacks permission or blocked'); }
  if(res.status === 429){
    const retryAfter = Number(res.headers.get('Retry-After')) || Math.min(2 ** attempt * 2, backoffMax);
    console.error(`[RATE] 429 backing off ${retryAfter}s (${trace})`);
    await sleep(retryAfter * 1000);
    return fetchJson(url, attempt+1);
  }
  if(!res.ok){
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0,160)}`);
  }
  let data; try { data = await res.json(); } catch(e){ throw new Error('Invalid JSON body'); }
  return { data, rate: { limit: limitHdr, remaining: remHdr, reset: resetHdr } };
}

async function main(){
  const qArg = process.argv[2];
  const limit = Number(process.argv[3] || 50);
  const extraArgs = process.argv.slice(4);
  let since = null; let maxPages = null; let quiet=false;
  for(let i=0;i<extraArgs.length;i++){
    const a = extraArgs[i];
    if(a==='--since' && extraArgs[i+1]) { since = extraArgs[++i]; }
    else if(a==='--maxPages' && extraArgs[i+1]) { maxPages = Number(extraArgs[++i]); }
    else if(a==='--quiet') quiet=true;
  }
  if(!qArg){
    console.error('Usage: fetch_courtlistener_nda.js <search_query> [limit] [--since YYYY-MM-DD] [--maxPages N] [--quiet] > out.jsonl');
    process.exit(1);
  }
  const search = encodeURIComponent(qArg.replace(/\s+/g,'+'));
  let url = `${BASE}/api/rest/v3/opinions/?search=${search}&order_by=dateFiled`;
  if(since){ url += `&date_filed__gte=${encodeURIComponent(since)}`; }
  let fetched = 0; let page=0;
  while(url && fetched < limit){
    page++;
    if(maxPages && page>maxPages) break;
    let bundle;
    try { bundle = await fetchJson(url); } catch(e){ console.error('Fetch error:', e.message); process.exit(2); }
    const { data, rate } = bundle;
    if(!data || !data.results){ console.error('Unexpected response shape'); break; }
    for(const item of data.results){
      process.stdout.write(JSON.stringify(item)+'\n');
      fetched++; if(fetched>=limit) break;
    }
    if(!quiet){
      console.error(`[PAGE ${page}] fetched=${fetched}/${limit} remainingRate=${rate.remaining??'?'} limitRate=${rate.limit??'?'} next=${data.next? 'yes':'no'}`);
    }
    if(fetched>=limit) break;
    url = data.next ? (data.next.startsWith('http')? data.next : BASE+data.next) : null;
    if(url && fetched < limit){ await sleep(baseDelayMs); }
  }
  console.error(`Done. Fetched ${fetched} items. pages=${page}`);
}

main();
