// Simple static file server for evidence JSON files
// Usage: node tools/evidence-server.js [port] [path]
const path = require('path');
const express = require('express');
const cors = require('cors');

const port = process.argv[2] ? Number(process.argv[2]) : 5174;
const serveDir = process.argv[3] ? process.argv[3] : path.join(__dirname, '..', 'front', 'e2e', 'static');

const app = express();
app.use(cors());
app.use(express.static(serveDir));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(serveDir, 'index.html'), err => {
    if (err) res.send('Directory listing not available');
  });
});

// Helpful 404 for requested evidence JSON files: list available filenames
app.use((req, res, next) => {
  // only respond to .json requests with helpful listing
  if (req.path.endsWith('.json')) {
    try {
      const files = require('fs').readdirSync(serveDir).filter(f => f.endsWith('.json'));
      res.status(404).json({
        error: 'evidence_not_found',
        requested: req.path,
        available_count: files.length,
        available_files: files.slice(0, 50),
        message: 'Requested evidence JSON not found in server static directory.'
      });
      return;
    } catch (err) {
      // fall through to default
    }
  }
  next();
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Evidence server serving ${serveDir} on http://127.0.0.1:${port}`);
});
