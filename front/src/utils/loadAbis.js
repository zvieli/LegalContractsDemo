// Load ABI JSON files from the served utils/contracts directory and attach them to window.__ABIS__
export async function loadAbis() {
  if (typeof window === 'undefined' || !window.fetch) return;
  const files = [
    'ContractFactoryABI.json',
    'TemplateRentContractABI.json',
    'NDATemplateABI.json',
    'ArbitratorABI.json',
    'ArbitrationServiceABI.json'
  ];
  const base = '/utils/contracts/';
  window.__ABIS__ = window.__ABIS__ || {};
  await Promise.all(files.map(async (f) => {
    try {
      const resp = await fetch(base + f);
      if (!resp.ok) return;
      const data = await resp.json();
      // map filenames to contract keys
      const key = f.replace('ABI.json', '');
      window.__ABIS__[key] = data;
    } catch (e) {
      // ignore individual failures
    }
  }));
}

export default loadAbis;
