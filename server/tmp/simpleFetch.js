async function postBatch() {
  const payload = { caseId: 'case-debug', evidenceItems: [] };
  try {
    const res = await fetch('http://localhost:3001/api/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    console.log('STATUS', res.status);
    console.log('HEADERS:');
    for (const [k,v] of res.headers) console.log(k+':',v);
    const body = await res.text();
    console.log('BODY>>>');
    console.log(body || '<empty>');
  } catch (e) {
    console.error('ERR', e);
  }
}

(async ()=>{ await postBatch(); })();
