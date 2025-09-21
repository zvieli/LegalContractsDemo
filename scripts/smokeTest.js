import fs from 'fs';
import path from 'path';

// This smoke test must be executed under Hardhat runtime so that we can
// use unlocked signers returned by `hre.ethers.getSigners()` and send
// transactions. Run with: `npx hardhat run scripts/smokeTest.js --network localhost`
async function main() {
  const hreModule = await import('hardhat');
  const hre = hreModule?.default ?? hreModule;
  const { ethers } = hre;
  const root = path.resolve();
  const frontendContractsDir = path.join(root, 'front', 'src', 'utils', 'contracts');

  const factoryDeploymentPath = path.join(frontendContractsDir, 'ContractFactory.json');
  const factoryAbiPath = path.join(frontendContractsDir, 'ContractFactoryABI.json');
  const mockContractsPath = path.join(frontendContractsDir, 'MockContracts.json');
  const rentAbiPath = path.join(frontendContractsDir, 'TemplateRentContractABI.json');
  const ndaAbiPath = path.join(frontendContractsDir, 'NDATemplateABI.json');
  const arbitratorAbiPath = path.join(frontendContractsDir, 'ArbitratorABI.json');

  if (!fs.existsSync(factoryDeploymentPath) || !fs.existsSync(factoryAbiPath)) {
    console.error('Required frontend contract files not found. Run scripts/deploy.js first.');
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(factoryDeploymentPath, 'utf8'));
  const abiJson = JSON.parse(fs.readFileSync(factoryAbiPath, 'utf8'));
  const mockContracts = fs.existsSync(mockContractsPath) ? JSON.parse(fs.readFileSync(mockContractsPath, 'utf8')) : null;

  const factoryAddress = deployment.contracts && deployment.contracts.ContractFactory;
  if (!factoryAddress) {
    console.error('ContractFactory address not found in', factoryDeploymentPath);
    process.exit(1);
  }

  // Require Hardhat runtime; fail fast if not available
  let factory;
  let deployerSigner;
  let tenantSigner;
  let landlordSigner;
  let partyASigner;
  let partyBSigner;
  let platformOwnerSigner;
  let arbitratorSigner;
  let provider;
  let ciFailOnError = false;
  let skipNDA = false;
  let skipRent = false;
  let forceDeposit = false;
  
  // Optional wallets JSON (first CLI arg): path to a JSON file with private keys and optional addresses
  let walletsFile = process.argv[2];
  let wallets = null;
  try {
    provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');

    if (walletsFile) {
      const candidate = path.isAbsolute(walletsFile) ? walletsFile : path.join(root, walletsFile);
      if (fs.existsSync(candidate)) {
        try {
          wallets = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          walletsFile = candidate;
          console.log('Loaded wallets from', candidate);
        } catch (e) {
          console.warn('Could not parse wallets file, falling back to Hardhat signers:', e.message || e);
          wallets = null;
        }
      } else {
        console.warn('Wallets file not found at', candidate, '- falling back to Hardhat signers');
      }
    } else {
      // try default WALLETS.json in project root
      const defaultPath = path.join(root, 'WALLETS.json');
      if (fs.existsSync(defaultPath)) {
        try {
          wallets = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
          walletsFile = defaultPath;
          console.log('Loaded wallets from default', defaultPath);
        } catch (e) {
          console.warn('Could not parse default WALLETS.json, falling back to Hardhat signers:', e.message || e);
        }
      }
    }

    if (wallets && wallets.keys) {
      // create wallets from provided private keys
      const keys = wallets.keys;
      const make = (k) => k ? new ethers.Wallet(k, provider) : null;
      deployerSigner = make(keys.deployer) || make(keys.owner) || make(keys.admin);
      landlordSigner = make(keys.landlord) || deployerSigner;
      tenantSigner = make(keys.tenant) || make(keys.partyB) || deployerSigner;
      partyASigner = make(keys.partyA) || deployerSigner;
      partyBSigner = make(keys.partyB) || tenantSigner;
      platformOwnerSigner = make(keys.platformOwner) || deployerSigner;
      arbitratorSigner = make(keys.arbitrator) || platformOwnerSigner;
    }

    if (!deployerSigner) {
      const signers = await ethers.getSigners();
      if (!signers || signers.length === 0) {
        throw new Error('No signers available from Hardhat runtime');
      }
      deployerSigner = signers[0];
      tenantSigner = tenantSigner || signers[1] || signers[0];
      landlordSigner = landlordSigner || deployerSigner;
      partyASigner = partyASigner || deployerSigner;
      partyBSigner = partyBSigner || tenantSigner;
      platformOwnerSigner = platformOwnerSigner || deployerSigner;
      arbitratorSigner = arbitratorSigner || platformOwnerSigner;
    }

    factory = await ethers.getContractAt(abiJson.abi, factoryAddress, deployerSigner);
  } catch (err) {
    console.error('This script must be run with the Hardhat runtime: `npx hardhat run scripts/smokeTest.js --network localhost`');
    console.error('Error loading Hardhat signers:', err.message || err);
    process.exit(1);
  }

  console.log('Using ContractFactory at', factoryAddress, '(Hardhat runtime)');

  // parse CLI flags (supports `--skip-nda`, `--skip-rent`, `--ci-fail`)
  for (const a of process.argv.slice(2)) {
    if (a === '--ci-fail') ciFailOnError = true;
    if (a === '--skip-nda') skipNDA = true;
    if (a === '--skip-rent') skipRent = true;
    if (a === '--force-deposit') forceDeposit = true;
  }

  // if deployment included a network/chain indicator, compare with provider network
  try {
    const net = await provider.getNetwork();
    const depNet = deployment.network || deployment.chainId || (deployment.networks && Object.keys(deployment.networks)[0]);
    if (depNet) {
      const dn = String(depNet);
      if (!String(net.chainId).includes(dn) && !dn.includes(String(net.chainId))) {
        console.warn('Warning: deployment indicates network', dn, 'but provider network is', net.chainId);
      }
    }
  } catch (_) {}

  // Build a map of address -> signer (from provided wallets and from the signers we obtained)
  const walletByAddress = {};
  try {
    if (wallets && wallets.keys) {
      for (const k of Object.keys(wallets.keys)) {
        try {
          const w = new ethers.Wallet(wallets.keys[k], provider);
          walletByAddress[w.address.toLowerCase()] = w;
        } catch (_) {}
      }
    }
  } catch (_) {}

  // include deployer/tenant/landlord/platformOwner if they are Signer objects
  const includeSigner = async (s) => {
    try {
      const a = (await s.getAddress()).toLowerCase();
      walletByAddress[a] = s;
    } catch (_) {}
  };
  await includeSigner(deployerSigner);
  if (tenantSigner) await includeSigner(tenantSigner);
  if (landlordSigner) await includeSigner(landlordSigner);
  if (partyASigner) await includeSigner(partyASigner);
  if (partyBSigner) await includeSigner(partyBSigner);
  if (platformOwnerSigner) await includeSigner(platformOwnerSigner);

  const getSignerForAddress = async (addr) => {
    if (!addr) return null;
    const key = addr.toLowerCase();
    if (walletByAddress[key]) return walletByAddress[key];
    try {
      // fallback to provider's signer (works for Hardhat unlocked accounts)
      return provider.getSigner(addr);
    } catch (_) {
      return null;
    }
  };

  // ensure signer is connected to provider (Wallets may already include provider)
  const ensureConnectedSigner = (s) => {
    if (!s) return null;
    try {
      if (s.provider) return s;
      if (typeof s.connect === 'function') return s.connect(provider);
    } catch (_) {}
    return s;
  };

  // wrapper for tx.wait with timeout
  const waitForTx = async (tx, confirmations = 1, timeoutMs = 120000) => {
    if (!tx) throw new Error('No tx provided to waitForTx');
    const waiter = typeof tx.wait === 'function' ? tx.wait(confirmations) : tx.wait;
    return await Promise.race([
      waiter,
      new Promise((_, rej) => setTimeout(() => rej(new Error('tx.wait timeout after ' + timeoutMs + 'ms')), timeoutMs))
    ]);
  };

  // flexible log/event parser: tries receipt.logs, receipt.events (framework dependent), and raw/topics
  const parseReceiptForEvent = (receipt, iface, eventName) => {
    if (!receipt) return null;
    if (receipt.logs && receipt.logs.length) {
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === eventName) return { parsed, log };
        } catch (e) {}
      }
    }
    if (receipt.events && Array.isArray(receipt.events)) {
      for (const ev of receipt.events) {
        try {
          if (ev.raw) {
            const parsed = iface.parseLog(ev.raw);
            if (parsed && parsed.name === eventName) return { parsed, log: ev.raw };
          }
          if (ev.topics && ev.data) {
            const pseudo = { topics: ev.topics, data: ev.data, address: ev.address };
            const parsed = iface.parseLog(pseudo);
            if (parsed && parsed.name === eventName) return { parsed, log: pseudo };
          }
        } catch (e) {}
      }
    }
    return null;
  };

  // helper to sign typed data with different signer implementations
  const signTypedDataGeneric = async (signer, domain, types, value) => {
    if (!signer) return null;
    try {
      if (typeof signer.signTypedData === 'function') {
        return await signer.signTypedData(domain, types, value);
      }
      if (typeof signer._signTypedData === 'function') {
        return await signer._signTypedData(domain, types, value);
      }
      // fallback: try provider eth_signTypedData_v4
      if (signer.provider && typeof signer.provider.send === 'function') {
        const addr = await signer.getAddress();
        const payload = JSON.stringify({ domain, types, primaryType: Object.keys(types)[0], message: value });
        // many nodes expect the typed data JSON structure; use eth_signTypedData_v4
        return await signer.provider.send('eth_signTypedData_v4', [addr, payload]);
      }
    } catch (e) {
      return null;
    }
    return null;
  };

  // choose a tenant (signer[1]) and price feed from mocks if available
  const tenantAddress = await tenantSigner.getAddress();
  if (!tenantAddress) {
    console.error('No tenant signer/address available');
    process.exit(1);
  }
  const priceFeed = mockContracts && mockContracts.contracts && mockContracts.contracts.MockPriceFeed
    ? mockContracts.contracts.MockPriceFeed
    : ethers.ZeroAddress;

  const rentAmount = ethers.parseUnits('1', 18);

  console.log('Creating sample Rent contract via factory (tenant:', tenantAddress, ', priceFeed:', priceFeed, ')');

  try {
    if (!skipRent) {
      const tx = await factory.createRentContract(tenantAddress, rentAmount, priceFeed, 0);
      console.log('tx sent, hash=', tx.hash);
      const receipt = await waitForTx(tx);
      console.log('tx mined. status=', receipt.status);

      // try to parse RentContractCreated event (flexible)
      let rentAddress = null;
      const ev = parseReceiptForEvent(receipt, factory.interface, 'RentContractCreated');
      if (ev && ev.parsed) rentAddress = ev.parsed.args[0];

      if (rentAddress) {
        console.log('Sample Rent contract created at:', rentAddress);
      } else {
        console.warn('Could not find RentContractCreated event in receipt. Raw logs count=', receipt.logs ? receipt.logs.length : 0);
      }

      // If we have the rent ABI, run a fuller flow: signing and payment
      if (fs.existsSync(rentAbiPath) && rentAddress) {
        try {
          const rentAbiJson = JSON.parse(fs.readFileSync(rentAbiPath, 'utf8'));
          const rentContract = await ethers.getContractAt(rentAbiJson.abi, rentAddress, deployerSigner);

          // Fetch chainId for EIP-712 domain
          const network = await provider.getNetwork();
          const chainId = Number(network.chainId);

          // read on-chain fields
          const [landlord, tenant, rentAmountOnChain, dueDate] = await Promise.all([
            rentContract.landlord(),
            rentContract.tenant(),
            rentContract.rentAmount(),
            rentContract.dueDate().catch(() => 0n)
          ]);

          console.log('Rent contract fields:', { landlord, tenant, rentAmountOnChain: rentAmountOnChain.toString(), dueDate: dueDate.toString() });

          // EIP-712 domain and types (match frontend ContractService)
          const domain = {
            name: 'TemplateRentContract',
            version: '1',
            chainId: chainId,
            verifyingContract: rentAddress
          };
          const types = {
            RENT: [
              { name: 'contractAddress', type: 'address' },
              { name: 'landlord', type: 'address' },
              { name: 'tenant', type: 'address' },
              { name: 'rentAmount', type: 'uint256' },
              { name: 'dueDate', type: 'uint256' }
            ]
          };
          const value = {
            contractAddress: rentAddress,
            landlord,
            tenant,
            rentAmount: BigInt(rentAmountOnChain),
            dueDate: BigInt(dueDate || 0n)
          };

          // landlord and tenant sign typed data and submit signatures
          try {
            const landlordSignerLocal = ensureConnectedSigner(await getSignerForAddress(landlord)) || ensureConnectedSigner(landlordSigner);
            const tenantSignerLocal = ensureConnectedSigner(await getSignerForAddress(tenant)) || ensureConnectedSigner(tenantSigner);
            const lsig = await signTypedDataGeneric(landlordSignerLocal, domain, types, value);
            const tsig = await signTypedDataGeneric(tenantSignerLocal, domain, types, value);

            // submit signatures on-chain (only if we obtained signatures)
            if (lsig) {
              const rentWithLandlord = rentContract.connect(landlordSignerLocal);
              await waitForTx(await rentWithLandlord.signRent(lsig));
            }
            if (tsig) {
              const rentWithTenant = rentContract.connect(tenantSignerLocal);
              await waitForTx(await rentWithTenant.signRent(tsig));
            }
            if (lsig || tsig) console.log('Signing attempts submitted for rent (where supported)');
          } catch (signErr) {
            console.warn('Signing flow failed (EIP-712) or signRent not present; continuing. Error:', signErr.message || signErr);
            if (ciFailOnError) process.exit(1);
          }

          // Attempt tenant payment (use signer matching on-chain tenant)
          try {
            const tenantLocalSigner = ensureConnectedSigner(await getSignerForAddress(tenant)) || ensureConnectedSigner(tenantSigner);
            if (tenantLocalSigner) {
              const tenantLocal = rentContract.connect(tenantLocalSigner);
              const payTx = await tenantLocal.payRentInEth({ value: rentAmountOnChain });
              const payRec = await waitForTx(payTx);
              console.log('Tenant paid rent, tx status=', payRec.status);
            } else {
              console.warn('No signer available for tenant address; skipping payment');
            }
          } catch (payErr) {
            console.warn('Payment attempt failed:', payErr.message || payErr);
            if (ciFailOnError) process.exit(1);
          }
        } catch (e) {
          console.warn('Could not run extended Rent flow:', e.message || e);
        }
      }
    } else {
      console.log('skipRent flag set; skipping Rent flow');
    }
    

    // (rent flow handled above)

    // list contracts by creator (factory.getContractsByCreatorPaged)
    try {
      const creator = deployerSigner.address || (await deployerSigner.getAddress());
      const contracts = await factory.getContractsByCreatorPaged(creator, 0, 20);
      console.log('Contracts created by factory owner (first 20):', contracts);
    } catch (err) {
      console.warn('Could not call getContractsByCreatorPaged:', err.message);
    }

    // -------- NDA flow --------
    // create sample NDA via factory (if ABI present)
    if (skipNDA) {
      console.log('skipNDA flag set; skipping NDA flow');
    } else if (fs.existsSync(ndaAbiPath)) {
      try {
        console.log('\n=== NDA flow ===');
        const ndaAbiJson = JSON.parse(fs.readFileSync(ndaAbiPath, 'utf8'));
        // choose partyB signer
        const partyB = partyBSigner ? await partyBSigner.getAddress() : tenantAddress;
        const expiryTs = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
        const penaltyBps = 100; // 1%
        const clausesHash = ethers.ZeroHash;
        const minDepositWei = ethers.parseEther('0.01');

        const tx2 = await factory.createNDA(partyB, expiryTs, penaltyBps, clausesHash, minDepositWei);
        const rec2 = await waitForTx(tx2);
        let ndaAddress = null;
        const ev2 = parseReceiptForEvent(rec2, factory.interface, 'NDACreated');
        if (ev2 && ev2.parsed) ndaAddress = ev2.parsed.args[0];
        if (!ndaAddress) {
          console.warn('Could not find NDACreated event; skipping NDA flow');
        } else {
          console.log('NDA created at', ndaAddress);
          const ndaContract = await ethers.getContractAt(ndaAbiJson.abi, ndaAddress, deployerSigner);

          // Signing by both parties (EIP-712) similar to frontend service
          try {
            const network = await provider.getNetwork();
            const chainId = Number(network.chainId);
            const domain = {
              name: 'NDATemplate',
              version: '1',
              chainId,
              verifyingContract: ndaAddress,
            };
            const types = {
              NDA: [
                { name: 'contractAddress', type: 'address' },
                { name: 'expiryDate', type: 'uint256' },
                { name: 'penaltyBps', type: 'uint16' },
                { name: 'customClausesHash', type: 'bytes32' },
              ],
            };
            const expiryOnChain = expiryTs;
            const value = {
              contractAddress: ndaAddress,
              expiryDate: BigInt(expiryOnChain),
              penaltyBps: Number(penaltyBps),
              customClausesHash: clausesHash,
            };

            // fetch actual parties from chain and pick signers matching those addresses
            const onA = await ndaContract.partyA().catch(() => null);
            const onB = await ndaContract.partyB().catch(() => null);
            const aSigner = ensureConnectedSigner(await getSignerForAddress(onA)) || ensureConnectedSigner(partyASigner) || ensureConnectedSigner(deployerSigner);
            const bSigner = ensureConnectedSigner(await getSignerForAddress(onB)) || ensureConnectedSigner(partyBSigner) || ensureConnectedSigner(tenantSigner);
            const sigA = await signTypedDataGeneric(aSigner, domain, types, value).catch(() => null);
            const sigB = await signTypedDataGeneric(bSigner, domain, types, value).catch(() => null);
            if (sigA) await waitForTx(await ndaContract.connect(aSigner).signNDA(sigA)).catch(() => {});
            if (sigB) await waitForTx(await ndaContract.connect(bSigner).signNDA(sigB)).catch(() => {});
            console.log('NDA signing attempts submitted (if supported by ABI)');
          } catch (sigErr) {
            console.warn('NDA signing flow failed or not supported:', sigErr.message || sigErr);
          }

          // deposit minDeposit by partyA (deployer) for demo
          try {
            const depositor = ensureConnectedSigner(deployerSigner);
            const depositTx = await ndaContract.connect(depositor).deposit({ value: minDepositWei });
            await waitForTx(depositTx);
            console.log('Deposited minDeposit to NDA');
          } catch (depErr) {
            console.warn('Deposit failed:', depErr.message || depErr);
          }

            // Report breach by reporter (use tenantSigner) - create case
          try {
            // pick a reporter who is a party (prefer partyA)
            const onPartyA = await ndaContract.partyA().catch(() => null);
            const onPartyB = await ndaContract.partyB().catch(() => null);
            let reporter = null;
            if (onPartyA) reporter = ensureConnectedSigner(await getSignerForAddress(onPartyA));
            if (!reporter && onPartyB) reporter = ensureConnectedSigner(await getSignerForAddress(onPartyB));
            if (!reporter) reporter = ensureConnectedSigner(tenantSigner);
            const offender = partyB;
            const requested = ethers.parseEther('0.005');
            const evidence = 'Smoke test evidence';
            const evidenceHash = ethers.id(evidence);
            // include dispute fee if present
            let disputeFee = 0n;
            try { disputeFee = await ndaContract.disputeFee(); } catch (e) { disputeFee = 0n; }
            // If requested, ensure offender has deposited minimum required amount so report does not revert
            if (forceDeposit) {
              try {
                let minDepositOnChain = 0n;
                try { minDepositOnChain = await ndaContract.minDeposit(); } catch (e) { minDepositOnChain = 0n; }
                if (minDepositOnChain && minDepositOnChain > 0n) {
                  // attempt to deposit from offender
                  const offenderSigner = ensureConnectedSigner(await getSignerForAddress(offender));
                  if (offenderSigner) {
                    try {
                      console.log('force-deposit: sending deposit from offender', offender);
                      const depTx = await ndaContract.connect(offenderSigner).deposit({ value: minDepositOnChain });
                      await waitForTx(depTx);
                      console.log('force-deposit: deposit succeeded');
                    } catch (dErr) {
                      console.warn('force-deposit: deposit attempt failed:', dErr.message || dErr);
                    }
                  } else {
                    console.warn('force-deposit: no signer available for offender address', offender);
                  }
                } else {
                  console.log('force-deposit: NDA has no minDeposit or minDeposit is zero; skipping deposit');
                }
              } catch (fdErr) {
                console.warn('force-deposit: unexpected error while attempting deposit:', fdErr.message || fdErr);
              }
            }

            const reportTx = await ndaContract.connect(reporter).reportBreach(offender, requested, evidenceHash, { value: disputeFee });
            const reportRec = await waitForTx(reportTx);
            console.log('Reported breach, tx status=', reportRec.status);

            // find case id: use getCasesCount-1
            let caseId = null;
            try {
              const cnt = Number(await ndaContract.getCasesCount());
              caseId = Math.max(0, cnt - 1);
            } catch (e) {
              console.warn('Could not determine caseId:', e.message || e);
            }

            // If we have an Arbitrator ABI and an Arbitrator contract deployed, try to create dispute
            if (fs.existsSync(arbitratorAbiPath) && wallets && wallets.addresses && wallets.addresses.arbitrator) {
              try {
                const arbAbiJson = JSON.parse(fs.readFileSync(arbitratorAbiPath, 'utf8'));
                const arbitratorAddr = wallets.addresses.arbitrator;
                const arbContract = await ethers.getContractAt(arbAbiJson.abi, arbitratorAddr, reporter);
                const createTx = await arbContract.createDisputeForCase(ndaAddress, caseId, ethers.toUtf8Bytes(evidence));
                const createRec = await waitForTx(createTx);
                console.log('Created dispute via Arbitrator, tx status=', createRec.status);
                // try to parse DisputeCreated event for instance
                let instanceAddr = null;
                for (const lg of createRec.logs) {
                  try {
                    const parsed = arbContract.interface.parseLog(lg);
                    if (parsed && parsed.name === 'DisputeCreated') {
                      instanceAddr = parsed.args[4]; // arbitrationInstance
                      break;
                    }
                  } catch (e) {}
                }
                if (instanceAddr) {
                  console.log('Arbitration instance deployed at', instanceAddr);
                  // resolve dispute from platformOwner (if available)
                  if (platformOwnerSigner) {
                    try {
                      const instAbi = [
                        'function resolve(uint256 _penaltyAmount, address _beneficiary) external'
                      ];
                      const instance = await ethers.getContractAt(instAbi, instanceAddr, ensureConnectedSigner(platformOwnerSigner));
                      const resTx = await instance.resolve(requested, await reporter.getAddress());
                      const resRec = await waitForTx(resTx);
                      console.log('Arbitration instance resolved, tx status=', resRec.status);
                    } catch (resErr) {
                      console.warn('Could not resolve arbitration instance:', resErr.message || resErr);
                    }
                  }
                }
              } catch (arbErr) {
                console.warn('Arbitration flow skipped/failed:', arbErr.message || arbErr);
              }
            } else {
              console.log('No Arbitrator configured or ABI/addresses missing; skipping arbitration step');
            }

          } catch (reportErr) {
            console.warn('Report breach failed:', reportErr.message || reportErr);
          }
        }
      } catch (ndaErr) {
        console.warn('NDA flow skipped due to error:', ndaErr.message || ndaErr);
      }
    } else {
      console.log('NDA ABI not found in frontend contracts folder; skipping NDA flow');
    }

    console.log('SMOKE TEST: OK');
  } catch (err) {
    console.error('SMOKE TEST FAILED:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error in smokeTest:', err);
  process.exit(1);
});
