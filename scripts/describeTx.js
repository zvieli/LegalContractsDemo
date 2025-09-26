// ESM script: describe a transaction receipt and decode logs using known ABIs
// Usage: npx hardhat run scripts/describeTx.js --network localhost <txHash>

const hardhatModule = await import('hardhat');
const hre = hardhatModule.default ?? hardhatModule;
const { ethers } = hre;
const fs = await import('fs');
const path = await import('path');

async function loadAbiFromFront(name) {
  const p = path.resolve(process.cwd(), 'front', 'public', 'utils', 'contracts', name);
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function main() {
  const tx = process.argv[2] || process.env.TX_HASH;
  if (!tx) {
    console.error('Usage: npx hardhat run scripts/describeTx.js --network localhost <txHash>');
    process.exit(1);
  }

  const provider = ethers.provider;
  console.log('Fetching receipt for', tx);
  const receipt = await provider.getTransactionReceipt(tx);
  if (!receipt) {
    console.error('No receipt found for', tx);
    process.exit(1);
  }

  console.log('Transaction:', tx);
  console.log('BlockNumber:', receipt.blockNumber);
  console.log('From:', receipt.from);
  console.log('To:', receipt.to);
  console.log('Status:', receipt.status);
  console.log('GasUsed:', receipt.gasUsed?.toString());
  console.log('Logs count:', receipt.logs.length);

  // Load known ABIs
  const templateAbiJson = await loadAbiFromFront('TemplateRentContractABI.json');
  const ndaAbiJson = await loadAbiFromFront('NDATemplateABI.json');
  const arbServiceAbiJson = await loadAbiFromFront('ArbitrationServiceABI.json');

  const ifaces = [];
  function normalizeAbi(json) {
    if (!json) return null;
    if (Array.isArray(json)) return json;
    if (json.abi && Array.isArray(json.abi)) return json.abi;
    if (json.default && json.default.abi && Array.isArray(json.default.abi)) return json.default.abi;
    return null;
  }
  const tAbi = normalizeAbi(templateAbiJson);
  const nAbi = normalizeAbi(ndaAbiJson);
  const aAbi = normalizeAbi(arbServiceAbiJson);
  if (tAbi) ifaces.push(new ethers.Interface(tAbi));
  if (nAbi) ifaces.push(new ethers.Interface(nAbi));
  if (aAbi) ifaces.push(new ethers.Interface(aAbi));

  // Also add a small interface for DisputeResolved signature in case ABI mismatch
  const fallbackIface = new ethers.Interface(['event DisputeResolved(uint256 indexed caseId, bool approved, uint256 appliedAmount, address beneficiary)']);

  for (let i = 0; i < receipt.logs.length; i++) {
    const l = receipt.logs[i];
    console.log('\n--- Log', i, '---');
    console.log('address:', l.address);
    console.log('topics:', l.topics);
    console.log('data:', l.data);

    let parsed = null;
    // try known interfaces
    for (const iface of ifaces) {
      try {
        parsed = iface.parseLog(l);
        if (parsed) {
          console.log('parsed by ABI');
          break;
        }
      } catch (e) {
        // ignore
      }
    }
    if (!parsed) {
      try {
        parsed = fallbackIface.parseLog(l);
        if (parsed) {
          console.log('parsed by fallback DisputeResolved signature');
        }
      } catch (e) {
        // nothing
      }
    }

    if (parsed) {
      console.log('event name:', parsed.name);
      console.log('args:');
      const inputs = (parsed.eventFragment && parsed.eventFragment.inputs) ? parsed.eventFragment.inputs : [];
      for (let k = 0; k < parsed.args.length; k++) {
        const key = (inputs[k] && inputs[k].name) ? inputs[k].name : k;
        const val = parsed.args[k];
        // Special-case appliedAmount
        const type = inputs[k] && inputs[k].type ? inputs[k].type : null;
        if (key === 'appliedAmount' || (type === 'uint256' && String(key).toLowerCase().includes('amount'))) {
          try {
            const wei = ethers.BigInt(val.toString());
            const eth = ethers.formatEther(wei);
            console.log(`  ${key}: ${wei.toString()} (wei) = ${eth} ETH`);
          } catch (e) {
            console.log(`  ${key}: ${String(val)}`);
          }
        } else {
          console.log(`  ${key}: ${String(val)}`);
        }
      }
    } else {
      console.log('Could not parse log with known ABIs');
    }
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
