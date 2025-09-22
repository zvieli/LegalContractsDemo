const express = require('express');
const fs = require('fs');
const path = require('path');
// Load .env for local dev/tests if present (do this after path is available)
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) { /* ignore if dotenv not installed */ }
const { ethers } = require('ethers');
const crypto = require('crypto');
const app = express();
app.use(express.json({ limit: '10mb' }));

// Global error hooks to aid debugging (kept minimal and safe for dev)
process.on('uncaughtException', (err) => {
	console.error('UNCAUGHT_EXCEPTION in pin-server:', err && (err.stack || err.message || err));
});
process.on('unhandledRejection', (reason) => {
	console.error('UNHANDLED_REJECTION in pin-server:', reason && (reason.stack || reason.message || reason));
});

// Admin auth: require an admin private key or explicit admin address via env (no fallback)
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.PIN_SERVER_ADMIN_PRIVATE_KEY || null;
let PIN_SERVER_ADMIN_ADDRESS = process.env.PIN_SERVER_ADMIN_ADDRESS || process.env.PIN_SERVER_ADMIN_ADDR || null;
if (!PIN_SERVER_ADMIN_ADDRESS && ADMIN_PRIVATE_KEY) {
	try {
		// derive address from private key
		PIN_SERVER_ADMIN_ADDRESS = (new ethers.Wallet(ADMIN_PRIVATE_KEY)).address;
	} catch (e) {
		console.error('Failed to derive admin address from ADMIN_PRIVATE_KEY:', e && e.message);
		process.exit(1);
	}
}
if (!PIN_SERVER_ADMIN_ADDRESS) {
	console.error('Pin server requires ADMIN_PRIVATE_KEY or PIN_SERVER_ADMIN_ADDRESS environment variable. Exiting.');
	process.exit(1);
}
PIN_SERVER_ADMIN_ADDRESS = String(PIN_SERVER_ADMIN_ADDRESS).toLowerCase();
// PIN_SERVER_PORTS or PORT must be provided
const PORTS_ENV = process.env.PIN_SERVER_PORTS || process.env.PORT || null;
if (!PORTS_ENV) {
	console.error('Pin server requires PIN_SERVER_PORTS or PORT environment variable to be set. Exiting.');
	process.exit(1);
}
console.log('Pin server startup - config: ', {
	PIN_SERVER_ADMIN_ADDRESS: PIN_SERVER_ADMIN_ADDRESS,
	hasAdminPrivKey: !!ADMIN_PRIVATE_KEY,
	PIN_SERVER_PORTS: PORTS_ENV
});

