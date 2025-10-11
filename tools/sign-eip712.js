import axios from 'axios';
import { ethers } from 'ethers';

async function signTypedDataNode(wallet, domain, types, value) {
  // Prefer ethers v6 Wallet.signTypedData when available
  if (typeof wallet.signTypedData === 'function') {
    return await wallet.signTypedData(domain, types, value);
  }

  // ethers v5/v6 older helper
  if (typeof wallet._signTypedData === 'function') {
    return await wallet._signTypedData(domain, types, value);
  }

  // fallback: construct digest and sign
  try {
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    const hashStruct = ethers.TypedDataEncoder.hash(domain, types, value);
    const digest = ethers.keccak256(ethers.concat(["0x19", "0x01", domainSeparator, hashStruct]));
    // signDigest exists on Signer (ethers v6) or we can use signingKey.signDigest
    if (typeof wallet.signDigest === 'function') {
      return await wallet.signDigest(digest);
    }
    // last resort: use signingKey
    if (wallet._signingKey) {
      const sig = wallet._signingKey().signDigest(digest);
      return ethers.joinSignature(sig);
    }
  } catch (err) {
    throw new Error('Typed data signing not available in this environment: ' + (err && err.message));
  }

  throw new Error('No typed-data signing method available on Wallet');
}

(async ()=>{
  try {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    console.log('Requesting nonce for', address);
    const nres = await axios.get(`http://localhost:3001/api/v7/admin/nonce?address=${encodeURIComponent(address)}`);
    const nj = nres.data;
    console.log('Nonce response:', nj);
    const nonceMessage = nj.nonce;

    const domain = {
      name: 'ArbiTrust',
      version: '1',
      chainId: 31337,
      verifyingContract: '0x0000000000000000000000000000000000000000'
    };
    const types = {
      Login: [
        { name: 'address', type: 'address' },
        { name: 'nonce', type: 'string' }
      ]
    };
    const message = { address, nonce: nonceMessage };

    const wallet = new ethers.Wallet(privateKey);
    const sig = await signTypedDataNode(wallet, domain, types, message);
    console.log('Typed signature:', sig);

    // Local verification to debug server mismatch
    try {
      const localRecovered = ethers.verifyTypedData(domain, types, message, sig);
      console.log('Local recovered:', localRecovered, 'wallet.address:', wallet.address);
    } catch (err) {
      console.error('Local verify error:', err && err.message);
    }

    const vres = await axios.post('http://localhost:3001/api/v7/admin/verify', { address, signature: sig, eip712: true, domain, types, message });
    console.log('Verify response:', vres.data);
  } catch (e) {
    console.error('Error:', e && e.response ? (e.response.data || e.response.statusText) : (e && e.message) || e);
    process.exit(1);
  }
})();
