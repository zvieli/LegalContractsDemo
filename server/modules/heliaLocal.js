// Robust in-process Helia wrapper. Only Helia is supported; legacy IPFS is not used.
let heliaInstance = null;
let unixfsModule = null;
let initialized = false;

async function ensureHelia() {
  if (initialized) return { heliaInstance, unixfsModule };
  try {
    const { createHelia } = await import('helia');
    const { unixfs } = await import('@helia/unixfs');
    heliaInstance = await createHelia();
    // unixfs is a factory that needs the helia instance to create helpers
    unixfsModule = unixfs(heliaInstance);
    try {
      const keys = Object.keys(unixfsModule || {});
      console.log('heliaLocal: unixfsModule keys ->', keys.join(', '));
      console.log('heliaLocal: unixfsModule.add typeof ->', typeof (unixfsModule && unixfsModule.add));
      console.log('heliaLocal: unixfsModule.components typeof ->', typeof (unixfsModule && unixfsModule.components));
      if (unixfsModule && unixfsModule.components) {
        console.log('heliaLocal: unixfsModule.components.addAll typeof ->', typeof unixfsModule.components.addAll);
        console.log('heliaLocal: unixfsModule.components.cat typeof ->', typeof unixfsModule.components.cat);
      }
    } catch (e) {
      // ignore
    }
    initialized = true;
    console.log('✅ In-process Helia started.');
    return { heliaInstance, unixfsModule };
  } catch (err) {
    console.error('heliaLocal: failed to start in-process Helia:', err && err.message ? err.message : err);
    throw err;
  }
}

function toBuffer(data) {
  if (typeof Buffer !== 'undefined') return Buffer.from(data);
  return new Uint8Array(new TextEncoder().encode(data));
}

export async function addEvidenceToLocalHelia(content, filename = 'evidence.json') {
  await ensureHelia();
  try {
    // Safely stringify content to handle BigInt and other non-serializable types
    const safeStringify = (v) => {
      try {
        return JSON.stringify(v);
      } catch (e) {
        // Fallback: convert BigInt to string and retry
        try {
          return JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? val.toString() : val));
        } catch (e2) {
          // Last resort: coerce to string
          return String(v);
        }
      }
    };
    const data = typeof content === 'string' ? content : safeStringify(content);
    const buffer = toBuffer(data);

    let cidString = null;
    let size = null;

    // Try multiple possible API shapes to maximize compatibility across Helia/unixfs versions
    const tryLog = (msg) => console.log('heliaLocal: addEvidence ->', msg);

    tryLog('available unixfsModule keys -> ' + Object.keys(unixfsModule || {}).join(', '));
    tryLog('available heliaInstance keys -> ' + Object.keys(heliaInstance || {}).join(', '));

    // 1) unixfsModule.addAll (async iterable with entries)
    if (unixfsModule && typeof unixfsModule.addAll === 'function') {
      try {
        const addResult = unixfsModule.addAll([
          { path: filename, content: buffer }
        ]);
        let last = null;
        for await (const entry of addResult) {
          last = entry;
        }
        if (last) {
          cidString = last.cid && last.cid.toString ? last.cid.toString() : String(last.cid || last.hash || last || '');
          size = last.size ?? buffer.length;
          tryLog('used unixfsModule.addAll');
        }
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.addAll failed:', e && e.message ? e.message : e);
      }
    }

    // 2) unixfsModule.add (some versions expose add)
    if (!cidString && unixfsModule && typeof unixfsModule.add === 'function') {
      try {
        const out = await unixfsModule.add({ path: filename, content: buffer });
        if (out) {
          cidString = out.cid && out.cid.toString ? out.cid.toString() : String(out.cid || out.hash || out || '');
          size = out.size ?? buffer.length;
          tryLog('used unixfsModule.add');
        }
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.add failed:', e && e.message ? e.message : e);
      }
    }

    // 3) unixfsModule.addBytes / components.addBytes
    if (!cidString && unixfsModule && typeof unixfsModule.addBytes === 'function') {
      try {
        const cid = await unixfsModule.addBytes(buffer);
        cidString = cid && cid.toString ? cid.toString() : String(cid || '');
        size = buffer.length;
        tryLog('used unixfsModule.addBytes');
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.addBytes failed:', e && e.message ? e.message : e);
      }
    }

    if (!cidString && unixfsModule && unixfsModule.components && typeof unixfsModule.components.addBytes === 'function') {
      try {
        const cid = await unixfsModule.components.addBytes(buffer);
        cidString = cid && cid.toString ? cid.toString() : String(cid || '');
        size = buffer.length;
        tryLog('used unixfsModule.components.addBytes');
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.components.addBytes failed:', e && e.message ? e.message : e);
      }
    }

    // 4) components.addAll shape
    if (!cidString && unixfsModule && unixfsModule.components && typeof unixfsModule.components.addAll === 'function') {
      try {
        const addResult = unixfsModule.components.addAll([{ path: filename, content: buffer }]);
        let last = null;
        for await (const entry of addResult) last = entry;
        if (last) {
          cidString = last.cid && last.cid.toString ? last.cid.toString() : String(last.cid || last.hash || last || '');
          size = last.size ?? buffer.length;
          tryLog('used unixfsModule.components.addAll');
        }
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.components.addAll failed:', e && e.message ? e.message : e);
      }
    }

    // 5) heliaInstance.add (some helia builds expose add directly)
    if (!cidString && heliaInstance && typeof heliaInstance.add === 'function') {
      try {
        const out = await heliaInstance.add(buffer);
        // heliaInstance.add may return a CID or an object
        cidString = out && out.toString ? out.toString() : (out && out.cid && out.cid.toString ? out.cid.toString() : String(out || ''));
        size = buffer.length;
        tryLog('used heliaInstance.add');
      } catch (e) {
        console.warn('heliaLocal: heliaInstance.add failed:', e && e.message ? e.message : e);
      }
    }

    // 6) heliaInstance.block.put as last resort
    if (!cidString && heliaInstance && heliaInstance.block && typeof heliaInstance.block.put === 'function') {
      try {
        const blk = await heliaInstance.block.put(buffer);
        cidString = blk && blk.cid && blk.cid.toString ? blk.cid.toString() : String(blk || '');
        size = buffer.length;
        tryLog('used heliaInstance.block.put');
      } catch (e) {
        console.warn('heliaLocal: heliaInstance.block.put failed:', e && e.message ? e.message : e);
      }
    }

    if (!cidString) {
      // As a last resort, fail fast and log the available shapes to help debugging
      console.error('heliaLocal: no compatible add API found. unixfsModule keys:', Object.keys(unixfsModule || {}));
      console.error('heliaLocal: unixfsModule.components keys:', Object.keys((unixfsModule && unixfsModule.components) || {}));
      console.error('heliaLocal: heliaInstance keys:', Object.keys(heliaInstance || {}));
      throw new Error('heliaLocal: unsupported unixfs/helia API (no add variant succeeded)');
    }

    // Ensure size is serializable (convert BigInt -> Number)
    if (typeof size === 'bigint') {
      try { size = Number(size); } catch (e) { size = String(size); }
    }

    return { cid: cidString, size };
  } catch (err) {
    console.error('heliaLocal.addEvidenceToLocalHelia error:', err && err.message ? err.message : err);
    throw err;
  }
}

