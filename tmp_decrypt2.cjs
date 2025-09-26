const fs = require('fs');
const EthCrypto = require('eth-crypto');
(async ()=>{
  try{
    const payload = JSON.parse(fs.readFileSync('./front/e2e/static/dd6d453ce1fa3298b0575aefaf5577876223e375a2c1497da21e80cc4d9326b8.json','utf8'));
    const encrypted = payload && payload.crypto ? payload.crypto : payload;
    const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const pkNo0x = pk.startsWith('0x') ? pk.slice(2) : pk;
    const plain = await EthCrypto.decryptWithPrivateKey(pkNo0x, encrypted);
    console.log('PLAINTEXT:', plain);
  } catch(e) {
    console.error('ERR', e && e.message ? e.message : e);
    console.error(e);
  }
})();
