const axios = require('axios');
const { ethers } = require('ethers');

(async ()=>{
  try {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    console.log('Requesting nonce for', address);
  const nres = await axios.get(`http://localhost:3001/api/v7/admin/nonce?address=${encodeURIComponent(address)}`);
  const nj = nres.data;
    console.log('Nonce response:', nj);
    const message = nj.message;
    const wallet = new ethers.Wallet(privateKey);
    const sig = await wallet.signMessage(message);
    console.log('Signature:', sig);
  const vres = await axios.post('http://localhost:3001/api/v7/admin/verify', { address, signature: sig });
  const vj = vres.data;
    console.log('Verify response:', vj);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
