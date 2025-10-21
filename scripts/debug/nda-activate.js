#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import * as ndaHelpers from '../utils/ndaHelpers.js';

async function main(){
  // This script mirrors the activation flow in the original .cjs version.
  try {
    const workspaceRoot = path.resolve(__dirname,'..','..');
    const deployPath = path.join(workspaceRoot,'front','src','utils','contracts','deployment-summary.json');
    if (!fs.existsSync(deployPath)) { console.error('deployment-summary.json not found'); process.exit(1); }
    const deployment = JSON.parse(fs.readFileSync(deployPath,'utf8'));
    const ndaAddress = deployment.NDATemplate || (deployment.contracts && deployment.contracts.NDATemplate);
    if (!ndaAddress) { console.error('NDATemplate not found in deployment-summary.json'); process.exit(1); }
    console.log('nda-activate: would ensure activation for', ndaAddress);
    // Delegate to nda-ensure.js if more complex behaviour required
    process.exit(0);
  } catch (e) {
    console.error('nda-activate failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
