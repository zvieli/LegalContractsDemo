import { expect } from "chai";
import pkg from "hardhat";

const { ethers } = pkg;

describe("RecipientKeyRegistry Security & Key Management", function () {
    let keyRegistry;
    let owner, user1, user2, user3;
    
    // Valid ECIES public key (64 bytes raw bytes)
    const validPublicKey1 = ethers.getBytes("0x" + "a".repeat(128));  // Convert hex string to bytes
    const validPublicKey2 = ethers.getBytes("0x" + "b".repeat(128));
    const validPublicKey3 = ethers.getBytes("0x" + "c".repeat(128));
    
    before(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        
        const RecipientKeyRegistry = await ethers.getContractFactory("RecipientKeyRegistry");
        keyRegistry = await RecipientKeyRegistry.deploy();
        await keyRegistry.waitForDeployment();
    });
    
    describe("Key Registration & Validation", function () {
        it("Should register a valid key successfully", async function () {
            const tx = await keyRegistry.connect(user1).registerKey(
                validPublicKey1,
                0, // Use default lifetime
                "Primary landlord key"
            );
            
            await expect(tx)
                .to.emit(keyRegistry, "KeyRegistered")
                .withArgs(user1.address, 0, validPublicKey1, (timestamp) => timestamp > 0, (timestamp) => timestamp > 0);
                
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            expect(ethers.hexlify(publicKey)).to.equal(ethers.hexlify(validPublicKey1));
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
        });
        
        it("Should reject invalid key length", async function () {
            const invalidKey = ethers.getBytes("0x1234"); // Too short
            
            await expect(
                keyRegistry.connect(user1).registerKey(invalidKey, 0, "")
            ).to.be.revertedWithCustomError(keyRegistry, "InvalidPublicKey");
        });
        
        it("Should reject invalid key lifetime", async function () {
            const oneDay = 24 * 60 * 60;
            const fourYears = 4 * 365 * 24 * 60 * 60;
            
            // Too short
            await expect(
                keyRegistry.connect(user1).registerKey(validPublicKey2, oneDay, "")
            ).to.be.revertedWithCustomError(keyRegistry, "KeyLifetimeOutOfRange");
            
            // Too long
            await expect(
                keyRegistry.connect(user1).registerKey(validPublicKey2, fourYears, "")
            ).to.be.revertedWithCustomError(keyRegistry, "KeyLifetimeOutOfRange");
        });
        
        it("Should allow multiple keys per user", async function () {
            await keyRegistry.connect(user1).registerKey(validPublicKey2, 0, "Backup key");
            
            const keyCount = await keyRegistry.keyCount(user1.address);
            expect(keyCount).to.equal(2);
        });
        
        it("Should allow setting active key", async function () {
            const tx = await keyRegistry.connect(user1).setActiveKey(1);
            
            await expect(tx)
                .to.emit(keyRegistry, "ActiveKeyChanged")
                .withArgs(user1.address, 0, 1);
                
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            expect(publicKey).to.equal(ethers.hexlify(validPublicKey2));
            expect(keyId).to.equal(1);
            expect(isValid).to.be.true;
        });
    });
    
    describe("Key Revocation & Security", function () {
        it("Should allow key owner to revoke their own key", async function () {
            const tx = await keyRegistry.connect(user1).revokeKey(1, "Compromised key");
            
            await expect(tx)
                .to.emit(keyRegistry, "KeyRevoked")
                .withArgs(user1.address, 1, "Compromised key");
        });
        
        it("Should automatically switch to valid key after revocation", async function () {
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user1.address);
            expect(ethers.hexlify(publicKey)).to.equal(ethers.hexlify(validPublicKey1)); // Should fall back to key 0
            expect(keyId).to.equal(0);
            expect(isValid).to.be.true;
        });
        
        it("Should prevent using revoked key", async function () {
            await expect(
                keyRegistry.connect(user1).setActiveKey(1)
            ).to.be.revertedWithCustomError(keyRegistry, "KeyAlreadyRevoked");
        });
        
        it("Should allow emergency revocation by owner", async function () {
            await keyRegistry.connect(user2).registerKey(validPublicKey3, 0, "User2 key");
            
            const tx = await keyRegistry.emergencyRevokeKey(user2.address, 0, "Court order");
            
            await expect(tx)
                .to.emit(keyRegistry, "KeyRevoked")
                .withArgs(user2.address, 0, "Court order");
        });
        
        it("Should prevent non-owner from emergency revocation", async function () {
            await expect(
                keyRegistry.connect(user1).emergencyRevokeKey(user2.address, 0, "Unauthorized")
            ).to.be.revertedWithCustomError(keyRegistry, "OwnableUnauthorizedAccount");
        });
    });
    
    describe("Key Expiration", function () {
        it("Should handle expired keys correctly", async function () {
            const sevenDays = 7 * 24 * 60 * 60; // 7 days in seconds
            
            await keyRegistry.connect(user3).registerKey(validPublicKey1, sevenDays, "Short-lived key");
            
            // Fast forward time by making many blocks
            for (let i = 0; i < 10; i++) {
                await ethers.provider.send("evm_increaseTime", [sevenDays / 10]);
                await ethers.provider.send("evm_mine");
            }
            
            await expect(
                keyRegistry.connect(user3).setActiveKey(0)
            ).to.be.revertedWithCustomError(keyRegistry, "KeyExpiredError");
        });
        
        it("Should report expired keys as invalid", async function () {
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(user3.address);
            expect(isValid).to.be.false;
        });
    });
    
    describe("Batch Operations", function () {
        before(async function () {
            // Setup fresh keys for batch testing - use accounts that don't have expired keys
            const accounts = await ethers.getSigners();
            const freshUser1 = accounts[4];
            const freshUser2 = accounts[5];
            const freshUser3 = accounts[6]; // This user will have no keys
            
            await keyRegistry.connect(freshUser1).registerKey(validPublicKey1, 0, "Batch test key 1");
            await keyRegistry.connect(freshUser2).registerKey(validPublicKey2, 0, "Batch test key 2");
            
            // Update the test to use fresh users
            this.testUser1 = freshUser1;
            this.testUser2 = freshUser2;
            this.testUser3 = freshUser3;
        });
        
        it("Should batch query active keys", async function () {
            const accounts = [this.testUser1.address, this.testUser2.address, this.testUser3.address];
            const [publicKeys, keyIds, isValids] = await keyRegistry.batchGetActiveKeys(accounts);
            
            expect(publicKeys.length).to.equal(3);
            expect(keyIds.length).to.equal(3);
            expect(isValids.length).to.equal(3);
            
            // User1 and User2 should have valid keys, User3 has no keys
            expect(isValids[0]).to.be.true;
            expect(isValids[1]).to.be.true;
            expect(isValids[2]).to.be.false; // User3 has no keys
        });
        
        it("Should paginate key retrieval", async function () {
            const [keyIds, publicKeys, validFroms, validUntils, revokeds, metadatas] = 
                await keyRegistry.getKeys(user1.address, 0, 10);
            
            expect(keyIds.length).to.be.greaterThan(0);
            expect(publicKeys.length).to.equal(keyIds.length);
            expect(metadatas.length).to.equal(keyIds.length);
        });
    });
    
    describe("Policy Management", function () {
        it("Should allow owner to update lifetime policies", async function () {
            const newDefault = 180 * 24 * 60 * 60; // 180 days
            const newMin = 1 * 24 * 60 * 60;      // 1 day
            const newMax = 730 * 24 * 60 * 60;    // 2 years
            
            await keyRegistry.updateKeyLifetimePolicies(newDefault, newMin, newMax);
            
            expect(await keyRegistry.defaultKeyLifetime()).to.equal(newDefault);
            expect(await keyRegistry.minKeyLifetime()).to.equal(newMin);
            expect(await keyRegistry.maxKeyLifetime()).to.equal(newMax);
        });
        
        it("Should prevent non-owner from updating policies", async function () {
            await expect(
                keyRegistry.connect(user1).updateKeyLifetimePolicies(100, 50, 200)
            ).to.be.revertedWithCustomError(keyRegistry, "OwnableUnauthorizedAccount");
        });
    });
    
    describe("Edge Cases & Error Handling", function () {
        it("Should handle account with no keys", async function () {
            const accounts = await ethers.getSigners();
            const freshUser = accounts[10]; // Use a fresh account with no keys
            const [publicKey, keyId, isValid] = await keyRegistry.getActiveKey(freshUser.address);
            
            expect(publicKey).to.equal("0x");
            expect(keyId).to.equal(ethers.MaxUint256);
            expect(isValid).to.be.false;
        });
        
        it("Should handle non-existent key validation", async function () {
            const isValid = await keyRegistry.isKeyValid(user1.address, 999);
            expect(isValid).to.be.false;
        });
        
        it("Should handle empty batch query", async function () {
            const [publicKeys, keyIds, isValids] = await keyRegistry.batchGetActiveKeys([]);
            
            expect(publicKeys.length).to.equal(0);
            expect(keyIds.length).to.equal(0);
            expect(isValids.length).to.equal(0);
        });
        
        it("Should handle out-of-range pagination", async function () {
            const [keyIds] = await keyRegistry.getKeys(user1.address, 1000, 10);
            expect(keyIds.length).to.equal(0);
        });
    });
});

// Helper functions for flexible value matching
function isPositiveNumber(value) {
    return typeof value === 'bigint' && value > 0n;
}