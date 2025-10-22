import { fetchPlaintext } from '../server/lib/previewResolver.js';

(async ()=>{
  const ref = 'helia://bafkreihiyn4hmskhhjsymhn75fnt6wyimf4hu4iiniegfdclgut23y3v74';
  try{
    const txt = await fetchPlaintext(ref);
    console.log('preview:', txt);
  } catch(e){ console.error('err', e); process.exit(1); }
})();
