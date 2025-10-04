#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function usage(){
  console.error('Usage: sync-recipient-keys.js <config.json> <outputFile recipient_pubkeys.json>');
  process.exit(1);
}

const [,, configPath, outPath] = process.argv;
if(!configPath || !outPath) usage();

const fullCfg = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
if(!fs.existsSync(fullCfg)) {
  console.error('Config file not found:', fullCfg); process.exit(2);
}
let cfg;
try { cfg = JSON.parse(fs.readFileSync(fullCfg,'utf8')); } catch(e){ console.error('Invalid JSON config:', e.message); process.exit(3); }
if(!Array.isArray(cfg.recipients)) { console.error('Config must contain recipients: [...]'); process.exit(4); }

const normalized = [];
for(const r of cfg.recipients){
  if(!r.address || !r.pubkey) { console.error('Skipping recipient missing address/pubkey'); continue; }
  normalized.push({ address: r.address, pubkey: r.pubkey });
}

if(!normalized.length) { console.error('No valid recipients to write'); process.exit(5); }

const dest = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
fs.writeFileSync(dest, JSON.stringify(normalized,null,2));
console.log('Recipient keys synced to', dest, 'count=', normalized.length);
