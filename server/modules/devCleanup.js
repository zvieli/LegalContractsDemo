import heliaStore from './heliaStore.js';

export async function cleanupCIDs(cids = [], options = {}) {
  const results = {};
  for (const cid of cids) {
    try {
      const removed = await heliaStore.removeEvidenceFromHelia(cid, options.heliaApi);
      results[cid] = { removedFromHelia: removed };
    } catch (err) {
      results[cid] = { error: err.message || String(err) };
    }
  }
  return results;
}

export default { cleanupCIDs };
