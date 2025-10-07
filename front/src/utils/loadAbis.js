// Load ABI JSON files from the served utils/contracts directory and attach them to window.__ABIS__
export async function loadAbis() {
  if (typeof window === 'undefined' || !window.fetch) return;
  const files = [
    'ContractFactory.json',
    'TemplateRentContract.json',
    'NDATemplate.json',
    'Arbitrator.json',
    'ArbitrationService.json',
    'ArbitrationContractV2.json'
  ];
  const base = '/utils/contracts/';
  window.__ABIS__ = window.__ABIS__ || {};
  await Promise.all(files.map(async (f) => {
    try {
      const resp = await fetch(base + f);
      if (!resp.ok) return;
      const data = await resp.json();
  // map filenames to contract keys
  const key = f.replace('.json', '');
      window.__ABIS__[key] = data;
    } catch (e) {
      // ignore individual failures
    }
  }));
}

export default loadAbis;
