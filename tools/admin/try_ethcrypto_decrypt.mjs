import fs from 'fs';
import path from 'path';
import EthCrypto from 'eth-crypto';

const root = process.cwd();
const dbgPath = path.join(root, 'evidence_storage', 'last_cli_debug.json');
const raw = fs.readFileSync(dbgPath, 'utf8');
const j = JSON.parse(raw.replace(/```json\n|```/g, ''));
const envelope = j.envelope;
const adminPriv = j.adminPriv;
const enc = envelope.recipients[0].encryptedKey;

(async () => {
  try {
    const out = await EthCrypto.decryptWithPrivateKey(adminPriv, enc);
    console.log('EthCrypto decrypted =>', out);
  } catch (e) {
    console.error('EthCrypto error:', e && e.message);
  }
})();
