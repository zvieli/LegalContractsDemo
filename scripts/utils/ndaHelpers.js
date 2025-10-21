import { ethers } from 'ethers';

export async function signTypedDataNode(wallet, domain, types, value) {
  if (typeof wallet.signTypedData === 'function') return await wallet.signTypedData(domain, types, value);
  if (typeof wallet._signTypedData === 'function') return await wallet._signTypedData(domain, types, value);
  try {
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    const hashStruct = ethers.TypedDataEncoder.hash(domain, types, value);
    const digest = ethers.keccak256(ethers.concat(["0x19", "0x01", domainSeparator, hashStruct]));
    if (typeof wallet.signDigest === 'function') return await wallet.signDigest(digest);
    if (wallet._signingKey) {
      const sig = wallet._signingKey().signDigest(digest);
      return ethers.joinSignature(sig);
    }
  } catch (err) {
    throw new Error('Typed data signing not available: ' + (err && err.message));
  }
  throw new Error('No typed-data signing method available on Wallet');
}

export async function ensureSigned(ndaContract, signer, domain, types, value, opts={debug:false}){
  const addr = await signer.getAddress();
  // check signedBy mapping via hasDeposited/signed mapping
  let already = false;
  try { if (typeof ndaContract.signedBy === 'function') already = await ndaContract.signedBy(addr); } catch(e){}
  if (already) {
    if (opts.debug) console.log('ensureSigned: already signed', addr);
    return { already: true };
  }
  const sig = await signTypedDataNode(signer, domain, types, value);
  if (opts.debug) console.log('ensureSigned: signature for', addr, sig.slice(0,8)+'...');
  const withSigner = ndaContract.connect(signer);
  try {
    const tx = await withSigner.signNDA(sig);
    const receipt = await tx.wait();
    return { already:false, txHash: tx.hash, status: receipt.status };
  } catch (e) {
    const msg = e && (e.reason || e.message || '');
    if (/already signed/i.test(msg)) {
      if (opts.debug) console.log('ensureSigned: already signed (caught)', addr);
      return { already: true };
    }
    throw e;
  }
}

export async function ensureDeposit(ndaContract, signer, minDeposit, opts={debug:false}){
  const addr = await signer.getAddress();
  let current = 0n;
  try { current = BigInt((await ndaContract.deposits(addr)).toString()); } catch(e){}
  if (current >= BigInt(minDeposit) && BigInt(minDeposit) > 0n) {
    if (opts.debug) console.log('ensureDeposit: already deposited', addr, String(current));
    return { already:true, deposited: current };
  }
  if (BigInt(minDeposit) === 0n) return { already:true, deposited: current };
  const withSigner = ndaContract.connect(signer);
  const tx = await withSigner.deposit({ value: BigInt(minDeposit) });
  const receipt = await tx.wait();
  return { already:false, txHash: tx.hash, status: receipt.status };
}
import { ethers } from 'ethers';

export async function signTypedDataNode(wallet, domain, types, value) {
  if (typeof wallet.signTypedData === 'function') return await wallet.signTypedData(domain, types, value);
  if (typeof wallet._signTypedData === 'function') return await wallet._signTypedData(domain, types, value);
  try {
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    const hashStruct = ethers.TypedDataEncoder.hash(domain, types, value);
    const digest = ethers.keccak256(ethers.concat(['0x19', '0x01', domainSeparator, hashStruct]));
    if (typeof wallet.signDigest === 'function') return await wallet.signDigest(digest);
    if (wallet._signingKey) {
      const sig = wallet._signingKey().signDigest(digest);
      return ethers.joinSignature(sig);
    }
  } catch (err) {
    throw new Error('Typed data signing not available: ' + (err && err.message));
  }
  throw new Error('No typed-data signing method available on Wallet');
}

export async function ensureSigned(ndaContract, signer, domain, types, value, opts = { debug: false }) {
  const addr = await signer.getAddress();
  let already = false;
  try { if (typeof ndaContract.signedBy === 'function') already = await ndaContract.signedBy(addr); } catch (e) {}
  if (already) {
    if (opts.debug) console.log('ensureSigned: already signed', addr);
    return { already: true };
  }
  const sig = await signTypedDataNode(signer, domain, types, value);
  if (opts.debug) console.log('ensureSigned: signature for', addr, sig.slice(0, 8) + '...');
  const withSigner = ndaContract.connect(signer);
  try {
    const tx = await withSigner.signNDA(sig);
    const receipt = await tx.wait();
    return { already: false, txHash: tx.hash, status: receipt.status };
  } catch (e) {
    const msg = e && (e.reason || e.message || '');
    if (/already signed/i.test(msg)) {
      if (opts.debug) console.log('ensureSigned: already signed (caught)', addr);
      return { already: true };
    }
    throw e;
  }
}

export async function ensureDeposit(ndaContract, signer, minDeposit, opts = { debug: false }) {
  const addr = await signer.getAddress();
  let current = 0n;
  try { current = BigInt((await ndaContract.deposits(addr)).toString()); } catch (e) {}
  if (current >= BigInt(minDeposit) && BigInt(minDeposit) > 0n) {
    if (opts.debug) console.log('ensureDeposit: already deposited', addr, String(current));
    return { already: true, deposited: current };
  }
  if (BigInt(minDeposit) === 0n) return { already: true, deposited: current };
  const withSigner = ndaContract.connect(signer);
  const tx = await withSigner.deposit({ value: BigInt(minDeposit) });
  const receipt = await tx.wait();
  return { already: false, txHash: tx.hash, status: receipt.status };
}
