import fs from 'fs';
import path from 'path';
import { decryptEvidencePayload } from './decryptHelper.js';

const root = process.cwd();
const dbgPath = path.join(root, 'evidence_storage', 'last_cli_debug.json');
const raw = fs.readFileSync(dbgPath, 'utf8');
const j = JSON.parse(raw.replace(/```json\n|```/g, ''));

const envelope = j.envelope;
const adminPriv = j.adminPriv;

(async () => {
  try {
    const out = await decryptEvidencePayload(envelope, adminPriv);
    console.log('decryptHelper returned:', out);
  } catch (e) {
    console.error('decryptHelper error:', e && e.message);
  }
})();
