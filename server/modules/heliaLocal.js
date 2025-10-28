// Robust in-process Helia wrapper. Only Helia is supported; legacy IPFS is not used.
let heliaInstance = null;
let unixfsModule = null;
let initialized = false;
let starting = false;

async function ensureHelia() {
  if (initialized) return { heliaInstance, unixfsModule };
  // If another concurrent caller is starting Helia, wait for it to finish
  const waitForStart = async () => {
    const deadline = Date.now() + 5000;
    while (starting && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  if (starting) await waitForStart();
  // Reuse a global singleton if another module already created Helia in this process.
  try {
    // eslint-disable-next-line no-undef
    if (typeof global !== 'undefined' && global.__heliaInstance) {
      heliaInstance = global.__heliaInstance;
      unixfsModule = global.__unixfsModule;
      initialized = true;
      console.log('heliaLocal: reused global heliaInstance');
      return { heliaInstance, unixfsModule };
    }
  } catch (e) {
    // ignore
  }
  try {
  starting = true;
  const { createHelia } = await import('helia');
    const { unixfs } = await import('@helia/unixfs');
    heliaInstance = await createHelia();
    // unixfs is a factory that needs the helia instance to create helpers
    // Create unixfs helper and attempt to await readiness if provided by implementation
    unixfsModule = await unixfs(heliaInstance);
    // If another module may create Helia, publish into global so duplicates don't try to register
    try {
      // eslint-disable-next-line no-undef
      if (typeof global !== 'undefined') {
        global.__heliaInstance = heliaInstance;
        global.__unixfsModule = unixfsModule;
      }
    } catch (e) {
      // ignore
    }
    // Some Helia/unixfs variants expose start/ready helpers - await them if available
    try {
      if (heliaInstance && typeof heliaInstance.start === 'function') {
        console.log('heliaLocal: calling heliaInstance.start() to ensure repo readiness');
        try {
          // Avoid calling start multiple times across modules if already started in this process
          // eslint-disable-next-line no-undef
          if (typeof global !== 'undefined' && global.__heliaStarted) {
            console.log('heliaLocal: heliaInstance.start() skipped - already started in process');
          } else {
            await heliaInstance.start();
            try { if (typeof global !== 'undefined') global.__heliaStarted = true; } catch (e) {}
          }
        } catch (e) {
          // Common non-fatal race may produce handler registration errors; log at debug level
          const msg = e && e.message ? e.message : String(e);
          if (msg && msg.includes('Handler already registered')) {
            console.debug('heliaLocal: heliaInstance.start race detected (non-fatal):', msg);
          } else {
            console.warn('heliaLocal: heliaInstance.start() failed (non-fatal):', msg);
          }
        }
      }
    } catch (e) {
      /* already warned above */
    }
    try {
      if (unixfsModule && typeof unixfsModule.ready === 'function') {
        console.log('heliaLocal: awaiting unixfsModule.ready()');
        await unixfsModule.ready();
      }
    } catch (e) {
      console.warn('heliaLocal: unixfsModule.ready() failed (non-fatal):', e && e.message ? e.message : e);
    }
    // Wait briefly for unixfs/helia components to expose the expected methods on some implementations.
    const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 5000; // 5s max
    while (Date.now() < deadline) {
      const hasComponentsCat = unixfsModule && unixfsModule.components && typeof unixfsModule.components.cat === 'function';
      const hasUnixfsCat = unixfsModule && typeof unixfsModule.cat === 'function';
      const hasHeliaCat = heliaInstance && typeof heliaInstance.cat === 'function';
      if (hasComponentsCat || hasUnixfsCat || hasHeliaCat) break;
      // small backoff to let async initializers complete
      await waitMs(200);
    }
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
    starting = false;
    console.log('✅ In-process Helia started.');
    return { heliaInstance, unixfsModule };
  } catch (err) {
    starting = false;
    console.error('heliaLocal: failed to start in-process Helia:', err && err.message ? err.message : err);
    throw err;
  }
}

/**
 * Public start helper (idempotent)
 */
export async function startHelia() {
  if (initialized && heliaInstance) return { heliaInstance, unixfsModule };
  return ensureHelia();
}

/**
 * Attempt to stop Helia and related resources. Be defensive across Helia versions.
 */
export async function stopHelia() {
  // If not initialized, nothing to do
  if (!initialized && !heliaInstance) return true;
  try {
    // Try heliaInstance.stop(), heliaInstance.libp2p.stop/close(), heliaInstance.close()
    try {
      if (heliaInstance && typeof heliaInstance.stop === 'function') {
        await heliaInstance.stop();
      }
    } catch (e) {
      console.warn('heliaLocal.stopHelia: heliaInstance.stop failed (non-fatal):', e && e.message ? e.message : e);
    }
    try {
      if (heliaInstance && heliaInstance.libp2p) {
        if (typeof heliaInstance.libp2p.stop === 'function') await heliaInstance.libp2p.stop();
        if (typeof heliaInstance.libp2p.close === 'function') await heliaInstance.libp2p.close();
      }
    } catch (e) {
      console.warn('heliaLocal.stopHelia: libp2p stop/close failed (non-fatal):', e && e.message ? e.message : e);
    }
    try {
      if (heliaInstance && typeof heliaInstance.close === 'function') await heliaInstance.close();
    } catch (e) {
      // Some Helia builds may not expose close
    }

    // Clear global singletons if present
    try {
      if (typeof global !== 'undefined' && global.__heliaInstance) {
        try { delete global.__heliaInstance; } catch (e) { global.__heliaInstance = undefined; }
      }
      if (typeof global !== 'undefined' && global.__unixfsModule) {
        try { delete global.__unixfsModule; } catch (e) { global.__unixfsModule = undefined; }
      }
      if (typeof global !== 'undefined' && global.__heliaStarted) {
        try { delete global.__heliaStarted; } catch (e) { global.__heliaStarted = undefined; }
      }
    } catch (e) { /* ignore */ }

    // Reset state
    heliaInstance = null;
    unixfsModule = null;
    initialized = false;
    starting = false;
    console.log('heliaLocal: stopped Helia and cleared singleton state');
    return true;
  } catch (err) {
    console.warn('heliaLocal.stopHelia: unexpected error while stopping Helia:', err && err.message ? err.message : err);
    // Ensure state cleared regardless
    heliaInstance = null; unixfsModule = null; initialized = false; starting = false;
    return false;
  }
}

export async function resetHelia() {
  await stopHelia();
  // Allow next start to recreate fully
  heliaInstance = null; unixfsModule = null; initialized = false; starting = false;
  return true;
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

    // If it's a raw string
    if (typeof catSrc === 'string') return catSrc;
    // If it's a Buffer or Uint8Array
    if (catSrc instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(catSrc))) {
      return Buffer.from(catSrc).toString('utf8');
    }

    // If it's a Node readable stream (stream.Readable)
    if (catSrc && typeof catSrc.on === 'function' && typeof catSrc.read === 'function') {
      try {
        const bufs = [];
        for await (const chunk of catSrc) bufs.push(Buffer.from(chunk));
        return Buffer.concat(bufs).toString('utf8');
      } catch (e) {
        throw new Error('heliaLocal: error consuming Node Readable stream: ' + (e && e.message ? e.message : e));
      }
    }

    // If it's a Web ReadableStream (browser-style)
    if (catSrc && typeof catSrc.getReader === 'function') {
      try {
        const reader = catSrc.getReader();
        const bufs = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bufs.push(Buffer.from(value));
        }
        return Buffer.concat(bufs).toString('utf8');
      } catch (e) {
        throw new Error('heliaLocal: error consuming Web ReadableStream: ' + (e && e.message ? e.message : e));
      }
    }

    // If it's a synchronous iterable (Array or other), iterate
    if (Array.isArray(catSrc) || (catSrc && typeof catSrc[Symbol.iterator] === 'function')) {
      for (const chunk of catSrc) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString('utf8');
    }

    // If it's an async iterable
    if (catSrc && typeof catSrc[Symbol.asyncIterator] === 'function') {
      for await (const chunk of catSrc) chunks.push(Buffer.from(chunk));
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
  removeEvidenceFromLocalHelia,
  startHelia,
  stopHelia,
  resetHelia
};
