import { expect } from "chai";
import pkg from "hardhat";

const { ethers } = pkg;

describe.skip("Key Management Live Deployment Test (skipped - external dependency)", function () {
    let keyRegistry;
    let owner, user1;
    
    // Valid ECIES public key (64 bytes raw bytes)
    const validPublicKey = ethers.getBytes("0x" + "a".repeat(128));
    
    before(async function () {
        [owner, user1] = await ethers.getSigners();
        
        // Connect to deployed RecipientKeyRegistry
        const keyRegistryAddress = "0x7fAB7AEAB965240986e42729210Cf6E9Fdf26A5f";
        const KeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
        keyRegistry = KeyRegistry.attach(keyRegistryAddress);
        
        console.log(`✅ Connected to RecipientKeyRegistry at: ${keyRegistryAddress}`);
    });
    
    describe("Live Contract Interaction", function () {
        it("Should connect to deployed contract and read state", async function () {
            // Test basic contract interaction
            const defaultLifetime = await keyRegistry.defaultKeyLifetime();
            expect(defaultLifetime).to.be.greaterThan(0);
            
            console.log(`✅ Default key lifetime: ${defaultLifetime} seconds`);
        });
        
        it("Should register a key on live contract", async function () {
            const tx = await keyRegistry.connect(user1).registerKey(
                validPublicKey,
                0, // Use default lifetime
                "Live test key"
            );
            
            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
            
            console.log(`✅ Key registered successfully. Gas used: ${receipt.gasUsed}`);
        });
        
        it("Should query the registered key", async function () {
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            
            expect(publicKey).to.equal(ethers.hexlify(validPublicKey));
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
            
            console.log(`✅ Key query successful:`);
            console.log(`   Key ID: ${keyId}`);
            console.log(`   Valid: ${isValid}`);
            console.log(`   Public Key: ${ethers.hexlify(publicKey).slice(0, 20)}...`);
        });
        
        it("Should perform batch query for multiple users", async function () {
            const accounts = [user1.address, owner.address];
            const [publicKeys, keyIds, isValids] = await keyRegistry.batchGetActiveKeys(accounts);
            
            expect(publicKeys.length).to.equal(2);
            expect(isValids[0]).to.be.true; // user1 has key
            expect(isValids[1]).to.be.false; // owner has no key
            
            console.log(`✅ Batch query successful:`);
            console.log(`   User1 has key: ${isValids[0]}`);
            console.log(`   Owner has key: ${isValids[1]}`);
        });
        
        it("Should test key rotation workflow", async function () {
            // Register second key
            const newKey = ethers.getBytes("0x" + "b".repeat(128));
            const regTx = await keyRegistry.connect(user1).registerKey(
                newKey,
                7 * 24 * 60 * 60, // 7 days
                "Rotated key"
            );
            await regTx.wait();
            
            // Set as active
            const activeTx = await keyRegistry.connect(user1).setActiveKey(1);
            await activeTx.wait();
            
            // Verify new key is active
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            expect(publicKey).to.equal(ethers.hexlify(newKey));
            expect(keyId).to.equal(1);
            expect(isValid).to.be.true;
            
            console.log(`✅ Key rotation successful to key ID: ${keyId}`);
        });
        
        it("Should test emergency revocation", async function () {
            // Revoke current active key (key 1)
            const revokeTx = await keyRegistry.connect(user1).revokeKey(1, "Test revocation");
            await revokeTx.wait();
            
            // Should fallback to previous key (key 0)
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            expect(publicKey).to.equal(ethers.hexlify(validPublicKey));
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
            
            console.log(`✅ Emergency revocation successful, fallback to key ID: ${keyId}`);
        });
    });
    
    describe("Gas Analysis on Live Network", function () {
        it("Should analyze real gas costs", async function () {
            // Test gas estimation for common operations
            const testKey = ethers.getBytes("0x" + "c".repeat(128));
            
            const regGas = await keyRegistry.connect(user1).registerKey.estimateGas(
                testKey, 0, "Gas test key"
            );
            
            const queryGas = await keyRegistry.getActiveKey.estimateGas(user1.address);
            
            const batchGas = await keyRegistry.batchGetActiveKeys.estimateGas([
                user1.address, owner.address
            ]);
            
            console.log(`📊 Live Gas Analysis:`);
            console.log(`   Register Key: ${regGas} gas`);
            console.log(`   Query Key: ${queryGas} gas`);
            console.log(`   Batch Query (2): ${batchGas} gas`);
            
            // Verify reasonable gas costs
            expect(regGas).to.be.lessThan(300000);
            expect(queryGas).to.be.lessThan(50000);
            expect(batchGas).to.be.lessThan(100000);
        });
    });
});