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

    const comps = unixfsModule && unixfsModule.components ? unixfsModule.components : null;
    let cidString = null;
    let size = null;

    // Primary path: components.addAll (often an async iterable)
    if (comps && typeof comps.addAll === 'function') {
      try {
        const addResult = comps.addAll([{ path: filename, content: buffer }]);
        let last = null;
        if (addResult && typeof addResult[Symbol.asyncIterator] === 'function') {
          for await (const entry of addResult) {
            last = entry;
          }
        } else if (Array.isArray(addResult)) {
          last = addResult[addResult.length - 1];
        } else if (addResult && typeof addResult.then === 'function') {
          const resolved = await addResult;
          if (Array.isArray(resolved)) last = resolved[resolved.length - 1];
          else last = resolved;
        } else {
          last = addResult;
        }
        if (last) {
          cidString = last.cid && last.cid.toString ? last.cid.toString() : String(last.cid || last.hash || '');
          size = last.size ?? buffer.length;
        }
      } catch (e) {
        console.warn('heliaLocal: components.addAll attempt failed:', e && e.message ? e.message : e);
      }
    }

    // Secondary path: components.add
    if (!cidString && comps && typeof comps.add === 'function') {
      try {
        const added = await comps.add({ path: filename, content: buffer });
        const last = Array.isArray(added) ? added[added.length - 1] : added;
        cidString = last.cid && last.cid.toString ? last.cid.toString() : String(last.cid || last.hash || '');
        size = last.size ?? buffer.length;
      } catch (e) {
        console.warn('heliaLocal: components.add attempt failed:', e && e.message ? e.message : e);
      }
    }

    // Tertiary path: unixfsModule.write (some runtimes expose a write helper)
    if (!cidString && unixfsModule && typeof unixfsModule.write === 'function') {
      try {
        const c = await unixfsModule.write(filename, buffer);
        cidString = c && c.toString ? c.toString() : String(c || '');
        size = buffer.length;
      } catch (e) {
        console.warn('heliaLocal: unixfsModule.write attempt failed:', e && e.message ? e.message : e);
      }
    }

    // Quaternary fallback: heliaInstance.add (if exposed)
    if (!cidString && heliaInstance && typeof heliaInstance.add === 'function') {
      try {
        const added = await heliaInstance.add(buffer);
        const last = Array.isArray(added) ? added[added.length - 1] : added;
        cidString = last.cid && last.cid.toString ? last.cid.toString() : String(last.cid || last.hash || '');
        size = last.size ?? buffer.length;
      } catch (e) {
        console.warn('heliaLocal: heliaInstance.add attempt failed:', e && e.message ? e.message : e);
      }
    }

    if (!cidString) {
      throw new Error('heliaLocal: unsupported unixfs module API (no add/addAll/write succeeded)');
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

    for await (const chunk of catSrc) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
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
