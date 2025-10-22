(async () => {
  const endpoints = [
    { name: 'OLLAMA', url: 'http://localhost:11434/api/version' },
    { name: 'OLLAMA_generate', url: 'http://localhost:11434/api/generate' },
    { name: 'IPFS', url: 'http://127.0.0.1:5001/api/v0/version' }
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { method: 'GET' });
      const text = await res.text();
      console.log(JSON.stringify({ name: ep.name, url: ep.url, ok: res.ok, status: res.status, body: text.substring(0, 200) }));
    } catch (err) {
      console.log(JSON.stringify({ name: ep.name, url: ep.url, ok: false, error: String(err) }));
    }
  }
})();
