const fs = require('fs');
(async()=>{
  try{
    const { decryptEvidencePayload } = await import('./tools/admin/decryptHelper.js');
    const payload = fs.readFileSync('./front/e2e/static/dd6d453ce1fa3298b0575aefaf5577876223e375a2c1497da21e80cc4d9326b8.json','utf8');
    const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const plain = await decryptEvidencePayload(payload, key);
    console.log('PLAINTEXT:', plain);
  } catch(e){
    console.error('ERR', e);
  }
})();
