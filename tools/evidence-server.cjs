// Simple static file server for evidence JSON files (CommonJS)
const path = require('path');
const express = require('express');
const cors = require('cors');

const port = process.argv[2] ? Number(process.argv[2]) : 5174;
const serveDir = process.argv[3] ? process.argv[3] : path.join(__dirname, '..', 'front', 'e2e', 'static');

const app = express();
app.use(cors());
app.use(express.static(serveDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(serveDir, 'index.html'), err => {
    if (err) res.send('Directory listing not available');
  });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Evidence server serving ${serveDir} on http://127.0.0.1:${port}`);
});
