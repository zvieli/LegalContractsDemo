import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const storage = path.resolve(__dirname, '..', '..', 'evidence_storage');
  const files = fs.readdirSync(storage).filter(f => f.endsWith('.json')).sort().reverse();
  const file = path.join(storage, files[0]);
  console.error('Debug file', file);
  const raw = fs.readFileSync(file, 'utf8');
  const envelope = JSON.parse(raw);
  const privPath = path.join(storage, 'last_cli_privkey.txt');
  if (!fs.existsSync(privPath)) { console.error('no priv'); process.exit(2); }
  const priv = fs.readFileSync(privPath,'utf8').trim();
  const privNo0x = priv.startsWith('0x') ? priv.slice(2) : priv;
  console.error('Using priv preview', String(priv).slice(-12));

  const rec = envelope.recipients && envelope.recipients[0];
  console.error('Recipient keys present:', !!rec && !!rec.encryptedKey, !!rec && !!rec.encryptedKey_ecc, 'cryptoPresent=', !!envelope.crypto);

  // Try eth-crypto decrypt of recipient.encryptedKey
  try {
    const EthCrypto = (await import('eth-crypto')).default || (await import('eth-crypto'));
    console.error('Trying EthCrypto.decryptWithPrivateKey on recipient.encryptedKey');
    try {
      const dec = await EthCrypto.decryptWithPrivateKey(privNo0x, rec.encryptedKey);
      console.log('EthCrypto decrypted recipient key:', dec);
    } catch (e) {
      console.error('EthCrypto.recipient.encryptedKey error:', e && e.stack ? e.stack : e);
    }

    if (envelope.crypto) {
      console.error('Trying EthCrypto.decryptWithPrivateKey on envelope.crypto');
      try {
        const dec2 = await EthCrypto.decryptWithPrivateKey(privNo0x, envelope.crypto);
        console.log('EthCrypto decrypted envelope.crypto =>', dec2);
      } catch (e) {
        console.error('EthCrypto.envelope.crypto error:', e && e.stack ? e.stack : e);
      }
    }
  } catch (e) {
    console.error('eth-crypto import or use failed:', e && e.stack ? e.stack : e);
  }

  // Try eccrypto decrypt on encryptedKey_ecc and encryptedKey
  try {
    const eccryptoModule = await import('eccrypto');
    const eccrypto = eccryptoModule && (eccryptoModule.default || eccryptoModule);
    const twoStripped = privNo0x;
    if (rec.encryptedKey_ecc) {
      try {
        console.error('Trying eccrypto.decrypt on encryptedKey_ecc');
        const ob = rec.encryptedKey_ecc;
        const encBuf = {
          iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
          ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
          ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
          mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
        };
        console.error('encBuf lengths iv,ephem,ciphertext,mac=', encBuf.iv.length, encBuf.ephemPublicKey.length, encBuf.ciphertext.length, encBuf.mac.length);
        const dec = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encBuf);
        console.log('eccrypto decrypted (raw):', dec, 'hex=', dec.toString('hex'));
      } catch (e) {
        console.error('eccrypto.encryptedKey_ecc error:', e && e.stack ? e.stack : e);
      }
    }
    if (rec.encryptedKey) {
      try {
        console.error('Trying eccrypto.decrypt on encryptedKey (object)');
        let ob = rec.encryptedKey;
        if (typeof ob === 'string') { try { ob = JSON.parse(ob); } catch (e) { ob = null; } }
        if (ob) {
          const encBuf = {
            iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
            ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
            ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
            mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
          };
          console.error('encBuf lengths iv,ephem,ciphertext,mac=', encBuf.iv.length, encBuf.ephemPublicKey.length, encBuf.ciphertext.length, encBuf.mac.length);
          const dec = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encBuf);
          console.log('eccrypto decrypted (raw):', dec, 'hex=', dec.toString('hex'));
        }
      } catch (e) {
        console.error('eccrypto.encryptedKey error:', e && e.stack ? e.stack : e);
      }
    }
  } catch (e) {
    console.error('eccrypto import failed or error:', e && e.stack ? e.stack : e);
  }
}

run().catch(e => { console.error('run error', e && e.stack ? e.stack : e); process.exit(1); });
