#!/usr/bin/env node
import fs from 'fs';
import crypto from 'crypto';

function toHexWei(v){
  if (v === null || v === undefined) return '0x0';
  if (typeof v === 'string' && v.startsWith('0x')) return v;
  if (!isNaN(Number(v))) {
    const wei = BigInt(Math.floor(parseFloat(v) * 1e18));
    return '0x' + wei.toString(16);
  }
  throw new Error('Cannot parse value to wei: ' + v);
}

const file = process.argv[2];
const domain = process.argv[3];
if(!file||!domain){
  console.error('Usage: normalizer.js <raw.jsonl> <NDA|RENT>');
  process.exit(1);
}

const lines = fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
for(const line of lines){
  if(!line.trim()) continue;
  const raw = JSON.parse(line);
  const base = {
    id: raw.id || crypto.randomUUID(),
    domain,
    source: raw.source || 'unknown',
    jurisdiction: raw.jurisdiction || 'unknown',
    retrievedAt: raw.retrievedAt || new Date().toISOString(),
    synthetic: !!raw.synthetic,
    classification: raw.classification || raw.label || 'unclassified',
    rationale: raw.rationale || '',
    claimedWei: toHexWei(raw.claimedWei || raw.claimed || 0),
    awardedWei: toHexWei(raw.awardedWei || raw.awarded || 0),
    severity: raw.severity || 1,
    evidenceURIs: raw.evidenceURIs || raw.evidence || [],
    evidenceHash: raw.evidenceHash || null,
    originalTextHash: raw.originalTextHash || null
  };
  if (domain === 'NDA') {
    base.labels = raw.labels || [];
  } else if (domain === 'RENT') {
    base.disputeType = raw.disputeType || 'Quality';
  }
  process.stdout.write(JSON.stringify(base)+'\n');
}
