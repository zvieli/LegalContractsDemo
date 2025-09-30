import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const storage = path.resolve(__dirname, '..', '..', 'evidence_storage');
  const files = fs.readdirSync(storage).filter(f => f.endsWith('.json')).sort().reverse();
  if (!files || files.length === 0) { console.error('no files'); process.exit(2); }
  const file = path.join(storage, files[0]);
  console.error('Using file', file);
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const privPath = path.join(storage, 'last_cli_privkey.txt');
  const priv = fs.existsSync(privPath) ? fs.readFileSync(privPath, 'utf8').trim() : null;
  if (!priv) { console.error('no priv'); process.exit(3); }
  const helper = await import('./decryptHelper.js');
  try {
    console.error('Calling helper with string payload...');
    const out1 = await helper.decryptEvidencePayload(raw, priv);
    console.log('OUT1 OK:', out1);
  } catch (e) { console.error('OUT1 ERR:', e && e.stack ? e.stack : e); }
  try {
    console.error('Calling helper with object payload...');
    const out2 = await helper.decryptEvidencePayload(parsed, priv);
    console.log('OUT2 OK:', out2);
  } catch (e) { console.error('OUT2 ERR:', e && e.stack ? e.stack : e); }
}

run().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
