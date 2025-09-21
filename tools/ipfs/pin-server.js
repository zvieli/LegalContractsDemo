const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json({ limit: '10mb' }));

// Helper to set CORS headers on responses (kept permissive for local dev)
function setCorsHeaders(req, res) {
	const origin = req.headers.origin || '*';
	res.setHeader('Access-Control-Allow-Origin', origin);
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
}

app.options('/pin', (req,res) => { setCorsHeaders(req, res); return res.sendStatus(204); });
app.options('/pin/:id', (req,res) => { setCorsHeaders(req, res); return res.sendStatus(204); });

app.get('/pin/:id', (req, res) => {
	setCorsHeaders(req, res);
	const file = path.join(__dirname, 'store', `${req.params.id}.json`);
	if (!fs.existsSync(file)) return res.status(404).send('Not found');
	const record = JSON.parse(fs.readFileSync(file));
		res.json(record);
});

// Allow pinning via POST /pin for tests that expect to create entries
app.post('/pin', (req, res) => {
	setCorsHeaders(req, res);
	const body = req.body;
	console.log('POST /pin incoming, body keys:', Object.keys(body || {}));
	try {
		// encrypt cipherStr deterministically using symmetric key before storing
		const symKey = process.env.PIN_SERVER_SYMM_KEY || 'devkey';
		const payload = Object.assign({}, body || {});
		if (payload.cipherStr) {
			payload.cipherStr = encryptSym(payload.cipherStr, symKey);
		}
		if (!payload.id) {
			// create an id if not provided
			payload.id = `pin_${Date.now()}`;
		}
		const file = path.join(__dirname, 'store', `${payload.id}.json`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(payload));
			return res.json({ id: payload.id });
	} catch (err) {
		console.error('Error writing pin file:', err && err.message);
		res.status(500).json({ error: 'Failed to store pin' });
	}
});

app.post('/admin/decrypt/:id', (req, res) => {
		setCorsHeaders(req, res);
	const apiKey = req.header('X-API-KEY');
	// Allow either PIN_SERVER_API_KEY or legacy PIN_SERVER_ADMIN_KEY env var. Default to 'dev-secret'
	const requiredKey = process.env.PIN_SERVER_API_KEY || process.env.PIN_SERVER_ADMIN_KEY || 'dev-secret';
	if (!apiKey || apiKey !== requiredKey) return res.status(403).send('Unauthorized');

	const file = path.join(__dirname, 'store', `${req.params.id}.json`);
	if (!fs.existsSync(file)) return res.status(404).send('Not found');
	const record = JSON.parse(fs.readFileSync(file));
	// decrypt stored cipherStr with symmetric key (dev-mode)
	try {
		const symKey = process.env.PIN_SERVER_SYMM_KEY || 'devkey';
		const stored = record.cipherStr;
		let decrypted = null;
		if (stored) {
			// Heuristic: if stored appears to be base64 (re-encoding check), treat as encrypted
			let treatedAsEncrypted = false;
			try {
				const decoded = Buffer.from(stored, 'base64').toString('utf8');
				const reencoded = Buffer.from(decoded, 'utf8').toString('base64');
				// Compare without padding to be tolerant
				if (reencoded.replace(/=+$/, '') === String(stored).replace(/=+$/, '')) {
					treatedAsEncrypted = true;
				}
			} catch (e) {
				treatedAsEncrypted = false;
			}

			if (treatedAsEncrypted) {
				decrypted = decryptSym(stored, symKey);
			} else {
				// stored value is likely plaintext already
				decrypted = stored;
			}
		}
				const legacyWrapped = typeof decrypted === 'string' ? `decrypted(${decrypted})` : decrypted;
				res.json({ decrypted: legacyWrapped });
	} catch (err) {
		console.error('Decrypt failed:', err && err.message);
		res.status(500).json({ error: 'Decrypt failed' });
	}
});

// Deterministic symmetric XOR cipher + base64 encode (dev only)
function encryptSym(plain, key) {
	const pb = Buffer.from(plain, 'utf8');
	const kb = Buffer.from(key, 'utf8');
	const out = Buffer.alloc(pb.length);
	for (let i = 0; i < pb.length; i++) {
		out[i] = pb[i] ^ kb[i % kb.length];
	}
	return out.toString('base64');
}

function decryptSym(cipherB64, key) {
	const cb = Buffer.from(cipherB64, 'base64');
	const kb = Buffer.from(key, 'utf8');
	const out = Buffer.alloc(cb.length);
	for (let i = 0; i < cb.length; i++) {
		out[i] = cb[i] ^ kb[i % kb.length];
	}
	return out.toString('utf8');
}

const ports = [];
// support environment PORTS like "8080,3002" or single PORT
if (process.env.PIN_SERVER_PORTS) {
	ports.push(...process.env.PIN_SERVER_PORTS.split(',').map(p => parseInt(p.trim(), 10)));
} else if (process.env.PORT) {
	ports.push(parseInt(process.env.PORT, 10));
} else {
	ports.push(8080, 3002);
}

ports.forEach(p => {
	try {
		const server = app.listen(p, () => console.log(`Pin server running on ${p}`));
		server.on('error', (err) => {
			if (err && err.code === 'EADDRINUSE') {
				console.warn(`Port ${p} already in use; skipping bind`);
			} else {
				console.error(`Server error on port ${p}:`, err && err.message);
			}
		});
	} catch (e) {
		console.error('Failed to listen on', p, e.message);
	}
});

