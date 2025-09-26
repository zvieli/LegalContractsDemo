// Simple static server to serve a directory (no external deps)
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.argv[2] ? Number(process.argv[2]) : 5173;
const baseDir = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(__dirname, '..', 'front', 'dist');

function mimeType(ext) {
  const m = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon'
  };
  return m[ext.toLowerCase()] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  try {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(baseDir, reqPath);
    if (!filePath.startsWith(baseDir)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeType(ext) });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // fallback to index.html for SPA
    const index = path.join(baseDir, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(index).pipe(res); return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Simple static server serving ${baseDir} at http://127.0.0.1:${port}`);
});

process.on('SIGINT', ()=>{ server.close(); process.exit(0); });
process.on('SIGTERM', ()=>{ server.close(); process.exit(0); });
