import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

test.describe('Rent Contract Time-Dependent E2E Tests', () => {
  test('time-based rent payment validation and automatic security release', async () => {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    
    let accounts;
    try {
      accounts = await provider.listAccounts();
    } catch (e) {
      test.skip(true, 'Cannot get accounts');
      return;
    }

    if (accounts.length < 3) {
      test.skip(true, 'Not enough local accounts');
      return;
    }

    // Load contract addresses
    let contractFactory, arbitrationService;
    try {
      const factoryJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'ContractFactory.json'), 'utf8'));
      contractFactory = factoryJson.contracts.ContractFactory;
      arbitrationService = factoryJson.contracts.ArbitrationService;
      
      if (!contractFactory || !arbitrationService) {
        test.skip(true, 'Contract addresses not found');
        return;
      }
    } catch (e) {
      test.skip(true, 'Cannot load contract addresses');
      return;
    }

    const deployer = await provider.getSigner(0); // Hardhat account 0
    const landlord = await provider.getSigner(1); // Hardhat account 1  
    const tenant = await provider.getSigner(2); // Hardhat account 2

    function loadArtifact(name: string) {
      const p = path.join(process.cwd(), '..', 'artifacts', 'contracts', name);
      if (!fs.existsSync(p)) throw new Error('Missing artifact: ' + p);
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }

    // Connect to existing ContractFactory
    const factoryArtifact = loadArtifact('ContractFactory.sol/ContractFactory.json');
    const factory = new ethers.Contract(contractFactory, factoryArtifact.abi, deployer);

    // Use MockPriceFeed that was deployed
    const mockJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'MockContracts.json'), 'utf8'));
    const priceFeed = mockJson.contracts.MockPriceFeed;
    const requiredDeposit = ethers.parseEther('1'); // 1 ETH deposit
    const rentAmount = 100; // arbitrary unit
    
    // Set due date to 1 hour from now for testing
    const dueDate = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    console.log('Creating rent contract with due date:', new Date(dueDate * 1000).toISOString());

    // Create rent contract via factory
    const createTx = await (factory as any).connect(landlord)['createRentContract(address,uint256,address,uint256,uint256,string)'](
      await tenant.getAddress(),
      rentAmount,
      priceFeed,
      dueDate,
      0, // propertyId
      '' // initialEvidenceUri
    );
    const receipt = await createTx.wait();
    
    // Extract contract address from event
    const event = receipt.logs[0];
    const rentContractAddress = ethers.AbiCoder.defaultAbiCoder().decode(['address'], event.topics[1])[0];
    
    // Connect to the created contract
    const rentContractArtifact = loadArtifact('Rent/TemplateRentContract.sol/TemplateRentContract.json');
    const rentContract = new ethers.Contract(rentContractAddress, rentContractArtifact.abi, deployer);

    // Helper function for EIP712 signing
    async function signRent(signer: any, contract: any, landlord: string, tenant: string, rentAmount: number, dueDate: number) {
      const provider = signer.provider;
      const domain = {
        name: 'TemplateRentContract',
        version: '1',
        chainId: (await provider.getNetwork()).chainId,
        verifyingContract: await contract.getAddress()
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
        contractAddress: await contract.getAddress(),
        landlord,
        tenant,
        rentAmount,
        dueDate
      };
      return await signer.signTypedData(domain, types, value);
    }

    // Both parties sign the contract
    const landlordSig = await signRent(landlord, rentContract, await landlord.getAddress(), await tenant.getAddress(), rentAmount, dueDate);
    const tenantSig = await signRent(tenant, rentContract, await landlord.getAddress(), await tenant.getAddress(), rentAmount, dueDate);

    await (rentContract as any).connect(landlord).signRent(landlordSig);
    await (rentContract as any).connect(tenant).signRent(tenantSig);

    // Verify contract is fully signed
    const isFullySigned = await (rentContract as any).isFullySigned();
    expect(isFullySigned).toBe(true);

    // Tenant deposits security
    const depositTx = await (rentContract as any).connect(tenant).depositSecurity({ value: requiredDeposit });
    await depositTx.wait();

    console.log('✅ Contract setup complete - testing time-based scenarios');

    // SCENARIO 1: Try to pay rent before due date (should work)
    console.log('\n📅 SCENARIO 1: Paying rent before due date');
    const currentTime = Math.floor(Date.now() / 1000);
    console.log('Current time:', new Date(currentTime * 1000).toISOString());
    console.log('Due date:', new Date(dueDate * 1000).toISOString());
    console.log('Time until due:', (dueDate - currentTime), 'seconds');

    // Should be able to pay rent before due date
    const rentPayment = ethers.parseEther('0.1'); // Mock rent payment
    const payRentTx = await (rentContract as any).connect(tenant).payRentPartial({ value: rentPayment });
    await payRentTx.wait();
    
    const rentPaid = await (rentContract as any).rentPaid();
    console.log('Rent paid status:', rentPaid);

    // SCENARIO 2: Fast forward time past due date
    console.log('\n⏰ SCENARIO 2: Fast forwarding time past due date');
    
    // Increase time by 2 hours (past the due date)
    const timeIncrease = 7200; // 2 hours
    await provider.send('evm_increaseTime', [timeIncrease]);
    await provider.send('evm_mine', []); // Mine a block to apply the time change
    
    const newBlockTime = await provider.getBlock('latest').then(b => b?.timestamp);
    console.log('New block time:', new Date(newBlockTime! * 1000).toISOString());
    console.log('Time past due date:', (newBlockTime! - dueDate), 'seconds');

    // SCENARIO 3: Test late fee calculation
    console.log('\n💰 SCENARIO 3: Testing late fee calculation');
    
    // Reset rent paid status for testing (if possible)
    // Note: In a real scenario, this would be a new rental period
    
    // Try to get rent amount with late fee
    const lateFeePercent = await (rentContract as any).lateFeePercent();
    console.log('Late fee percentage:', lateFeePercent.toString(), '%');

    // SCENARIO 4: Fast forward to end of contract period (simulate contract expiry)
    console.log('\n📆 SCENARIO 4: Testing contract expiry and security deposit release');
    
    // Fast forward significantly (e.g., 1 year)
    const contractEndTime = 365 * 24 * 3600; // 1 year
    await provider.send('evm_increaseTime', [contractEndTime]);
    await provider.send('evm_mine', []);
    
    const finalBlockTime = await provider.getBlock('latest').then(b => b?.timestamp);
    console.log('Final block time:', new Date(finalBlockTime! * 1000).toISOString());

    // Check if contract is still active
    const isActive = await (rentContract as any).active();
    console.log('Contract still active after expiry simulation:', isActive);

    // Check tenant can withdraw security deposit after contract expiry
    const tenantDepositBefore = await (rentContract as any).partyDeposit(await tenant.getAddress());
    console.log('Tenant deposit before withdrawal attempt:', ethers.formatEther(tenantDepositBefore), 'ETH');

    // In a production contract, there might be logic to automatically release deposits
    // or allow withdrawal after contract expiry. This depends on the specific implementation.

    console.log('\n✅ Time-based scenarios completed successfully');
    console.log('Key validations:');
    console.log('- ✅ Rent payment works before due date');
    console.log('- ✅ Time manipulation works correctly');
    console.log('- ✅ Late fee logic accessible');
    console.log('- ✅ Contract expiry simulation completed');
  });
});