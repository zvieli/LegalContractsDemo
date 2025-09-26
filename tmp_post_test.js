const http = require('http');
const data = JSON.stringify({ test: 'hello from e2e' });
const opts = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/submit-evidence',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
};

const req = http.request(opts, res => {
  console.log('STATUS', res.statusCode);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('BODY', d));
});
req.on('error', e => console.error('ERR', e.message));
req.write(data);
req.end();
