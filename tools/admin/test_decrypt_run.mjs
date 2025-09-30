import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const helper = await import('./decryptHelper.js');
  const adminKeyPath = path.resolve(path.join(__dirname, '..', '..', 'admin.key'));
  let adminKey = null;
  if (fs.existsSync(adminKeyPath)) adminKey = fs.readFileSync(adminKeyPath, 'utf8').trim();
  if (!adminKey) {
    console.error('No admin.key found'); process.exit(2);
  }
  // pick the latest envelope in evidence_storage
  const storage = path.resolve(path.join(__dirname, '..', '..', 'evidence_storage'));
  let files = fs.readdirSync(storage).filter(f => f.endsWith('.json')).sort().reverse();
  files = files.filter(f => f !== 'index.json');
  if (!files || files.length === 0) { console.error('No envelope files'); process.exit(3); }
  const file = path.join(storage, files[0]);
  console.error('Trying file', file);
  const raw = fs.readFileSync(file, 'utf8');
  try {
    const out = await helper.decryptEvidencePayload(raw, adminKey);
    console.log('DECRYPTED:', out);
    process.exit(0);
  } catch (e) {
    console.error('DECRYPT FAILED:', e && e.stack ? e.stack : e);
    process.exit(7);
  }
}

run();
