import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

/**
 * Updated Rent Contract E2E Test for V7 Architecture
 * Uses Playwright for UI interactions and Ethers.js v6 for Smart Contract interactions
 * Connects to local Hardhat network and uses existing deployed contracts
 */

test.describe('Rent arbitration E2E (integration)', () => {
  test('arbitration enforces bond cap and transfers available deposit', async ({ page }) => {
    // Connect to local Hardhat node
    const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
    let provider: ethers.JsonRpcProvider;
    try {
      provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
    } catch (e) {
      test.skip(true, 'Local RPC not available at ' + rpc);
      return;
    }

    // Load deployed contract addresses
    let contractFactory, arbitrationService;
    try {
      const factoryJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'ContractFactory.json'), 'utf8'));
      contractFactory = factoryJson.contracts.ContractFactory;
      arbitrationService = factoryJson.contracts.ArbitrationService;
      
      if (!contractFactory || !arbitrationService) {
        test.skip(true, 'Required contract addresses not found in deployment file');
        return;
      }
    } catch (e) {
      test.skip(true, 'Could not load deployed contract addresses');
      return;
    }

    // Get accounts from provider
    let accounts: string[];
    try {
      // For local Hardhat, we can use the known accounts
      accounts = [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // account 0
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // account 1
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // account 2
      ];
    } catch (e) {
      test.skip(true, 'Cannot get accounts');
      return;
    }

    if (accounts.length < 3) {
      test.skip(true, 'Not enough local accounts');
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

    // Helper to deploy using compiled artifact
    async function deployFromArtifact(artifactPath: string, signer: ethers.Wallet, ctorArgs: any[] = []) {
      const artifact = loadArtifact(artifactPath);
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
      const contract = await factory.deploy(...ctorArgs);
      await contract.waitForDeployment();
      return contract;
    }

    // Connect to existing deployed contracts
    const arbServiceArtifact = loadArtifact('ArbitrationService.sol/ArbitrationService.json');
    const arbService = new ethers.Contract(arbitrationService, arbServiceArtifact.abi, deployer);
    const arbServiceAddress = arbitrationService;

    // Connect to existing ContractFactory
    const factoryArtifact = loadArtifact('ContractFactory.sol/ContractFactory.json');
    const factory = new ethers.Contract(contractFactory, factoryArtifact.abi, deployer);

    // Connect to existing ArbitrationContractV2 (Oracle)
    const arbContractArtifact = loadArtifact('ArbitrationContractV2.sol/ArbitrationContractV2.json');
    const factoryJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'ContractFactory.json'), 'utf8'));
    const arbContractAddress = factoryJson.contracts.ArbitrationContractV2;
    const arbContract = new ethers.Contract(arbContractAddress, arbContractArtifact.abi, deployer);

    // Deploy TemplateRentContract: constructor args per file
    // Use MockPriceFeed that was deployed
    const mockJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'utils', 'contracts', 'MockContracts.json'), 'utf8'));
    const priceFeed = mockJson.contracts.MockPriceFeed;
    const requiredDeposit = ethers.parseEther('1'); // 1 ETH deposit
    const rentAmount = 100; // arbitrary unit (not used here)
    const dueDate = Math.floor(Date.now() / 1000) + 86400;

    // Use ContractFactory to create rent contract (proper E2E flow)
    // Use the 6-parameter version: createRentContract(address,uint256,address,uint256,uint256,string)
    const createTx = await (factory as any).connect(landlord)['createRentContract(address,uint256,address,uint256,uint256,string)'](
      await tenant.getAddress(),
      rentAmount,
      priceFeed,
      dueDate,
      0, // propertyId
      '' // initialEvidenceUri
    );
    const receipt = await createTx.wait();
    
    // Find the contract creation event to get the new contract address
    const event = receipt.logs.find((log: any) => log.topics[0] === ethers.id('RentContractCreated(address,address,address)'));
    if (!event) throw new Error('RentContractCreated event not found');
    const rentContractAddress = ethers.AbiCoder.defaultAbiCoder().decode(['address'], event.topics[1])[0];
    
    // Connect to the created contract
    const rentContractArtifact = loadArtifact('Rent/TemplateRentContract.sol/TemplateRentContract.json');
    const rentContract = new ethers.Contract(rentContractAddress, rentContractArtifact.abi, deployer);

    // Helper function for EIP712 signing (like in unit tests)
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

    // Both parties sign the contract first (required for deposits)
    const landlordSig = await signRent(landlord, rentContract, await landlord.getAddress(), await tenant.getAddress(), rentAmount, dueDate);
    const tenantSig = await signRent(tenant, rentContract, await landlord.getAddress(), await tenant.getAddress(), rentAmount, dueDate);

    await (rentContract as any).connect(landlord).signRent(landlordSig);
    await (rentContract as any).connect(tenant).signRent(tenantSig);

    // Verify contract is fully signed
    const isFullySigned = await (rentContract as any).isFullySigned();
    expect(isFullySigned).toBe(true);

    // Tenant deposits the full required amount first
    const depositTx = await (rentContract as any).connect(tenant).depositSecurity({ value: ethers.parseEther('1') });
    await depositTx.wait();

    // Verify tenant deposit
    const tenantDepositBefore = await (rentContract as any).partyDeposit(await tenant.getAddress());
    expect(tenantDepositBefore).toEqual(ethers.parseEther('1'));

    // Landlord reports a dispute requesting 2 ETH (more than tenant deposited, to test cap)
    const requested = ethers.parseEther('2');
    const bond = ethers.parseEther('0.01'); // 0.5% of 2 ETH = 0.01 ETH
    const reportTx = await (rentContract as any).connect(landlord).reportDispute(0, requested, 'ipfs://fake-evidence', { value: bond });
    await reportTx.wait();
    
    // Verify dispute was created (caseId should be 0)
    const disputeCount = await (rentContract as any).getDisputesCount();
    expect(disputeCount).toEqual(1n);

    // Configure ArbitrationContractV2 for testing
    await (arbContract as any).connect(deployer).setTestMode(true);

    // Create an arbitration request
    const requestTx = await (arbContract as any).connect(deployer).requestArbitration(rentContractAddress, 0, '0x');
    const requestReceipt = await requestTx.wait();
    
    // Find the ArbitrationRequested event and extract the request ID from the data field
    const requestEvent = requestReceipt.logs[0]; // Should be the first (and likely only) log
    const requestId = requestEvent.data; // The request ID is in the data field

    console.log('Request ID:', requestId);

    // Build response: approve=true, appliedAmount=requested, beneficiary=landlord
    // The parseArbitrationResponse function expects ABI-encoded data: (bool, uint256, address)
    const approve = true;
    const beneficiary = await landlord.getAddress();
    const responseBytes = ethers.AbiCoder.defaultAbiCoder().encode(
      ['bool', 'uint256', 'address'],
      [approve, requested, beneficiary]
    );

    console.log('Response encoded, approve:', approve, 'amount:', requested.toString(), 'beneficiary:', beneficiary);

    // Check landlord balance before arbitration
    const landlordBalanceBefore = await provider.getBalance(await landlord.getAddress());
    console.log('Landlord balance before arbitration:', ethers.formatEther(landlordBalanceBefore), 'ETH');

    // Simulate the LLM response
    await (arbContract as any).connect(deployer).simulateResponse(requestId, responseBytes);

    // After fulfillment, check the results
    const tenantDepositAfter = await (rentContract as any).partyDeposit(await tenant.getAddress());
    const withdrawableLandlord = await (rentContract as any).withdrawable(await landlord.getAddress());
    const landlordBalanceAfter = await provider.getBalance(await landlord.getAddress());
    const landlordBalanceChange = landlordBalanceAfter - landlordBalanceBefore;
    
    console.log('After arbitration:');
    console.log('- Tenant deposit after:', ethers.formatEther(tenantDepositAfter), 'ETH');
    console.log('- Landlord withdrawable:', ethers.formatEther(withdrawableLandlord), 'ETH');
    console.log('- Landlord balance before:', ethers.formatEther(landlordBalanceBefore), 'ETH');
    console.log('- Landlord balance after:', ethers.formatEther(landlordBalanceAfter), 'ETH');
    console.log('- Landlord balance change:', ethers.formatEther(landlordBalanceChange), 'ETH');

    // Verify the dispute was resolved
    const [initiator, dtype, requestedAmount, evidenceUri, resolved, approved, appliedAmount] = await (rentContract as any).getDispute(0);
    console.log('Dispute state:');
    console.log('- Resolved:', resolved);
    console.log('- Approved:', approved); 
    console.log('- Applied amount:', ethers.formatEther(appliedAmount), 'ETH');
    console.log('- Requested amount:', ethers.formatEther(requestedAmount), 'ETH');

    // The expected behavior is:
    // 1. Tenant had 1 ETH deposited
    // 2. Landlord requested 2 ETH (more than available)
    // 3. Resolution should cap to available amount (1 ETH)
    // 4. Tenant deposit should be 0, landlord should have 1 ETH
    
    expect(tenantDepositAfter).toEqual(0n);
    expect(resolved).toBe(true);
    expect(approved).toBe(true);
    
    // The applied amount should be capped to available deposit (1 ETH, not 2 ETH requested)
    expect(appliedAmount).toEqual(ethers.parseEther('1')); 
    
    // Either landlord received funds directly (balance increase) or has withdrawable balance
    const totalLandlordReceived = withdrawableLandlord + landlordBalanceChange;
    expect(totalLandlordReceived).toBeGreaterThanOrEqual(ethers.parseEther('0.99')); // Allow for some gas costs

    console.log('✅ Arbitration test completed successfully');
    console.log('- Tenant deposit before:', ethers.formatEther(tenantDepositBefore), 'ETH');
    console.log('- Tenant deposit after:', ethers.formatEther(tenantDepositAfter), 'ETH');
    console.log('- Landlord withdrawable:', ethers.formatEther(withdrawableLandlord), 'ETH');
    console.log('- Applied amount (capped):', ethers.formatEther(appliedAmount), 'ETH');
  });
});