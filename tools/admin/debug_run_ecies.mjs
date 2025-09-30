import fs from 'fs';
import path from 'path';
const envPath = path.resolve('evidence_storage','last_cli_debug.json');
const raw = JSON.parse(fs.readFileSync(envPath,'utf8'));
const envelope = raw.envelope;
const adminPriv = raw.adminPriv;
(async ()=>{
  try {
    const ecies = await import('../crypto/ecies.js');
    const enc = envelope.recipients[0].encryptedKey;
    console.log('EncryptedKey object:', enc);
    const priv = adminPriv.startsWith('0x')?adminPriv.slice(2):adminPriv;
    const dec = await ecies.decryptWithPrivateKey(priv, enc);
    console.log('ECIES decrypt result:', dec);
  } catch (e) {
    console.error('ECIES debug failed:', e && e.stack ? e.stack : e);
  }
})();