export async function getEvidenceFromLocalHelia(cid) {
  await ensureHelia();
  try {
    const chunks = [];
    let catSrc = null;
    const tryLog = (m) => console.log('heliaLocal: getEvidence ->', m);

    // Try several cat variants, prefer components.cat, then unixfsModule.cat, then heliaInstance.cat
    if (unixfsModule && unixfsModule.components && typeof unixfsModule.components.cat === 'function') {
      tryLog('using unixfsModule.components.cat');
      catSrc = unixfsModule.components.cat(cid);
    }
    if (!catSrc && unixfsModule && typeof unixfsModule.cat === 'function') {
      tryLog('using unixfsModule.cat');
      catSrc = unixfsModule.cat(cid);
    }
    if (!catSrc && heliaInstance && typeof heliaInstance.cat === 'function') {
      tryLog('using heliaInstance.cat');
      catSrc = heliaInstance.cat(cid);
    }
    if (!catSrc && heliaInstance && heliaInstance.components && typeof heliaInstance.components.cat === 'function') {
      tryLog('using heliaInstance.components.cat');
      catSrc = heliaInstance.components.cat(cid);
    }
    if (!catSrc) {
      console.error('heliaLocal: no cat implementation available. unixfsModule keys:', Object.keys(unixfsModule || {}));
      console.error('heliaLocal: heliaInstance keys:', Object.keys(heliaInstance || {}));
      throw new Error('heliaLocal: no cat implementation available on unixfsModule or heliaInstance');
    }

    // catSrc may be an async iterable, a sync iterable, a Promise that resolves to one of those,
    // or even a Buffer/string in some runtime variants. Handle all cases defensively.
    if (catSrc == null) {
      throw new Error('heliaLocal: cat returned null/undefined for cid ' + cid);
    }

    // If it's a Promise, await it
    if (typeof catSrc.then === 'function') {
      try {
        catSrc = await catSrc;
      } catch (e) {
        throw new Error('heliaLocal: cat promise rejected: ' + (e && e.message ? e.message : String(e)));
      }
    }

    // If it's a raw Buffer / Uint8Array, return directly
    if (typeof catSrc === 'string') {
      return catSrc;
    }
    if (catSrc instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(catSrc))) {
      return Buffer.from(catSrc).toString('utf8');
    }

    // If it's a synchronous iterable (Array or other), iterate
    if (Array.isArray(catSrc) || typeof catSrc[Symbol.iterator] === 'function') {
      for (const chunk of catSrc) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    }

    // If it's an async iterable
    if (typeof catSrc[Symbol.asyncIterator] === 'function') {
      for await (const chunk of catSrc) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    }

    // Unknown shape
    console.error('heliaLocal.getEvidenceFromLocalHelia: unsupported cat result shape:', typeof catSrc, catSrc && catSrc.constructor && catSrc.constructor.name);
    throw new Error('heliaLocal: unsupported cat result shape');
  } catch (err) {
    console.error('heliaLocal.getEvidenceFromLocalHelia error:', err && err.message ? err.message : err);
    throw err;
  }
}

export async function removeEvidenceFromLocalHelia(cid) {
  await ensureHelia();
  try {
    // Best-effort: call repo.gc if available
    try {
      if (heliaInstance && heliaInstance.repo && typeof heliaInstance.repo.gc === 'function') {
        await heliaInstance.repo.gc();
      }
    } catch (e) {
      // non-fatal
    }
    return { removed: true };
  } catch (err) {
    console.error('heliaLocal.removeEvidenceFromLocalHelia error:', err && err.message ? err.message : err);
    throw err;
  }
}

export default {
  addEvidenceToLocalHelia,
  getEvidenceFromLocalHelia,
  removeEvidenceFromLocalHelia
};
