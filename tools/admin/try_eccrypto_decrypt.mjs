import fs from 'fs';
import path from 'path';
import eccryptoMod from 'eccrypto';

const eccrypto = eccryptoMod && (eccryptoMod.default || eccryptoMod);
const root = process.cwd();
const dbgPath = path.join(root, 'evidence_storage', 'last_cli_debug.json');
const raw = fs.readFileSync(dbgPath, 'utf8');
const j = JSON.parse(raw.replace(/```json\n|```/g, ''));
const envelope = j.envelope;
const adminPriv = j.adminPriv.replace(/^0x/, '');
const enc = envelope.recipients[0].encryptedKey_ecc || envelope.recipients[0].encryptedKey;

async function run() {
  try {
    if (!enc) { console.error('no enc object found'); return; }
    const ob = {
      iv: Buffer.from(String(enc.iv).replace(/^0x/, ''), 'hex'),
      ephemPublicKey: Buffer.from(String(enc.ephemPublicKey).replace(/^0x/, ''), 'hex'),
      ciphertext: Buffer.from(String(enc.ciphertext).replace(/^0x/, ''), 'hex'),
      mac: Buffer.from(String(enc.mac).replace(/^0x/, ''), 'hex')
    };
    const priv = Buffer.from(adminPriv, 'hex');
    try {
      const dec = await eccrypto.decrypt(priv, ob);
      console.log('eccrypto.decrypt succeeded, plaintext hex=', dec.toString('hex'));
    } catch (e) {
      console.error('eccrypto.decrypt failed:', e && e.message ? e.message : e);
    }
  } catch (e) { console.error('error running test:', e && e.stack ? e.stack : e); }
}

run();
