import fs from 'fs';
import path from 'path';

export interface Wallet {
  address: string;
  privateKey: string;
}

export function readWallets(): Wallet[] {
  const walletsPath = path.resolve(__dirname, '../../../WALLETS.txt');
  const content = fs.readFileSync(walletsPath, 'utf-8');
  const lines = content.split('\n');
  const wallets: Wallet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const addrMatch = lines[i].match(/Account #[0-9]+: (0x[a-fA-F0-9]{40})/);
    const pkMatch = lines[i+1]?.match(/Private Key: (0x[a-fA-F0-9]{64})/);
    if (addrMatch && pkMatch) {
      wallets.push({ address: addrMatch[1], privateKey: pkMatch[1] });
    }
  }
  return wallets;
}
