// Load ABI JSON files from the served utils/contracts directory and attach them to window.__ABIS__
export async function loadAbis() {
  if (typeof window === 'undefined' || !window.fetch) return;
  window.__ABIS__ = window.__ABIS__ || {};
  // Load abisIndex.json which maps contractName to ABI file path
  let abisIndex = {};
  try {
    const indexResp = await fetch('/utils/contracts/abisIndex.json');
    if (indexResp.ok) {
      abisIndex = await indexResp.json();
    }
  } catch (e) { void e;
    // fallback: no abisIndex.json, do nothing
    return;
  }

  await Promise.all(Object.entries(abisIndex).map(async ([key, filePath]) => {
    try {
      const resp = await fetch(filePath);
      if (!resp.ok) return;
      const data = await resp.json();
      window.__ABIS__[key] = data;
    } catch (e) { void e;
      // ignore individual failures
    }
  }));
}

export default loadAbis;
