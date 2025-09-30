import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function looksLikeHexString(s) {
  return typeof s === 'string' && /^0x[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}

function tryHexToAscii(hex) {
  try {
    const buf = Buffer.from(hex.slice(2), 'hex');
    const str = buf.toString('utf8');
    if (/\p{C}/u.test(str)) {
      return null;
    }
    return str;
  } catch (e) {
    return null;
  }
}

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error('Usage: node scripts/decodeReceipt.js <txHash>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');

  const tx = await provider.getTransaction(txHash);
  const r = await provider.getTransactionReceipt(txHash);

  if (!tx || !r) {
    console.error('Transaction or receipt not found on http://127.0.0.1:8545');
    process.exit(1);
  }

  console.log('Function selector:', tx.data.slice(0, 10));

  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'Rent', 'TemplateRentContract.sol', 'TemplateRentContract.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact not found at', artifactPath);
    process.exit(1);
  }
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const iface = new ethers.Interface(art.abi);

  console.log('\n=== Transaction ===');
  const selector = tx.data.slice(0, 10);
  let fnMatched = false;
  for (const fragment of iface.fragments) {
    if (fragment.type === 'function') {
      try {
        const sig = iface.getSighash(fragment);
        if (sig === selector) {
          fnMatched = true;
          const decoded = iface.decodeFunctionData(fragment, tx.data);
          console.log('Function:', fragment.name);
          console.log('Args:');
          fragment.inputs.forEach((input, idx) => {
            let v = decoded[idx];
            let out = v;
            if (typeof v === 'bigint') out = v.toString();
            if (looksLikeHexString(String(v))) {
              const ascii = tryHexToAscii(String(v));
              if (ascii) out = `${v}  (ascii: ${ascii})`;
            }
            console.log(`  - ${input.name} (${input.type}):`, out);
          });
          break;
        }
      } catch (e) {}
    }
  }
  if (!fnMatched) console.log('Could not match function selector', selector, 'to any ABI function');

  console.log('\n=== Events ===');
  if (!r.logs || r.logs.length === 0) {
    console.log('No logs');
    return;
  }

  for (let i = 0; i < r.logs.length; i++) {
    const log = r.logs[i];
    let matched = false;
    for (const fragment of iface.fragments) {
      if (fragment.type === 'event') {
        try {
          const topic = iface.getEventTopic(fragment);
          if (topic === log.topics[0]) {
            matched = true;
            const decoded = iface.decodeEventLog(fragment, log.data, log.topics);
            console.log(`\nEvent #${i}: ${fragment.name}`);
            fragment.inputs.forEach((input, idx) => {
              let v = decoded[input.name];
              let out = v;
              if (typeof v === 'bigint') out = v.toString();
              if (looksLikeHexString(String(v))) {
                const ascii = tryHexToAscii(String(v));
                if (ascii) out = `${v}  (ascii: ${ascii})`;
              }
              console.log(`  - ${input.name} (${input.type}):`, out);
            });
            break;
          }
        } catch (e) {}
      }
    }
    if (!matched) {
      console.log(`\nEvent #${i}: (unrecognized by TemplateRentContract ABI)`);
      console.log('  address:', log.address);
      console.log('  topics:', JSON.stringify(log.topics));
      console.log('  data:', log.data);
      if (looksLikeHexString(log.data)) {
        const ascii = tryHexToAscii(log.data);
        if (ascii) console.log('  data ascii:', ascii);
        else {
          try {
            const payload = '0x' + log.data.slice(2).slice(64*2);
            const maybe = tryHexToAscii(payload);
            if (maybe) console.log('  embedded ascii (fallback):', maybe);
          } catch (e) {}
        }
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
