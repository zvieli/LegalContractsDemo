import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(){
  try{
    const eciesBrowser = await import('../front/src/utils/ecies-browser.js');
    const eciesServer = await import('./crypto/ecies.js');

    // keys observed in evidence_storage debug
    const adminPriv = '0xfe2eb5eb6db912cf1d4564ea6237491adc6d2d7dc2aca95eb151b27ab95693c5';
    const cliPriv = '0x111cbf6d1d5b8787e1408e3308842d9c8ed70b3b0a31bf50ba9880b0d195d534';

    console.log('adminPriv:', adminPriv);
    const pubA = await eciesBrowser.getPublicKeyFromPrivate(adminPriv);
    console.log('ecies-browser pub for adminPriv:', pubA);
    console.log('ecies-browser normalized:', eciesBrowser.normalizePublicKeyHex(pubA));

    console.log('ecies-server normalized from private (server normalizePublicKeyHex):', eciesServer.normalizePublicKeyHex(pubA));

    console.log('---');
    console.log('cliPriv:', cliPriv);
    const pubC = await eciesBrowser.getPublicKeyFromPrivate(cliPriv);
    console.log('ecies-browser pub for cliPriv:', pubC);
    console.log('ecies-browser normalized:', eciesBrowser.normalizePublicKeyHex(pubC));
    console.log('ecies-server normalized:', eciesServer.normalizePublicKeyHex(pubC));

    // Also print the recipient pubkey from the producer_debug file
  const dbgPath = path.join(__dirname, '..', 'evidence_storage', 'producer_debug_1759272472063.json');
    if (fs.existsSync(dbgPath)){
      const dbg = JSON.parse(fs.readFileSync(dbgPath,'utf8'));
      console.log('producer_debug recipient pubkey:', dbg.recipients && dbg.recipients[0] && dbg.recipients[0].pubkey);
      try{ console.log('normalized producer pubkey (browser):', eciesBrowser.normalizePublicKeyHex(dbg.recipients[0].pubkey)); }catch(e){console.error('browser normalize failed', e.message);}      
      try{ console.log('normalized producer pubkey (server):', eciesServer.normalizePublicKeyHex(dbg.recipients[0].pubkey)); }catch(e){console.error('server normalize failed', e.message);}      
    }

  }catch(e){
    console.error('debug script error', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

main();
