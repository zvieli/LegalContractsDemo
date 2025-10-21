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
    const data = typeof content === 'string' ? content : JSON.stringify(content);
    const buffer = toBuffer(data);

    let cidString = null;
    let size = null;

    // Primary path: unixfsModule.addAll (async iterable)
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
        }
      } catch (e) {
        console.warn('heliaLocal: addAll attempt failed:', e && e.message ? e.message : e);
      }
    }

    // Secondary path: unixfsModule.addBytes (for raw bytes, no filename)
    if (!cidString && unixfsModule && typeof unixfsModule.addBytes === 'function') {
      try {
        const cid = await unixfsModule.addBytes(buffer);
        cidString = cid && cid.toString ? cid.toString() : String(cid || '');
        size = buffer.length;
      } catch (e) {
        console.warn('heliaLocal: addBytes attempt failed:', e && e.message ? e.message : e);
      }
    }

    if (!cidString) {
      throw new Error('heliaLocal: unsupported unixfs module API (no addAll/addBytes succeeded)');
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
    if (unixfsModule && unixfsModule.components && typeof unixfsModule.components.cat === 'function') {
      catSrc = unixfsModule.components.cat(cid);
    } else if (unixfsModule && typeof unixfsModule.cat === 'function') {
      catSrc = unixfsModule.cat(cid);
    } else if (heliaInstance && typeof heliaInstance.cat === 'function') {
      catSrc = heliaInstance.cat(cid);
    } else {
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
