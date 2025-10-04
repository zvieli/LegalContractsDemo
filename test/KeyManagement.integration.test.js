import { expect } from "chai";
import pkg from "hardhat";

const { ethers } = pkg;

describe.skip("Key Management Integration Tests (skipped - pending key registry integration refactor)", function () {
    let keyRegistry;
    let contractFactory;
    let arbitrationService;
    let landlord, tenant;
    
    // Valid ECIES public key (64 bytes raw bytes)
    const validPublicKey = ethers.getBytes("0x" + "a".repeat(128));
    
    before(async function () {
        [landlord, tenant] = await ethers.getSigners();
        
        // Get deployed contracts
        const fs = await import('fs');
        const deploymentData = JSON.parse(
            fs.readFileSync(
                'front/public/utils/contracts/MockContracts.json', 
                'utf8'
            )
        );
        
        // Connect to deployed contracts
        const KeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
        keyRegistry = KeyRegistry.attach(deploymentData.contracts.RecipientKeyRegistry);
        
        const ContractFactory = await ethers.getContractFactory("ContractFactory");
        contractFactory = ContractFactory.attach(deploymentData.contracts.ContractFactory);
        
        const ArbitrationService = await ethers.getContractFactory("ArbitrationService");
        arbitrationService = ArbitrationService.attach(deploymentData.contracts.ArbitrationService);
    });
    
    describe("End-to-End Key Management Flow", function () {
        it("Should register landlord encryption key", async function () {
            const tx = await keyRegistry.connect(landlord).registerKey(
                validPublicKey,
                0, // Use default lifetime
                "Landlord primary key for evidence encryption"
            );
            
            await tx.wait();
            
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(landlord.address);
            expect(publicKey).to.equal(ethers.hexlify(validPublicKey));
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
        });
        
        it("Should create rent contract with key registry integration", async function () {
            // Create a rent contract
            const rentParams = {
                tenant: tenant.address,
                landlord: landlord.address,
                monthlyRent: ethers.parseEther("1000"),
                securityDeposit: ethers.parseEther("2000"),
                leaseDuration: 12, // 12 months
                arbitrationService: await arbitrationService.getAddress()
            };
            
            const tx = await contractFactory.connect(landlord).createRentContract(
                rentParams.tenant,
                rentParams.monthlyRent,
                rentParams.securityDeposit,
                rentParams.leaseDuration
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return contractFactory.interface.parseLog(log).name === 'RentContractCreated';
                } catch { return false; }
            });
            
            expect(event).to.not.be.undefined;
            const parsedEvent = contractFactory.interface.parseLog(event);
            const contractAddress = parsedEvent.args.contractAddress;
            
            console.log(`✅ Rent contract created at: ${contractAddress}`);
            console.log(`✅ Landlord key registered for evidence encryption`);
        });
        
        it("Should verify key can be queried by contract for evidence encryption", async function () {
            // Simulate what the frontend would do - batch query multiple party keys
            const parties = [landlord.address, tenant.address];
            const [publicKeys, keyIds, isValids] = await keyRegistry.batchGetActiveKeys(parties);
            
            expect(publicKeys.length).to.equal(2);
            expect(isValids[0]).to.be.true; // Landlord has key
            expect(isValids[1]).to.be.false; // Tenant has no key yet
            
            console.log(`✅ Landlord key available for encryption: ${ethers.hexlify(publicKeys[0])}`);
            console.log(`✅ Tenant has no key yet (expected)`);
        });
        
        it("Should handle key rotation scenario", async function () {
            // Register a new key for landlord
            const newPublicKey = ethers.getBytes("0x" + "b".repeat(128));
            
            await keyRegistry.connect(landlord).registerKey(
                newPublicKey,
                0,
                "Landlord rotated key"
            );
            
            // Set new key as active
            await keyRegistry.connect(landlord).setActiveKey(1);
            
            // Verify new key is active
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(landlord.address);
            expect(publicKey).to.equal(ethers.hexlify(newPublicKey));
            expect(keyId).to.equal(1);
            expect(isValid).to.be.true;
            
            console.log(`✅ Key rotation successful - new key ID: ${keyId}`);
        });
        
        it("Should handle emergency key revocation", async function () {
            // Revoke the active key
            await keyRegistry.connect(landlord).revokeKey(1, "Key compromise detected");
            
            // Should fallback to previous valid key
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(landlord.address);
            expect(publicKey).to.equal(ethers.hexlify(validPublicKey)); // Original key
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
            
            console.log(`✅ Emergency revocation handled - fallback to key ID: ${keyId}`);
        });
    });
    
    describe("Multi-Party Key Management", function () {
        it("Should register tenant key", async function () {
            const tenantKey = ethers.getBytes("0x" + "c".repeat(128));
            
            await keyRegistry.connect(tenant).registerKey(
                tenantKey,
                30 * 24 * 60 * 60, // 30 days
                "Tenant key for dispute evidence"
            );
            
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(tenant.address);
            expect(publicKey).to.equal(ethers.hexlify(tenantKey));
            expect(isValid).to.be.true;
            
            console.log(`✅ Tenant key registered for multi-party encryption`);
        });
        
        it("Should batch query all party keys for evidence encryption", async function () {
            const parties = [landlord.address, tenant.address];
            const [publicKeys, keyIds, isValids] = await keyRegistry.batchGetActiveKeys(parties);
            
            // Both parties should now have valid keys
            expect(isValids[0]).to.be.true; // Landlord
            expect(isValids[1]).to.be.true; // Tenant
            
            console.log(`✅ All parties have encryption keys available`);
            console.log(`   Landlord: ${ethers.hexlify(publicKeys[0]).slice(0, 20)}...`);
            console.log(`   Tenant: ${ethers.hexlify(publicKeys[1]).slice(0, 20)}...`);
        });
    });
    
    describe("Gas Optimization Analysis", function () {
        it("Should analyze gas costs for typical workflows", async function () {
            const gasData = {};
            
            // Key registration
            const regTx = await keyRegistry.connect(landlord).registerKey.populateTransaction(
                validPublicKey, 0, "Test key"
            );
            gasData.keyRegistration = await ethers.provider.estimateGas(regTx);
            
            // Batch query (2 parties)
            const batchTx = await keyRegistry.batchGetActiveKeys.populateTransaction([
                landlord.address, tenant.address
            ]);
            gasData.batchQuery2 = await ethers.provider.estimateGas(batchTx);
            
            // Batch query (5 parties)
            const fiveParties = Array(5).fill(landlord.address);
            const batch5Tx = await keyRegistry.batchGetActiveKeys.populateTransaction(fiveParties);
            gasData.batchQuery5 = await ethers.provider.estimateGas(batch5Tx);
            
            console.log(`📊 Gas Analysis:`);
            console.log(`   Key Registration: ${gasData.keyRegistration} gas`);
            console.log(`   Batch Query (2): ${gasData.batchQuery2} gas`);
            console.log(`   Batch Query (5): ${gasData.batchQuery5} gas`);
            
            // Verify reasonable gas costs
            expect(gasData.keyRegistration).to.be.lessThan(200000); // ~200k gas max
            expect(gasData.batchQuery2).to.be.lessThan(100000); // ~100k gas max
        });
    });
});