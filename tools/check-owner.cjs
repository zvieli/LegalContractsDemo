#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

(async () => {
  const result = {
    rpcUrl: null,
    arbitrationAddress: null,
    abiPath: null,
    abiExists: false,
    owner: null,
    error: null,
    timestamp: new Date().toISOString()
  };

  const jsonOnly = process.argv.includes('--json');

  try {
    const repoRoot = path.resolve(__dirname, '..');
    const deploymentPath = path.join(repoRoot, 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
    const abiPath = path.join(repoRoot, 'server', 'contracts', 'ArbitrationService.abi.json');

    let deployment = null;
    if (fs.existsSync(deploymentPath)) {
      try {
        deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      } catch (e) {
        result.error = 'Failed to parse deployment-summary.json: ' + e.message;
      }
    } else {
      if (!jsonOnly) console.warn('deployment-summary.json not found at', deploymentPath);
    }

    const arbitrationAddr = (deployment && deployment.contracts && deployment.contracts.ArbitrationService)
      ? deployment.contracts.ArbitrationService
      : (process.env.ARBITRATION_SERVICE_ADDRESS || null);

    // allow overriding via CLI flags
    const argv = process.argv.slice(2);
    const jsonOnly = process.argv.includes('--json');
    function argValue(flag) {
      const idx = argv.indexOf(flag);
      if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
      return null;
    }

    const rpcFromFlag = argValue('--rpc');
    const addrFromFlag = argValue('--address') || argValue('--addr');

    const rpcUrl = rpcFromFlag || process.env.RPC_URL || 'http://127.0.0.1:8545';
    result.rpcUrl = rpcUrl;
    result.arbitrationAddress = (addrFromFlag || arbitrationAddr) || null;
    result.abiPath = abiPath;
    result.abiExists = fs.existsSync(abiPath);

    if (!arbitrationAddr) {
      result.error = 'ArbitrationService address not found (deployment-summary or ARBITRATION_SERVICE_ADDRESS)';
      if (jsonOnly) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(1);
      } else {
        console.error('\nERROR: ArbitrationService address not found. Please set ARBITRATION_SERVICE_ADDRESS or ensure deployment-summary.json contains it.');
        process.exit(1);
      }
    }

    if (!result.abiExists) {
      result.error = 'ABI file not found at ' + abiPath;
      if (jsonOnly) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(1);
      } else {
        console.error('\nERROR: ABI file not found at', abiPath);
        process.exit(1);
      }
    }

    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    if (!jsonOnly) console.log('\nQuerying owner() from contract...');
    const contractAddrToUse = result.arbitrationAddress;
    const contract = new ethers.Contract(contractAddrToUse, abi, provider);
    const owner = await contract.owner();
    result.owner = owner;

    // add chainId and blockNumber for CI context
    try {
      const network = await provider.getNetwork();
      // chainId may be bigint - convert to Number or string
      result.chainId = network.chainId !== undefined && network.chainId !== null ? Number(network.chainId) : null;
    } catch (e) {
      result.chainId = null;
    }
    try {
      const blockNumber = await provider.getBlockNumber();
      // blockNumber can be bigint - convert to Number if safe
      result.blockNumber = blockNumber !== undefined && blockNumber !== null ? Number(blockNumber) : null;
    } catch (e) {
      result.blockNumber = null;
    }

    if (jsonOnly) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\nRPC URL:', result.rpcUrl);
      console.log('ArbitrationService address:', result.arbitrationAddress);
      console.log('ABI path:', result.abiPath, result.abiExists ? '(found)' : '(missing)');
      console.log('\nOwner:', result.owner);
      // Also print JSON for automation convenience
      console.log('\nJSON OUTPUT:');
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(0);
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
    if (jsonOnly) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }
    console.error('Unhandled error:', result.error);
    console.log('\nJSON OUTPUT:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }
})();
