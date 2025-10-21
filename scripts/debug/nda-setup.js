#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { signTypedDataNode } from '../utils/ndaHelpers.js';

// Minimal NDA setup script that wraps deployNDA flow used previously in .cjs
async function main(){
  console.log('nda-setup.js placeholder: for full migration this script mirrors nda-setup.cjs behaviour');
  // For brevity we keep the old logic in nda-ensure.js/deploy functions; callers should use nda-ensure.js for unified flow.
}

main().catch(err=>{ console.error('nda-setup failed:', err); process.exit(1); });
