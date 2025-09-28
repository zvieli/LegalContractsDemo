const EthCrypto = require('eth-crypto');
(async ()=>{
  const id = EthCrypto.createIdentity();
  console.log('identity.pub', id.publicKey, 'len', id.publicKey.length);
  const rawPub = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
  console.log('rawPub len', rawPub.length);
  const pubNo04 = rawPub.startsWith('04') ? rawPub.slice(2) : rawPub;
  console.log('pubNo04 len', pubNo04.length);
  try {
    console.log('attempt hex string pubNo04');
    const enc1 = await EthCrypto.encryptWithPublicKey(pubNo04, 'hello');
    console.log('enc1 ok', Object.keys(enc1));
  } catch (e) { console.error('enc1 err', e && e.message ? e.message : e); }
  try {
    console.log('attempt hex string rawPub');
    const enc2 = await EthCrypto.encryptWithPublicKey(rawPub, 'hello');
    console.log('enc2 ok', Object.keys(enc2));
  } catch (e) { console.error('enc2 err', e && e.message ? e.message : e); }
  try {
    console.log('attempt Buffer of rawPub');
    const buf = Buffer.from(rawPub, 'hex');
    console.log('buf len', buf.length);
    const enc3 = await EthCrypto.encryptWithPublicKey(buf, 'hello');
    console.log('enc3 ok', Object.keys(enc3));
  } catch (e) { console.error('enc3 err', e && e.message ? e.message : e); }
})();