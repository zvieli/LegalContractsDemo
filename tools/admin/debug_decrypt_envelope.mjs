import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const dbgDir = path.join(root, 'evidence_storage');
const debugFile = path.join(dbgDir, 'last_cli_debug.json');
const rawFile = path.join(dbgDir, 'last_cli_rawbytes.json');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error('failed read', p, e && e.message); return null; } }

const dbg = loadJson(debugFile);
const raw = loadJson(rawFile);
if (!dbg) { console.error('no last_cli_debug.json'); process.exit(2); }
const envelope = dbg.envelope;
const adminPriv = String(dbg.adminPriv || '').replace(/^0x/, '');
if (!adminPriv) { console.error('no admin priv in debug file'); process.exit(3); }

async function run() {
  console.log('adminPriv:', adminPriv.slice(-16));
  for (const r of envelope.recipients || []) {
    console.log('\nRecipient address:', r.address);
    const enc = r.encryptedKey || r.encryptedKey_ecc;
    console.log('enc fields:', Object.keys(enc || {}).join(','));
    if (!enc) continue;

    const iv = enc.iv; const ephem = enc.ephemPublicKey; const ct = enc.ciphertext; const mac = enc.mac;
    console.log('raw iv len', iv && iv.length, 'ephem len', ephem && ephem.length, 'ct len', ct && ct.length, 'mac len', mac && mac.length);

    // normalize to hex buffers
    const norm = (s) => {
      if (!s) return null;
      const str = String(s).trim();
      if (str.startsWith('0x')) return Buffer.from(str.slice(2), 'hex');
      if (/^[0-9a-fA-F]+$/.test(str)) return Buffer.from(str, 'hex');
      // base64 case
      try { return Buffer.from(str, 'base64'); } catch (e) {}
      return Buffer.from(str, 'utf8');
    };

    const ivb = norm(iv); const ephemb = norm(ephem); const ctb = norm(ct); const macb = norm(mac);
    console.log('iv bytes', ivb && ivb.length, 'ephem bytes', ephemb && ephemb.length, 'ct bytes', ctb && ctb.length, 'mac bytes', macb && macb.length);
    console.log('ephem prefix', ephemb && ephemb.toString('hex').slice(0,32));

    // Try eccrypto
    try {
      const eccryptoMod = await import('eccrypto');
      const eccrypto = eccryptoMod && (eccryptoMod.default || eccryptoMod);
      const encBuf = { iv: ivb, ephemPublicKey: ephemb, ciphertext: ctb, mac: macb };
      try {
        const dec = await eccrypto.decrypt(Buffer.from(adminPriv, 'hex'), encBuf);
        console.log('eccrypto.decrypt OK, len=', dec.length, 'hex=', dec.toString('hex'));
      } catch (e) {
        console.error('eccrypto.decrypt FAIL:', e && e.message);
      }
    } catch (e) {
      console.error('eccrypto import fail:', e && e.message);
    }

    // Try eth-crypto
    try {
      const ethMod = await import('eth-crypto');
      const EthCrypto = ethMod && (ethMod.default || ethMod);
      const privNo0x = adminPriv;
      const tries = [privNo0x, '0x' + privNo0x];
      for (const p of tries) {
        try {
          const res = await EthCrypto.decryptWithPrivateKey(p, enc);
          console.log('EthCrypto.decryptWithPrivateKey success for priv', p.slice(-8), '->', res.slice(0,80));
        } catch (e) {
          console.error('EthCrypto failure for priv', String(p).slice(-8), e && e.message);
        }
      }
    } catch (e) {
      console.error('eth-crypto import fail:', e && e.message);
    }
  }
}

run().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(99); });
