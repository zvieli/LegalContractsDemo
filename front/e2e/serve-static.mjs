import http from 'http';
import fs from 'fs';
import path from 'path';

const port = Number(process.env.VITE_DEV_PORT || 5174);
let base = new URL('.', import.meta.url).pathname;
// On Windows the pathname can start with a leading slash like '/C:/...'
// which, when joined with path.join, produces an invalid path starting with '\\C:\...'.
if (process.platform === 'win32' && base.startsWith('/')) base = base.slice(1);

const server = http.createServer((req, res) => {
  // Simple CORS handling so the Vite dev server (localhost:5173) can fetch files
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const p = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
  const fp = path.join(base, 'static', p);
  console.log('serve-static: requested:', req.url, '->', fp);
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(fp).slice(1);
    let type = 'text/plain';
    if (ext === 'html') type = 'text/html';
    else if (ext === 'json') type = 'application/json';
    res.setHeader('Content-Type', type);
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Static server listening on http://localhost:${port}`);
});
