import fetch from 'node-fetch';

(async function(){
  try{
    const cid='bafkreihiyn4hmskhhjsymhn75fnt6wyimf4hu4iiniegfdclgut23y3v74';
    const res = await fetch('http://localhost:3001/api/evidence/retrieve/'+encodeURIComponent(cid));
    console.log('status', res.status);
    const txt = await res.text();
    try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch(e) { console.log('raw text:', txt); }
  }catch(e){ console.error(e); process.exit(1); }
})();
