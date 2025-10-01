import * as secp from '@noble/secp256k1';
import crypto from 'crypto';
import { appendTestingTrace } from '../../utils/testing-helpers.js';

function strip0x(s) { if (!s && s !== 0) return s; let t = String(s).trim(); if (t.startsWith('0x')) t = t.slice(2); return t; }

function hexToUint8(hex) {
	const s = strip0x(hex) || '';
	const clean = String(s).trim().toLowerCase();
	const len = Math.ceil(clean.length / 2);
	const out = new Uint8Array(len);
	for (let i = 0; i < len; i++) out[i] = parseInt(clean.substr(i * 2, 2) || '00', 16);
	return out;
}

function uint8ToHex(u8) {
	return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ensureUncompressed(pubHex) {
	let s = strip0x(pubHex);
	if (!s) throw new Error('public key required');
	s = String(s).trim().toLowerCase();
	// if 128 hex chars (no 04 prefix) add prefix
	if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
	// if compressed, expand
	if (s.length === 66 && (s.startsWith('02') || s.startsWith('03'))) {
		try {
			const point = secp.Point.fromHex(Buffer.from(s, 'hex'));
			s = Buffer.from(point.toRawBytes(false)).toString('hex');
		} catch (e) {
			// leave as-is
		}
	}
	// ensure uncompressed 04-prefixed hex
	if (s.length === 130 && s.startsWith('04')) return s;
	if (s.length === 128) return '04' + s;
	return s;
}

export function normalizePublicKeyHex(pub) {
  if (!pub) return null;
  try { return ensureUncompressed(pub); } catch (e) { return strip0x(pub).toLowerCase(); }
}

function deriveKey(shared) {
	// Use a deterministic KDF: take the last 32 bytes of the shared secret
	// (this aligns with many ECIES conventions where the x coordinate is used)
	const sBuf = Buffer.from(shared);
	const last = sBuf.length > 32 ? sBuf.slice(-32) : sBuf;
	const hash = crypto.createHash('sha256').update(last).digest();
	return hash; // 32 bytes key
}

export async function encryptWithPublicKey(pubkeyHex, plaintext) {
	const pubHex = ensureUncompressed(pubkeyHex);
	const pubBuf = hexToUint8(pubHex);
	// ephemeral private key as Uint8Array
	const ephPriv = (secp && secp.utils && typeof secp.utils.randomPrivateKey === 'function') ? secp.utils.randomPrivateKey() : Uint8Array.from(crypto.randomBytes(32));
	const ephPub = secp.getPublicKey(ephPriv, false); // Uint8Array uncompressed

	// shared secret (ECDH)
	const shared = secp.getSharedSecret(ephPriv, pubBuf);
	const key = deriveKey(shared);

	// TESTING: emit detailed values so we can compare producer vs consumer
	if (process && process.env && process.env.TESTING) {
		try {
			appendTestingTrace('ECIES_ENCRYPT_DETAILS', {
				ephPub: uint8ToHex(ephPub),
				shared: Buffer.from(shared).toString('hex'),
				kdf: key.toString('hex')
			});
			console.error('TESTING_ECIES_CREATED ephPub=' + uint8ToHex(ephPub));
			console.error('TESTING_ECIES_CREATED shared=' + Buffer.from(shared).toString('hex'));
			console.error('TESTING_ECIES_CREATED kdf=' + key.toString('hex'));
		} catch (e) {}
	}

	const iv = crypto.randomBytes(12);
	// canonical plaintext bytes (what will be fed into AES-GCM)
	const plaintextBuf = Buffer.from(String(plaintext), 'utf8');
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
	const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
	const tag = cipher.getAuthTag();

	// canonical hex lowercase strings
	const out = {
		iv: iv.toString('hex'),
		ephemPublicKey: uint8ToHex(ephPub),
		ciphertext: ct.toString('hex'),
		mac: tag.toString('hex')
	};
	// In TESTING mode, expose debugging info and trace the encryption
	if (process && process.env && process.env.TESTING) {
		try { 
			out._ephemeralPrivate = uint8ToHex(ephPriv); 
			out._plaintextHex = plaintextBuf.toString('hex');
			appendTestingTrace('ECIES_ENCRYPT_RESULT', {
				ephemeralPrivate: out._ephemeralPrivate,
				plaintextHex: out._plaintextHex,
				resultStructure: Object.keys(out)
			});
		} catch (e) {}
	}
	return out;
}

export async function decryptWithPrivateKey(privkeyHex, encrypted) {
	if (!privkeyHex) throw new Error('private key required');
	const privHex = strip0x(privkeyHex);
	const privBuf = hexToUint8(privHex);

	const enc = typeof encrypted === 'string' ? JSON.parse(encrypted) : encrypted;
	const iv = Buffer.from(strip0x(enc.iv), 'hex');
	let ephemHex = strip0x(enc.ephemPublicKey || enc.ephemPublicKey);
	ephemHex = (ephemHex || '').toLowerCase();
	if (ephemHex.length === 66 && (ephemHex.startsWith('02') || ephemHex.startsWith('03'))) {
		try { ephemHex = uint8ToHex(secp.Point.fromHex(Buffer.from(ephemHex, 'hex')).toRawBytes(false)); } catch (e) {}
	}
	const ephem = hexToUint8(ephemHex);
	const ct = Buffer.from(strip0x(enc.ciphertext), 'hex');
	const tag = Buffer.from(strip0x(enc.mac), 'hex');

	// Deterministic path: compute shared secret, take last 32 bytes, KDF via SHA-256
	try {
		const s = secp.getSharedSecret(privBuf, ephem);
		const key = deriveKey(s);
		if (process && process.env && process.env.TESTING) console.error('TESTING_ECIES_CAND shared=' + Buffer.from(s).toString('hex').slice(0,64) + ' kdf=' + key.toString('hex').slice(0,32));
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
		decipher.setAuthTag(tag);
		const out = Buffer.concat([decipher.update(ct), decipher.final()]);
		if (process && process.env && process.env.TESTING) console.error('TESTING_ECIES_DECRYPT_OK key=' + key.toString('hex').slice(0,16));
		return out.toString('utf8');
	} catch (e) {
		if (process && process.env && process.env.TESTING) console.error('TESTING_ECIES_TRY_FAIL reason=' + (e && e.message ? e.message : e));
		throw new Error('ecies decryption failed');
	}
}

const _default = { encryptWithPublicKey, decryptWithPrivateKey };
export default _default;
