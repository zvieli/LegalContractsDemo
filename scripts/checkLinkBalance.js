import { ethers } from "hardhat";

// Usage:
//   npx hardhat run scripts/checkLinkBalance.js --network sepolia --address 0xYourAddress
// Or set ADDRESS env var.
// If no address provided it will use first signer.

const LINK_ADDRESS_SEPOLIA = "0x779877A7B0D9E8603169DdbD7836e478b4624789"; // Chainlink LINK token (Sepolia)
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"]; 

async function main() {
  // Hardhat strips unknown positional args; support --address or ADDRESS env.
  let addr = process.env.ADDRESS;
  for (const a of process.argv) {
    if (a.startsWith('--address')) {
      const [, value] = a.split('=');
      if (value) addr = value; // --address=0x...
    } else if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
      // fallback if user passed positional before fix
      addr = a;
    }
  }
  if (!addr) {
    addr = (await ethers.getSigners())[0].address;
  }
  if (!ethers.isAddress(addr)) {
    throw new Error(`Invalid address: ${addr}`);
  }
  console.log(`🔎 Checking LINK balance for ${addr}`);
  const link = new ethers.Contract(LINK_ADDRESS_SEPOLIA, ERC20_ABI, ethers.provider);
  const bal = await link.balanceOf(addr);
  console.log(`Raw: ${bal.toString()}`);
  console.log(`LINK: ${ethers.formatUnits(bal, 18)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
