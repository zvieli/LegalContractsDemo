const fetch = global.fetch || require('node-fetch');
const txHash = process.argv[2];
if (!txHash) {
  console.error('Usage: node scripts/findTxAcrossRpcs.cjs <txHash>');
  process.exit(1);
}

const RPCS = {
  ethereum: 'https://cloudflare-eth.com',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org',
  bsc: 'https://bsc-dataseed.binance.org/',
};

async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function find() {
  for (const [name, rpc] of Object.entries(RPCS)) {
    try {
      const tx = await rpcCall(rpc, 'eth_getTransactionByHash', [txHash]);
      if (tx) {
        console.log(`Found on ${name} (RPC ${rpc}):`);
        console.log('  tx.hash:', tx.hash);
        console.log('  from:', tx.from);
        console.log('  to:', tx.to);
        console.log('  value (wei):', tx.value);
        // simple wei->eth formatting
        const wei = BigInt(tx.value || '0x0');
        const ethStr = (wei / 1n).toString();
        const eth = (() => {
          const s = wei.toString();
          const L = s.length;
          if (L <= 18) return '0.' + s.padStart(18, '0').replace(/0+$/,'') || '0';
          const intPart = s.slice(0, L-18);
          const frac = s.slice(L-18).replace(/0+$/,'');
          return frac ? `${intPart}.${frac}` : intPart;
        })();
        console.log('  value (ETH):', eth);
        return;
      }
    } catch (err) {
      // ignore and continue
    }
  }
  console.log('Transaction not found on probed RPCs. It may be on a private/local chain or require an API-key provider.');
}

find();
