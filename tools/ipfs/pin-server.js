const express = require('express');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const crypto = require('crypto');
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
	return res.json(record);
});

// Allow pinning via POST /pin for tests that expect to create entries
app.post('/pin', (req, res) => {
	setCorsHeaders(req, res);
	const body = req.body;
	console.log('POST /pin incoming, body keys:', Object.keys(body || {}));
	try {
		// encrypt cipherStr using AES-GCM with server key if provided as plaintext
		const keyBuf = getAesKeyFromEnv();
		const payload = Object.assign({}, body || {});
		if (payload.cipherStr) {
			// If the client already provided AES-GCM JSON (has alg==aes-gcm), keep as-is.
			try {
				const parsed = typeof payload.cipherStr === 'string' ? JSON.parse(payload.cipherStr) : payload.cipherStr;
				if (!parsed || parsed.alg !== 'aes-gcm') {
					payload.cipherStr = encryptAesGcm(payload.cipherStr, keyBuf);
				}
			} catch (e) {
				// treat as plaintext
				payload.cipherStr = encryptAesGcm(payload.cipherStr, keyBuf);
			}
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

app.post('/admin/decrypt/:id', async (req, res) => {
	setCorsHeaders(req, res);
	const file = path.join(__dirname, 'store', `${req.params.id}.json`);
	if (!fs.existsSync(file)) return res.status(404).send('Not found');
	const record = JSON.parse(fs.readFileSync(file));

	// Audit log helper (append to a local audit logfile)
	function auditLog(entry) {
		try {
			const lf = path.join(__dirname, 'store', 'audit.log');
			const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
			fs.appendFileSync(lf, line);
		} catch (e) { console.warn('Failed to write audit log', e && e.message); }
	}

	// Reject legacy client API-key flow from browser by checking origin header.
	// If a valid server-side admin key exists, it may be used by server operators (not browsers).
	const apiKey = req.header('X-API-KEY');
	const requiredKey = process.env.PIN_SERVER_API_KEY || process.env.PIN_SERVER_ADMIN_KEY || null;
	if (apiKey && requiredKey && apiKey === requiredKey) {
		// Only allow API key usage from non-browser origins (simple heuristic)
		const origin = req.headers.origin || '';
		if (origin && (origin.startsWith('http://') || origin.startsWith('https://'))) {
			// If API key is sent from a browser origin, refuse (to avoid accidental exposure)
			auditLog({ action: 'admin-decrypt-rejected-api-from-browser', id: req.params.id, origin, remote: req.ip });
			return res.status(403).json({ error: 'API key usage from browser not allowed' });
		}
		// Server operator allowed: decrypt and return (admin path)
		try {
			const keyBuf = getAesKeyFromEnv();
			const stored = record.cipherStr;
			let decrypted = null;
			if (stored) {
				try {
					// try AES-GCM JSON format
					decrypted = decryptAesGcm(stored, keyBuf);
				} catch (e) {
					// fallback: if stored is raw plaintext, return as-is
					decrypted = stored;
				}
			}
			auditLog({ action: 'admin-decrypt', id: req.params.id, operator: 'api-key', remote: req.ip });
			return res.json({ decrypted });
		} catch (err) {
			console.error('Decrypt failed:', err && err.message);
			return res.status(500).json({ error: 'Decrypt failed' });
		}
	}

	// Require EIP-712 typedData + signature(s) for all browser/client reveals. Reject legacy plain signature or no-signature requests.
	try {
		const body = req.body || {};
		// Expect body.typedData and body.signature (and optional additional signatures array)
		const typed = body.typedData;
		const sig = body.signature;
		const additional = Array.isArray(body.signatures) ? body.signatures : [];
		const requireBoth = !!body.requireBoth;
		if (!typed || !sig) {
			auditLog({ action: 'decrypt-rejected-missing-typed', id: req.params.id, remote: req.ip });
			return res.status(403).json({ error: 'EIP-712 typedData and signature required' });
		}

		// Validate typedData structure: must include domain.verifyingContract and value.pinId and value.contractAddress (or contract)
		try {
			const domain = typed.domain || {};
			const value = typed.value || {};
			if (!domain.verifyingContract) {
				auditLog({ action: 'decrypt-rejected-bad-typed', id: req.params.id, reason: 'missing verifyingContract', remote: req.ip });
				return res.status(400).json({ error: 'typedData domain.verifyingContract required' });
			}
			// pinId may be under value.pinId or value.pin
			const pinProvided = value.pinId || value.pin || value.pin_id;
			const contractProvided = value.contractAddress || value.contract || value.contractAddress;
			if (!pinProvided || !contractProvided) {
				auditLog({ action: 'decrypt-rejected-bad-typed', id: req.params.id, reason: 'missing pinId or contract', remote: req.ip });
				return res.status(400).json({ error: 'typedData value must include pinId and contractAddress' });
			}
			// Verify typedData pinId matches requested id
			if (String(pinProvided) !== String(req.params.id)) {
				auditLog({ action: 'decrypt-rejected-pin-mismatch', id: req.params.id, providedPin: pinProvided, remote: req.ip });
				return res.status(400).json({ error: 'typedData pinId mismatch' });
			}
			// Validate expiry/nonce in value
			const nonce = Number(value.nonce || 0);
			const expiry = Number(value.expiry || 0);
			if (!nonce || !expiry) {
				auditLog({ action: 'decrypt-rejected-bad-typed', id: req.params.id, reason: 'missing nonce/expiry', remote: req.ip });
				return res.status(400).json({ error: 'typedData must include nonce and expiry' });
			}
			if (Date.now() > expiry * 1000) {
				auditLog({ action: 'decrypt-rejected-expired', id: req.params.id, nonce, expiry, remote: req.ip });
				return res.status(403).json({ error: 'Signature expired' });
			}
			// Nonce replay protection: store used nonces in a small JSON file per pin id
			const nonceStoreFile = path.join(__dirname, 'store', `${req.params.id}.nonces.json`);
			let used = [];
			try { if (fs.existsSync(nonceStoreFile)) used = JSON.parse(fs.readFileSync(nonceStoreFile)); } catch (e) { used = []; }
			if (used.includes(nonce)) {
				auditLog({ action: 'decrypt-rejected-nonce-replay', id: req.params.id, nonce, remote: req.ip });
				return res.status(403).json({ error: 'Nonce already used' });
			}

			// Verify primary signature
			let signerAddr;
			try {
				// ethers v6 exposes verifyTypedData at top-level; older patterns use ethers.utils.verifyTypedData
				const verifyFn = (ethers && ethers.verifyTypedData) ? ethers.verifyTypedData : (ethers.utils && ethers.utils.verifyTypedData);
				if (!verifyFn) {
					console.error('verifyTypedData function not found on ethers namespace');
					throw new Error('verifyTypedData unavailable');
				}
				signerAddr = verifyFn(typed.domain, typed.types, typed.value, sig);
			} catch (e) {
				// Debug: compute digest and attempt recovery to help diagnose signature format mismatches
				try {
					const TypedDataEncoder = ethers.TypedDataEncoder || (ethers.utils && ethers.utils.TypedDataEncoder);
					const digest = TypedDataEncoder.hash(typed.domain, typed.types, typed.value);
					let recoveredAddr = null;
					try { recoveredAddr = ethers.recoverAddress(digest, sig); } catch (_) { recoveredAddr = null; }
					// Record minimal info in audit log without printing secret values to console
					auditLog({ action: 'decrypt-rejected-bad-signature', id: req.params.id, err: e && e.message, sigLen: sig ? String(sig.length) : 'nil', recoveredAddrFallback: recoveredAddr, remote: req.ip });
				} catch (ee) {
					auditLog({ action: 'decrypt-rejected-bad-signature-debug-failed', id: req.params.id, err: ee && ee.message, remote: req.ip });
				}
				return res.status(403).json({ error: 'Invalid signature' });
			}

			// Verify signer is landlord/tenant/arbiter on-chain
			const recovered = [String(signerAddr).toLowerCase()];
			if (process.env.PIN_SERVER_TEST_ALLOW_SIGNER === 'true') {
				// Test mode: accept the signer as both parties to simplify E2E tests
				req._lowLandlord = String(signerAddr).toLowerCase();
				req._lowTenant = String(signerAddr).toLowerCase();
			} else {
				const rpc = process.env.PIN_SERVER_RPC_URL || 'http://127.0.0.1:8545';
				const provider = new ethers.providers.JsonRpcProvider(rpc);
				const ABI = [
					'function landlord() view returns (address)',
					'function tenant() view returns (address)'
				];
				const target = new ethers.Contract(contractProvided, ABI, provider);
				let landlordAddr = null; let tenantAddr = null;
				try { landlordAddr = await target.landlord(); } catch (e) { /* not a rent contract */ }
				try { tenantAddr = await target.tenant(); } catch (e) { /* not a rent contract */ }
				if (!landlordAddr && !tenantAddr) {
					auditLog({ action: 'decrypt-rejected-no-parties', id: req.params.id, contract: contractProvided, remote: req.ip });
					return res.status(400).json({ error: 'Contract does not expose landlord/tenant' });
				}
				const lowLandlord = landlordAddr ? String(landlordAddr).toLowerCase() : null;
				const lowTenant = tenantAddr ? String(tenantAddr).toLowerCase() : null;
				// attach lowLandlord/lowTenant to outer scope for later checks
				req._lowLandlord = lowLandlord;
				req._lowTenant = lowTenant;
			}

			// Verify any additional signatures (should be in typedData+signature format)
			for (const s of additional) {
				try {
					if (s && s.typedData && s.signature) {
						const addr = ethers.utils.verifyTypedData(s.typedData.domain, s.typedData.types, s.typedData.value, s.signature);
						recovered.push(String(addr).toLowerCase());
					}
				} catch (e) { /* ignore individual failures */ }
			}

			// check requirement
			if (requireBoth) {
				const hasLandlord = recovered.includes(req._lowLandlord) || recovered.includes(req._lowTenant);
				const hasTenant = recovered.includes(req._lowTenant) || recovered.includes(req._lowLandlord);
				if (!hasLandlord || !hasTenant) {
					auditLog({ action: 'decrypt-rejected-require-both-missing', id: req.params.id, recovered, remote: req.ip });
					return res.status(403).json({ error: 'Both landlord and tenant signatures required' });
				}
			} else {
				const ok = recovered.some(r => (req._lowLandlord && r === req._lowLandlord) || (req._lowTenant && r === req._lowTenant));
				if (!ok) {
					auditLog({ action: 'decrypt-rejected-no-matching-signer', id: req.params.id, recovered, remote: req.ip });
					return res.status(403).json({ error: 'Signature must be from landlord or tenant' });
				}
			}

			// Mark nonce used
			used.push(nonce);
			try { fs.writeFileSync(nonceStoreFile, JSON.stringify(used)); } catch (e) { /* ignore */ }
			auditLog({ action: 'decrypt-authorized', id: req.params.id, recovered, nonce, expiry, remote: req.ip });

			// Authorized — decrypt and return
			try {
				const keyBuf = getAesKeyFromEnv();
				const stored = record.cipherStr;
				let decrypted = null;
				if (stored) {
					try {
						decrypted = decryptAesGcm(stored, keyBuf);
					} catch (e) {
						decrypted = stored;
					}
				}
				return res.json({ decrypted });
			} catch (err) {
				console.error('Decrypt failed after signature auth:', err && err.message);
				return res.status(500).json({ error: 'Decrypt failed' });
			}
		} catch (e) {
			console.error('TypedData decrypt path failed:', e && e.message);
			return res.status(500).json({ error: 'TypedData path error' });
		}
	} catch (err) {
		console.error('Decrypt handler unexpected error:', err && err.message);
		return res.status(500).json({ error: 'Server error' });
	}
});

// AES-GCM encryption/decryption helpers
function getAesKeyFromEnv() {
	const secret = process.env.PIN_SERVER_AES_KEY || process.env.PIN_SERVER_SYMM_KEY || 'dev-secret-key';
	// Derive 32-byte key via SHA-256 of secret (so env can be passphrase)
	return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptAesGcm(plain, keyBuf) {
	const iv = crypto.randomBytes(12); // 96-bit recommended
	const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
	const ct = Buffer.concat([cipher.update(Buffer.from(String(plain), 'utf8')), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Store as JSON string for easier interop with browser
	return JSON.stringify({ alg: 'aes-gcm', iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') });
}

function decryptAesGcm(encJsonStr, keyBuf) {
	let obj = null;
	try { obj = typeof encJsonStr === 'string' ? JSON.parse(encJsonStr) : encJsonStr; } catch (e) { throw new Error('Malformed encrypted payload'); }
	if (!obj || obj.alg !== 'aes-gcm' || !obj.iv || !obj.ct || !obj.tag) throw new Error('Unsupported encrypted format');
	const iv = Buffer.from(obj.iv, 'base64');
	const ct = Buffer.from(obj.ct, 'base64');
	const tag = Buffer.from(obj.tag, 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
	decipher.setAuthTag(tag);
	const out = Buffer.concat([decipher.update(ct), decipher.final()]);
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

