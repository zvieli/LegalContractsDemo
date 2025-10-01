import EthCrypto from 'eth-crypto';
const id = EthCrypto.createIdentity();
console.log('identity publicKey:', id.publicKey);
console.log('publicKey length:', id.publicKey.length);
console.log('startsWith 0x04?', id.publicKey.startsWith('0x04'));
console.log('startsWith 0x?', id.publicKey.startsWith('0x'));
console.log('privateKey:', id.privateKey);
