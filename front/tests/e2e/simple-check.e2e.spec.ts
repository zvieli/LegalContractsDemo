import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

test.describe('Simple E2E Check', () => {
  test('verify deployed contracts work', async () => {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    // Load contract addresses
    const factoryJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'ContractFactory.json'), 'utf8'));
    const contractFactory = factoryJson.contracts.ContractFactory;
    const arbitrationService = factoryJson.contracts.ArbitrationService;
    
    console.log('ContractFactory:', contractFactory);
    console.log('ArbitrationService:', arbitrationService);
    
    // Check if contracts have code
    const factoryCode = await provider.getCode(contractFactory);
    const serviceCode = await provider.getCode(arbitrationService);
    
    expect(factoryCode.length).toBeGreaterThan(2); // More than "0x"
    expect(serviceCode.length).toBeGreaterThan(2);
    
    console.log('✅ All contracts deployed and have code');
  });
});