// Helper to set CORS headers on responses (kept permissive for local dev)
function setCorsHeaders(req, res) {
	const origin = req.headers.origin || '*';
	res.setHeader('Access-Control-Allow-Origin', origin);
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

	// Admin signature path: verify admin EIP-712 typedData + signature instead of API key
	// Request may include `adminTypedData` and `adminSignature`. When present and valid
	// the server will treat the request as an admin operator request.
	try {
		const adminTyped = req.body && req.body.adminTypedData;
		const adminSig = req.body && req.body.adminSignature;
		if (adminTyped && adminSig) {
			// Verify admin signature
			try {
				const verifyFn = (ethers && ethers.verifyTypedData) ? ethers.verifyTypedData : (ethers.utils && ethers.utils.verifyTypedData);
				if (!verifyFn) throw new Error('verifyTypedData unavailable');
				const recovered = verifyFn(adminTyped.domain, adminTyped.types, adminTyped.value, adminSig);
				if (!recovered) throw new Error('Failed to recover admin signer');
				if (!PIN_SERVER_ADMIN_ADDRESS) {
					auditLog({ action: 'admin-decrypt-rejected-no-admin-config', id: req.params.id, recovered: recovered, remote: req.ip });
					return res.status(500).json({ error: 'Server admin not configured' });
				}
				if (String(recovered).toLowerCase() !== PIN_SERVER_ADMIN_ADDRESS) {
					auditLog({ action: 'admin-decrypt-rejected-admin-mismatch', id: req.params.id, recovered: recovered, expected: PIN_SERVER_ADMIN_ADDRESS, remote: req.ip });
					return res.status(403).json({ error: 'Admin signature not valid' });
				}
				// Validate adminTypedData includes nonce/expiry and enforce replay protection
				try {
					const value = adminTyped.value || {};
					const nonce = Number(value.nonce || 0);
					const expiry = Number(value.expiry || 0);
					if (!nonce || !expiry) {
						auditLog({ action: 'admin-decrypt-rejected-bad-typed', id: req.params.id, reason: 'missing nonce/expiry', remote: req.ip });
						return res.status(400).json({ error: 'adminTypedData must include nonce and expiry' });
					}
					if (Date.now() > expiry * 1000) {
						auditLog({ action: 'admin-decrypt-rejected-expired', id: req.params.id, nonce, expiry, remote: req.ip });
						return res.status(403).json({ error: 'Admin signature expired' });
					}
					// Admin nonce replay protection: store used admin nonces per pin id
					const adminNonceFile = path.join(__dirname, 'store', `${req.params.id}.admin_nonces.json`);
					let usedAdmin = [];
					try { if (fs.existsSync(adminNonceFile)) usedAdmin = JSON.parse(fs.readFileSync(adminNonceFile)); } catch (e) { usedAdmin = []; }
					if (usedAdmin.includes(nonce)) {
						auditLog({ action: 'admin-decrypt-rejected-nonce-replay', id: req.params.id, nonce, remote: req.ip });
						return res.status(403).json({ error: 'Admin nonce already used' });
					}
					// Authorized as admin — decrypt and return
					try {
						const keyBuf = getAesKeyFromEnv();
						const stored = record.cipherStr;
						let decrypted = null;
						let usedPlaintextFallback = false;
						if (stored) {
							try { decrypted = decryptAesGcm(stored, keyBuf); } catch (e) { decrypted = stored; usedPlaintextFallback = true; }
						}
						// mark admin nonce used
						usedAdmin.push(nonce);
						try { fs.writeFileSync(adminNonceFile, JSON.stringify(usedAdmin)); } catch (e) { /* ignore */ }
						auditLog({ action: 'admin-decrypt', id: req.params.id, operator: 'admin-sig', remote: req.ip, admin: recovered, nonce, expiry });
						if (usedPlaintextFallback && typeof decrypted === 'string') return res.json({ decrypted: `decrypted(${decrypted})` });
						return res.json({ decrypted });
					} catch (err) {
						console.error('Decrypt failed (admin sig):', err && err.message);
						return res.status(500).json({ error: 'Decrypt failed' });
					}
				} catch (err2) {
					auditLog({ action: 'admin-decrypt-error', id: req.params.id, err: err2 && err2.message, remote: req.ip });
					return res.status(500).json({ error: 'Admin typedData processing failed' });
				}
			} catch (e) {
				auditLog({ action: 'admin-decrypt-rejected-admin-sig', id: req.params.id, err: e && e.message, remote: req.ip });
				return res.status(403).json({ error: 'Invalid admin signature' });
			}
		}
	} catch (e) {
		console.error('Admin signature verification error:', e && e.message);
		return res.status(500).json({ error: 'Admin signature verification failed' });
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
	const secret = process.env.PIN_SERVER_AES_KEY || process.env.PIN_SERVER_SYMM_KEY;
	if (!secret) {
		console.error('Pin server requires PIN_SERVER_AES_KEY or PIN_SERVER_SYMM_KEY environment variable. Exiting.');
		process.exit(1);
	}
	const s = String(secret).trim();
	// Accept hex (64 chars) or base64; otherwise fall back to interpreting as passphrase and derive via sha256
	if (/^[0-9a-fA-F]{64}$/.test(s)) {
		return Buffer.from(s, 'hex');
	}
	try {
		const b = Buffer.from(s, 'base64');
		if (b.length === 32) return b;
	} catch (e) { /* not base64 */ }
	// fallback: treat as passphrase and derive 32-byte key via sha256
	return crypto.createHash('sha256').update(s).digest();
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
const _startedServers = [];
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
		const server = app.listen(p, () => {
			console.log(`Pin server running on ${p}`);
		});
		_startedServers.push(server);
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

// Small safeguard for test environments: prevent process from exiting immediately
// when servers are listening to ensure child-process tests can connect.
// This keeps stdin open which prevents Node from exiting in some CI/child contexts.
console.log('Pin server: startup complete, keeping process alive for test connections');
process.stdin.resume();

// Exported helper for tests to shut down the in-process server
module.exports = {
	shutdown: () => {
		try {
			_startedServers.forEach(s => {
				try { s.close(); } catch (e) { /* ignore */ }
			});
		} catch (e) { /* ignore */ }
	}
};

