export async function fetchPinnedRecord(pinId) {
    if (!pinId || String(pinId).trim() === '' || String(pinId) === '0') {
        throw new Error('Invalid pin id');
    }
    const res = await fetch(`http://localhost:8080/pin/${pinId}`);
    if (!res.ok) {
        const body = await res.text().catch(() => null);
        throw new Error(`Failed to fetch pinned record (${res.status})${body ? `: ${body}` : ''}`);
    }
    return await res.json();
}

export async function decryptPinnedRecord(pinId, apiKey) {
    if (!pinId || String(pinId).trim() === '' || String(pinId) === '0') {
        throw new Error('Invalid pin id');
    }
    // Resolve API key: explicit param only. Do not read localStorage to avoid storing keys in browser.
    let key = apiKey || undefined;
    try {
        const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
        // For local development, if no apiKey is provided assume dev-secret so admin decrypt still works when running locally.
        if (!key && (hostname === 'localhost' || hostname === '127.0.0.1')) {
            key = 'dev-secret';
        }
    } catch (_) {}
    const headers = {};
    if (key) headers['X-API-KEY'] = key;
    const res = await fetch(`http://localhost:8080/admin/decrypt/${pinId}`, {
        method: 'POST',
        headers,
    });
    if (!res.ok) {
        const body = await res.text().catch(() => null);
        throw new Error(`Decryption failed (${res.status})${body ? `: ${body}` : ''}`);
    }
    const data = await res.json();
    return data.decrypted;
}

// Client-side AES-GCM helpers using Web Crypto
async function getKeyFromPassphrase(passphrase) {
    const enc = new TextEncoder();
    const passBuf = enc.encode(String(passphrase));
    const hash = await crypto.subtle.digest('SHA-256', passBuf);
    return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptAesGcmClient(plaintext, passphrase) {
    const key = await getKeyFromPassphrase(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext)));
    const ctArr = new Uint8Array(ct);
    return JSON.stringify({ alg: 'aes-gcm', iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...ctArr)) });
}

async function decryptAesGcmClient(encJsonStr, passphrase) {
    let obj = null;
    try { obj = typeof encJsonStr === 'string' ? JSON.parse(encJsonStr) : encJsonStr; } catch (e) { throw new Error('Malformed encrypted payload'); }
    if (!obj || obj.alg !== 'aes-gcm' || !obj.iv || !obj.ct) throw new Error('Unsupported encrypted format');
    const key = await getKeyFromPassphrase(passphrase);
    const iv = Uint8Array.from(atob(obj.iv), c => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(obj.ct), c => c.charCodeAt(0));
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const decStr = new TextDecoder().decode(dec);
    return decStr;
}

/**
 * Perform a signed reveal request. `signer` must be an ethers.js Signer connected to the landlord or tenant account.
 * additionalSignatures: array of { signature } objects when the other party signs offline and the UI collects it.
 */
export async function decryptPinnedRecordWithSignature(pinId, signer, contractAddress, requireBoth = false, additionalSignatures = []) {
    if (!pinId) throw new Error('pinId required');
    if (!signer) throw new Error('signer required');
    if (!contractAddress) throw new Error('contractAddress required');
    // Build EIP-712 typed data for the reveal request with nonce and expiry
    // Build EIP-712 typed data for the reveal request
    const provider = signer.provider || (typeof window !== 'undefined' && window.ethereum ? new (await import('ethers')).providers.Web3Provider(window.ethereum) : null);
    let chainId = 0;
    try { chainId = Number((await provider.getNetwork()).chainId || 0); } catch (_) { chainId = 0; }
    const domain = {
        name: 'PinServerReveal',
        version: '1',
        chainId: chainId,
        verifyingContract: String(contractAddress).toLowerCase()
    };
    const types = {
        Reveal: [
            { name: 'pinId', type: 'string' },
            { name: 'contract', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' }
        ]
    };
    // Create a random nonce and an expiry (e.g., 5 minutes)
    const nonce = Math.floor(Math.random() * 1e9);
    const expiry = Math.floor(Date.now() / 1000) + (60 * 5);
    const value = {
        pinId: String(pinId),
        contract: String(contractAddress).toLowerCase(),
        nonce: nonce,
        expiry: expiry
    };

    // ethers.js Signer exposes _signTypedData; this client requires EIP-712 and will not fallback
    if (typeof signer._signTypedData !== 'function' && typeof signer.signTypedData !== 'function') {
        throw new Error('Connected signer does not support EIP-712 typed data signing. Use a wallet that supports _signTypedData.');
    }
    let signature;
    if (typeof signer._signTypedData === 'function') {
        signature = await signer._signTypedData(domain, types, value);
    } else {
        signature = await signer.signTypedData(domain, types, value);
    }

    const payload = {
        contractAddress: String(contractAddress).toLowerCase(),
        typedData: { domain, types, value },
        signature,
        signatures: additionalSignatures,
        requireBoth
    };

    const res = await fetch(`http://localhost:8080/admin/decrypt/${pinId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => null);
        throw new Error(`Signed decryption failed (${res.status})${body ? `: ${body}` : ''}`);
    }
    const data = await res.json();
    return data.decrypted;
}
