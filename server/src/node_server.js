// Minimal Node HTTP wrapper around the Worker-style fetch handler
// Run with: npm run ai:serve
import app from './index.js';
import { createServer } from 'http';

const PORT = process.env.AI_PORT ? Number(process.env.AI_PORT) : 8787;

createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(',')); else if (v) headers.set(k, v);
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = Buffer.concat(chunks);
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuf.length) init.body = bodyBuf;
    const request = new Request(url, init);
    const response = await app.fetch(request, process.env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { res.setHeader(key, value); });
    if (response.body) {
      const ab = await response.arrayBuffer();
      res.end(Buffer.from(ab));
    } else res.end();
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
  }
}).listen(PORT, () => {
  console.log(`[ai-server] listening on http://127.0.0.1:${PORT}`);
});
