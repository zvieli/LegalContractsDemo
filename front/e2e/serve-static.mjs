import http from 'http';
import fs from 'fs';
import path from 'path';

const port = Number(process.env.VITE_DEV_PORT || 5174);
const base = new URL('.', import.meta.url).pathname;

const server = http.createServer((req, res) => {
  const p = req.url === '/' ? '/index.html' : req.url;
  const fp = path.join(base, 'static', p);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(fp).slice(1);
    const type = ext === 'html' ? 'text/html' : 'text/plain';
    res.setHeader('Content-Type', type);
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Static server listening on http://localhost:${port}`);
});
