// Re-export the helia service implementation used by the server.
// Previous versions attempted to re-export from a non-existent top-level module which caused
// Node to fail resolving the module. Point this module to the local helia service implementation.
// Re-export the helia service implementation used by the server.
// Provide a small compatibility shim for tests that expect a `removeEvidenceFromHelia` helper.
import * as heliaSvc from './helia/heliaService.js';
export * from './helia/heliaService.js';

// Try to remove evidence via available helia service if implemented, otherwise attempt a best-effort HTTP call.
export async function removeEvidenceFromHelia(cid, heliaApi = process.env.HELIADB_API || 'http://127.0.0.1:5001') {
	// If the underlying service exposes this helper, delegate to it
	if (heliaSvc && typeof heliaSvc.removeEvidenceFromHelia === 'function') {
		return heliaSvc.removeEvidenceFromHelia(cid, heliaApi);
	}

	// Best-effort HTTP removal: many Helia/IPFS HTTP APIs support block/rm or pin/rm endpoints.
	// This is intentionally tolerant: tests mock this function, and production deployments should
	// provide a proper implementation if they rely on remote HTTP removal.
	try {
		let fetchFn = global.fetch;
		if (typeof fetchFn !== 'function') {
			// lazy-load node-fetch for older node versions
			try { fetchFn = (await import('node-fetch')).default; } catch (e) { fetchFn = null; }
		}
		if (!fetchFn) return { removed: false };

		// Attempt pin/rm (best-effort). Some Helia builds may not expose this endpoint; ignore failures.
		const url = heliaApi.replace(/\/$/, '') + '/api/v0/pin/rm?arg=' + encodeURIComponent(cid);
				// Apply a short timeout so tests and dev flows don't hang if no Helia HTTP API is present
				const timeoutMs = Number(process.env.HELIA_REMOVE_TIMEOUT_MS || 2000);
				let controller = null; let signal = undefined;
				try {
					const AbortController = global.AbortController || (await import('abort-controller')).default;
					controller = new AbortController();
					signal = controller.signal;
				} catch (e) { /* ignore - some runtimes already provide AbortController */ }
				const fetchOpts = { method: 'POST' };
				if (signal) fetchOpts.signal = signal;
				const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
				let resp;
				try {
					resp = await fetchFn(url, fetchOpts);
				} finally {
					if (timer) clearTimeout(timer);
				}
		if (!resp || !resp.ok) return { removed: false };
		try {
			const body = await resp.json();
			return { removed: true, body };
		} catch (e) {
			return { removed: true };
		}
	} catch (e) {
		return { removed: false, error: e.message || String(e) };
	}
}

export default heliaSvc;
