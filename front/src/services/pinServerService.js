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
    // Resolve API key: explicit param -> localStorage -> dev fallback for localhost
    let key = apiKey || (typeof localStorage !== 'undefined' ? localStorage.PIN_SERVER_API_KEY : undefined);
    try {
        const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
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
