import { ethers } from 'ethers';

/**
 * Safe wrappers around provider/contract event and query helpers.
 * These guard against provider/library edge-cases that throw (e.g. malformed
 * results from subscriber internals) so the server stays up during tests.
 */

export async function safeQueryFilter(target, filter, fromBlock = null, toBlock = 'latest') {
  try {
    if (!target) return [];

    // Contract instance (has queryFilter)
    if (typeof target.queryFilter === 'function') {
      return await target.queryFilter(filter, fromBlock, toBlock);
    }

    // Provider instance (ethers provider has queryFilter/getLogs)
    if (typeof target.queryFilter === 'function') {
      return await target.queryFilter(filter, fromBlock, toBlock);
    }

    if (typeof target.getLogs === 'function') {
      // normalize filter to object
      const base = (typeof filter === 'object') ? filter : { topics: filter };
      const q = { ...base };
      if (fromBlock !== null) q.fromBlock = fromBlock;
      if (typeof toBlock !== 'undefined' && toBlock !== null) q.toBlock = toBlock;
      return await target.getLogs(q);
    }

    return [];
  } catch (err) {
    try {
      console.warn('[providerSafe] safeQueryFilter error:', err && err.message ? err.message : err);
    } catch (e) {}
    return [];
  }
}

export function safeOn(target, eventNameOrFilter, handler) {
  if (!target || typeof target.on !== 'function') return null;

  const wrapped = (...args) => {
    try {
      const res = handler(...args);
      // If handler returns a promise, ensure we catch rejections to avoid unhandled rejections
      if (res && typeof res.then === 'function' && typeof res.catch === 'function') {
        res.catch(err => {
          try { console.error('[providerSafe] handler async error:', err && err.message ? err.message : err); } catch (e) {}
        });
      }
    } catch (err) {
      try { console.error('[providerSafe] handler sync error:', err && err.message ? err.message : err); } catch (e) {}
    }
  };

  try {
    target.on(eventNameOrFilter, wrapped);
  } catch (err) {
    try { console.warn('[providerSafe] failed to attach listener:', err && err.message ? err.message : err); } catch (e) {}
    return null;
  }

  // return an unsubscribe function
  return () => {
    try { target.off(eventNameOrFilter, wrapped); } catch (e) {}
  };
}

export async function safeGetLogs(provider, filterObj) {
  try {
    if (!provider || typeof provider.getLogs !== 'function') return [];
    return await provider.getLogs(filterObj);
  } catch (err) {
    try { console.warn('[providerSafe] safeGetLogs error:', err && err.message ? err.message : err); } catch (e) {}
    return [];
  }
}

export default { safeQueryFilter, safeOn, safeGetLogs };
