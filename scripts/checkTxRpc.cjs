const RPC = process.env.ETH_RPC || 'https://cloudflare-eth.com';
const txHash = process.argv[2];
if (!txHash) {
  console.error('Usage: node scripts/checkTxRpc.cjs <txHash>');
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!res.ok) throw new Error(`RPC error: ${res.status} ${res.statusText}`);
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

function formatWeiToEthString(weiHex) {
  if (!weiHex) return '0';
  const wei = BigInt(weiHex);
  const s = wei.toString();
  const L = s.length;
  if (L <= 18) {
    const frac = s.padStart(18, '0').replace(/0+$/,'');
    return frac ? `0.${frac}` : '0';
  }
  const intPart = s.slice(0, L - 18);
  let fracPart = s.slice(L - 18).replace(/0+$/,'');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

(async () => {
  try {
    const tx = await rpc('eth_getTransactionByHash', [txHash]);
    if (!tx) return console.error('Transaction not found');
    console.log('txHash:', tx.hash);
    console.log('from:', tx.from);
    console.log('to:', tx.to);
    console.log('value (hex wei):', tx.value);
    console.log('value (ETH):', formatWeiToEthString(tx.value));
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
