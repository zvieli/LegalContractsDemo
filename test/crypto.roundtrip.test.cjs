const assert = require('assert');
const EthCrypto = require('eth-crypto');
const crypto = require('crypto');
const eccrypto = require('eccrypto');

describe('Crypto roundtrip (ECIES + AES-GCM)', function() {
  it('encrypts symKey with eth-crypto and decrypts with eccrypto, and AES-GCM roundtrip', async function() {
    this.timeout(5000);
    const id = EthCrypto.createIdentity();
    const sym = crypto.randomBytes(32).toString('hex');

    // Encrypt symmetric key using eth-crypto (which uses eccrypto under the hood)
    const pub = id.publicKey && id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    const enc = await EthCrypto.encryptWithPublicKey(pub, sym);
    const canonical = { iv: enc.iv, ephemPublicKey: enc.ephemPublicKey, ciphertext: enc.ciphertext, mac: enc.mac };

    // Serialize/deserialize
    const s = JSON.stringify(canonical);
    const parsed = JSON.parse(s);

    // Decrypt using eccrypto (buffer-based)
    const buf = {
      iv: Buffer.from(parsed.iv, 'hex'),
      ephemPublicKey: Buffer.from(parsed.ephemPublicKey, 'hex'),
      ciphertext: Buffer.from(parsed.ciphertext, 'hex'),
      mac: Buffer.from(parsed.mac, 'hex')
    };
    const pk = Buffer.from(id.privateKey.startsWith('0x') ? id.privateKey.slice(2) : id.privateKey, 'hex');
    const dec = await eccrypto.decrypt(pk, buf);
    assert.strictEqual(dec.toString('utf8'), sym, 'symmetric key roundtrip');

    // AES-GCM encrypt/decrypt using the symmetric key hex
    const symBuf = Buffer.from(sym, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', symBuf, iv);
    const plaintext = JSON.stringify({ hello: 'world', ts: Date.now() });
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv('aes-256-gcm', symBuf, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    assert.strictEqual(out.toString('utf8'), plaintext, 'AES-GCM roundtrip');
  });
});
