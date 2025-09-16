const { ethers } = require('ethers');

async function main(){
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(rpc);
  const factory = '0x0165878A594ca255338adfa4d48449f69242Eb8F';
  const abi = [{"inputs":[],"name":"getAllContractsCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}];
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData('getAllContractsCount');
  try {
    const res = await provider.send('eth_call', [{ to: factory, from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', data }, 'latest']);
    console.log('call result:', res);
  } catch (e) {
    console.error('call failed:', e && e.message);
    if (e && e.data) console.error('e.data =', e.data);
  }
}

main();
