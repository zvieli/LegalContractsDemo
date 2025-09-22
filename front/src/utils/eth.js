import * as ethers from 'ethers';

export function parseEtherSafe(val) {
  try {
    if (!val) return 0n;
    // If it's a number-like string, parse as ether
    if (typeof val === 'string' && val.includes('.')) return ethers.parseEther(val);
    if (typeof val === 'string' && /^\d+$/.test(val)) return BigInt(val);
    if (typeof val === 'bigint') return val;
    if (typeof val === 'number') return ethers.parseEther(String(val));
    return 0n;
  } catch {
    try { return BigInt(val); } catch { return 0n; }
  }
}

export function formatEtherSafe(val) {
  try {
    if (val === null || val === undefined) return '0';
    if (typeof val === 'string' && /^\d+$/.test(val)) return ethers.formatEther(BigInt(val));
    return ethers.formatEther(val);
  } catch {
    try { return String(val); } catch { return '0'; }
  }
}

export default { parseEtherSafe, formatEtherSafe };
