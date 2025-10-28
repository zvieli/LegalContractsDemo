import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { getProviderSync } from '../server/lib/getProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const txHash = process.argv[2] || '0x1b611005bf0a3640e10366f2fcc90e1417715819465dab631f660db11ccae51d';
  const provider = getProviderSync();

  console.log('Using provider:', provider.connection ? provider.connection.url : provider);
  console.log('Fetching tx:', txHash);

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    console.error('Transaction not found');
    process.exit(2);
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error('Receipt not found (tx may be pending)');
  }

  // prepare report object to persist
  const report = {
    txHash: tx.hash,
    summary: {
      from: tx.from,
      to: tx.to,
      value: tx.value ? tx.value.toString() : '0',
      dataLength: tx.data ? tx.data.length : 0,
      status: receipt ? receipt.status : null,
      blockNumber: receipt ? receipt.blockNumber : null,
      gasUsed: receipt && receipt.gasUsed ? (receipt.gasUsed.toString ? receipt.gasUsed.toString() : String(receipt.gasUsed)) : null,
      logsCount: receipt && receipt.logs ? receipt.logs.length : 0
    },
    decodedCall: null,
    logs: [],
    rawReceipt: receipt || null
  };

  console.log('\n=== TX Summary ===');
  console.log('hash:', tx.hash);
  console.log('from:', tx.from);
  console.log('to:', tx.to);
  console.log('value:', tx.value ? tx.value.toString() : '0');
  console.log('data length:', tx.data ? tx.data.length : 0);
  if (receipt) {
    console.log('status:', receipt.status);
    console.log('blockNumber:', receipt.blockNumber);
    console.log('gasUsed:', receipt.gasUsed ? receipt.gasUsed.toString() : 'n/a');
    console.log('effectiveGasPrice:', receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : 'n/a');
    console.log('logs:', (receipt.logs || []).length);
  }

  // Load ABIs if available
  const abiCandidates = {
    CCIPArbitrationSender: path.resolve(process.cwd(), 'artifacts/contracts/Arbitration/ccip/CCIPArbitrationSender.sol/CCIPArbitrationSender.json'),
    ArbitrationService: path.resolve(process.cwd(), 'artifacts/contracts/Arbitration/ArbitrationService.sol/ArbitrationService.json')
  };

  const interfaces = {};
  for (const [name, p] of Object.entries(abiCandidates)) {
    try {
      if (fs.existsSync(p)) {
        const art = JSON.parse(fs.readFileSync(p, 'utf8'));
        interfaces[name] = new ethers.Interface(art.abi);
        console.log(`Loaded ABI for ${name} from ${path.relative(process.cwd(), p)}`);
      }
    } catch (e) {
      console.warn('Failed to load ABI', name, e && e.message ? e.message : e);
    }
  }

  // Try to decode calldata
  function safeSerialize(v) {
    try {
      if (v === null || v === undefined) return v;
      // ethers Result / array-like
      if (Array.isArray(v) || (typeof v === 'object' && typeof v.length === 'number')) {
        const out = [];
        for (let i = 0; i < v.length; i++) {
          out.push(safeSerialize(v[i]));
        }
        return out;
      }
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v && typeof v.toString === 'function' && (v._isBigNumber || v.toString().match(/^\d+$/))) {
        return v.toString();
      }
      return v;
    } catch (e) {
      return String(v);
    }
  }

  if (tx.data && interfaces.CCIPArbitrationSender) {
    try {
      const parsed = interfaces.CCIPArbitrationSender.parseTransaction({ data: tx.data, value: tx.value });
      console.log('\n=== Decoded Call ===');
      console.log('function:', parsed.name);
      console.log('args:', parsed.args);
      report.decodedCall = { name: parsed.name, args: safeSerialize(parsed.args) };
    } catch (e) {
      console.log('\nCould not decode calldata with CCIPArbitrationSender ABI');
    }
  }

  // Decode logs
  console.log('\n=== Decoded Logs ===');
  if (!receipt || !receipt.logs || receipt.logs.length === 0) console.log('No logs present');
  else {
    for (const lg of receipt.logs) {
      let decoded = null;
      const logEntry = { address: lg.address, topics: lg.topics, data: lg.data };
      for (const [name, iface] of Object.entries(interfaces)) {
        try {
          decoded = iface.parseLog(lg);
          if (decoded) {
            console.log('\nEvent from ABI:', name);
            console.log('  event:', decoded.name);
            console.log('  args:', decoded.args);
            logEntry.decoded = { artifact: name, event: decoded.name, args: safeSerialize(decoded.args) };
            break;
          }
        } catch (e) {
          // not matching this ABI
        }
      }
      if (!decoded) {
        console.log('\nUnknown log:');
        console.log('  address:', lg.address);
        console.log('  topics:', lg.topics);
        console.log('  data (prefix):', lg.data ? lg.data.slice(0, 200) : '');

        // Try to identify event by scanning all artifacts for matching topic0
        try {
          const topic0 = lg.topics && lg.topics[0];
          if (topic0) {
            console.log('\nScanning artifacts for matching event signature...');
            const matches = findEventByTopic(topic0);
            if (matches && matches.length) {
              console.log('Potential matches found:');
              logEntry.potentialMatches = matches;
              for (const m of matches) {
                console.log(`  - ${m.artifact} :: ${m.event} (abi path: ${m.path})`);
              }
            } else {
              console.log('No matching event signature found in artifacts.');
            }
          }
        } catch (e) {
          console.warn('Error while scanning artifacts for event signature:', e && e.message ? e.message : e);
        }
        report.logs.push(logEntry);
      }
    }
  }

  // helper: scan artifacts folder for event signature matches
  function findEventByTopic(topic0) {
    const artifactsDir = path.resolve(process.cwd(), 'artifacts');
    const out = [];
    function walk(d) {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile() && ent.name.endsWith('.json')) {
          try {
            const raw = fs.readFileSync(full, 'utf8');
            const json = JSON.parse(raw);
            if (!json.abi || !Array.isArray(json.abi)) continue;
            const iface = new ethers.Interface(json.abi);
            for (const frag of json.abi) {
              if (frag.type === 'event') {
                const types = (frag.inputs || []).map(i => i.type).join(',');
                const sig = `${frag.name}(${types})`;
                const hash = ethers.id(sig);
                if (hash === topic0) {
                  out.push({ artifact: json.contractName || path.basename(full), event: frag.name, signature: sig, path: path.relative(process.cwd(), full) });
                }
              }
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    }
    walk(artifactsDir);
    return out;
  }

  // write report file
  try {
    const outDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const safeHash = tx.hash.replace(/^0x/, '');
    const outPath = path.join(outDir, `tx-${safeHash}-decoded.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('\nSaved decoded report to', outPath);
  } catch (e) {
    console.warn('Failed to write report file:', e && e.message ? e.message : e);
  }

  // Optionally print full receipt JSON
  // console.log('\nFull receipt:', JSON.stringify(receipt, null, 2));
}

main().catch(e => { console.error('Error:', e && e.stack ? e.stack : e); process.exit(1); });
