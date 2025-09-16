const { ethers } = require('ethers');

async function main(){
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(rpc);
  const factory = '0x0165878A594ca255338adfa4d48449f69242Eb8F';
  const abi = [{"inputs":[{"internalType":"address","name":"_tenant","type":"address"},{"internalType":"uint256","name":"_rentAmount","type":"uint256"},{"internalType":"address","name":"_priceFeed","type":"address"},{"internalType":"uint256","name":"_propertyId","type":"uint256"}],"name":"createRentContract","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"nonpayable","type":"function"}];
  const iface = new ethers.Interface(abi);
  // Use invalid priceFeed (zero) so factory reverts with ZeroPriceFeed custom error
  const data = iface.encodeFunctionData('createRentContract', ['0x0000000000000000000000000000000000000001', 0n, '0x0000000000000000000000000000000000000000', 0n]);
  try {
    const res = await provider.send('eth_call', [{ to: factory, from: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', data }, 'latest']);
    console.log('call result:', res);
  } catch (e) {
    console.error('call failed message:', e && e.message);
    if (e && e.data) console.error('e.data =', e.data);
  }
}

main();
