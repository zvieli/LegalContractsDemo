#!/usr/bin/env node
/**
 * Local Chainlink Functions Playground Simulation
 * ------------------------------------------------
 * Goal: Run the inline Functions source (ai_oracle.js) locally with mock args & secrets
 * to replicate what the official Playground does (without sending an on-chain request).
 *
 * Why: Lets you iterate AI logic deterministically, inspect ABI-encoded output, and
 * decode it to human-readable form before deploying or configuring the Functions source.
 *
 * Usage:
 *   npm run playground:sim                # uses defaults
 *   ARGS='["11155111","0xNDA","0","0xR","0xO","50000000000000000","0xHASH"]' npm run playground:sim
 *   AI_URL=https://... AI_KEY=sk-123 npm run playground:sim
 *
 * Environment Vars (override defaults):
 *   ARGS  - JSON array of 7 arguments (see below)
 *   AI_URL - Endpoint URL (same as AI_ENDPOINT_URL on-chain)
 *   AI_KEY - API Key (same as AI_API_KEY)
 *   SILENT=1 - suppress pretty output (only JSON)
 *
 * Args Layout (MUST mirror contract expectation):
 *   [0] chainId
 *   [1] nda address
 *   [2] caseId
 *   [3] reporter address
 *   [4] offender address
 *   [5] requestedPenaltyWei (string number)
 *   [6] evidenceHash (0x bytes32 or free-form text used for keyword heuristics)
 *
 * Output: ABI encoded response hex + decoded object.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Load inline source (we reuse chainlink/functions/ai_oracle.js verbatim)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_PATH = path.join(__dirname, '..', 'chainlink', 'functions', 'ai_oracle.js');

let sourceCode = fs.readFileSync(SOURCE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Provide mock Functions global API (subset needed by ai_oracle.js)
// ---------------------------------------------------------------------------
const mockHttpRequest = async ({ url, method = 'POST', headers = {}, data, timeout = 10000 }) => {
  if (!url) throw new Error('No URL provided');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data)
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { data: parsed, status: resp.status, raw: text };
  } catch (err) {
    return { data: null, status: 0, error: err.message };
  } finally {
    clearTimeout(id);
  }
};

function encodeAbi(types, values){
  // ai_oracle uses object form for encode: array of {type,name}
  const t = types.map(t => typeof t === 'string' ? t : t.type);
  return ethers.AbiCoder.defaultAbiCoder().encode(t, values);
}

const Functions = { makeHttpRequest: mockHttpRequest, encodeAbi };

// ---------------------------------------------------------------------------
// Build execution context sandbox
// ---------------------------------------------------------------------------
const defaultArgs = [
  '11155111',
  '0x0000000000000000000000000000000000000001',
  '0',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
  '50000000000000000',
  'roadmap+customer+earnings example'
];

let args;
try {
  args = process.env.ARGS ? JSON.parse(process.env.ARGS) : defaultArgs;
} catch { args = defaultArgs; }

if (!Array.isArray(args) || args.length !== 7) {
  console.error('ARGS must be a JSON array of length 7.');
  process.exit(1);
}

const secrets = {
  AI_ENDPOINT_URL: process.env.AI_URL || '',
  AI_API_KEY: process.env.AI_KEY || ''
};

// We'll capture return value by wrapping code.
const wrapped = `async function __run(){\n${sourceCode}\n}\n__run();`;

const sandbox = { args, secrets, Functions, console, fetch, BigInt, setTimeout, clearTimeout };
const context = vm.createContext(sandbox);

async function run(){
  try {
    const script = new vm.Script(wrapped, { filename: 'ai_oracle_inline.js' });
    const resultPromise = script.runInContext(context);
    const encoded = await resultPromise; // hex string

    // Decode using the types expected by oracle contract
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['bool','uint256','address','address','string','string'],
      encoded
    );

    const out = {
      encoded,
      approve: decoded[0],
      penaltyWei: decoded[1].toString(),
      beneficiary: decoded[2],
      guilty: decoded[3],
      classification: decoded[4],
      rationale: decoded[5],
      args,
      usedSecrets: { AI_ENDPOINT_URL: !!secrets.AI_ENDPOINT_URL, AI_API_KEY: !!secrets.AI_API_KEY }
    };

    if (process.env.SILENT) {
      console.log(JSON.stringify(out));
    } else {
      console.log('\n=== Local Functions Playground Simulation ===');
      console.log('Args:', args);
      console.log('Secrets provided?', out.usedSecrets);
      console.log('Encoded Response:', encoded);
      console.log('Decoded ->');
      console.table({
        approve: out.approve,
        penaltyWei: out.penaltyWei,
        beneficiary: out.beneficiary,
        guilty: out.guilty,
        classification: out.classification,
        rationale: out.rationale
      });
    }
  } catch (err) {
    console.error('Simulation error:', err);
    process.exit(1);
  }
}

run();
