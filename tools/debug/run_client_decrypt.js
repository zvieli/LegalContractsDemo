import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbg = path.resolve(process.cwd(), 'evidence_storage', 'last_cli_debug.json');
if (!fs.existsSync(dbg)) { console.error('no last_cli_debug.json'); process.exit(1); }
const ld = JSON.parse(fs.readFileSync(dbg,'utf8'));
const envFile = ld.file || ld.envelope && ld.envelope.file;
const envelope = ld.envelope || ld.envelope; // if embedded
let envObj = null;
if (ld.envelope) envObj = ld.envelope;
else if (envFile && fs.existsSync(envFile)) envObj = JSON.parse(fs.readFileSync(envFile,'utf8'));
if (!envObj) { console.error('no envelope found'); process.exit(2); }
const adminPriv = ld.adminPriv || ld.adminPrivDerivedAddress || process.env.ADMIN_PRIVATE_KEY;
if (!adminPriv) { console.error('no admin priv'); process.exit(3); }

(async () => {
  process.env.TESTING = '1';
  const { decryptEnvelopeWithPrivateKey } = await import('../../front/src/utils/clientDecrypt.js');
  try {
    const out = await decryptEnvelopeWithPrivateKey(envObj, adminPriv);
    console.log('DECRYPT OK ->', out);
  } catch (e) {
    console.error('DECRYPT ERR ->', e && e.stack ? e.stack : e);
  }
})();
