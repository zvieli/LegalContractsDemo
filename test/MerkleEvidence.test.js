import { expect } from 'chai';
import hre from 'hardhat';
const { ethers } = hre;
import { MerkleEvidenceHelper, EvidenceBatcher } from '../utils/merkleEvidenceHelper.js';

describe('Merkle Evidence System', function() {
    let merkleEvidenceManager;
    let owner, submitter, uploader1, uploader2;

    beforeEach(async function() {
        [owner, submitter, uploader1, uploader2] = await ethers.getSigners();
        
        const MerkleEvidenceManager = await ethers.getContractFactory('MerkleEvidenceManager');
        merkleEvidenceManager = await MerkleEvidenceManager.deploy();
        await merkleEvidenceManager.waitForDeployment();
    });

    describe('MerkleEvidenceHelper (off-chain)', function() {
        let helper;

        beforeEach(function() {
            helper = new MerkleEvidenceHelper();
        });

        it('should add evidence items correctly', function() {
            const evidence = {
                caseId: 1,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('test content')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('test-cid')),
                uploader: uploader1.address,
                timestamp: Math.floor(Date.now() / 1000)
            };

            helper.addEvidence(evidence);
            expect(helper.getEvidenceCount()).to.equal(1);
            
            const retrieved = helper.getEvidenceItem(0);
            expect(retrieved.caseId).to.equal(BigInt(evidence.caseId));
            expect(retrieved.uploader).to.equal(evidence.uploader);
        });

        it('should build Merkle tree and generate proofs', function() {
            const evidences = [
                {
                    caseId: 1,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content1')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid1')),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000)
                },
                {
                    caseId: 2,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content2')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid2')),
                    uploader: uploader2.address,
                    timestamp: Math.floor(Date.now() / 1000) + 1
                }
            ];

            evidences.forEach(evidence => helper.addEvidence(evidence));

            const root = helper.getRoot();
            expect(root).to.be.a('string');
            expect(root).to.match(/^0x[a-fA-F0-9]{64}$/);

            const proof0 = helper.getProof(0);
            const proof1 = helper.getProof(1);
            
            expect(proof0).to.be.an('array');
            expect(proof1).to.be.an('array');

            // Verify proofs locally
            const evidence0ForVerify = {
                caseId: BigInt(evidences[0].caseId),
                contentDigest: evidences[0].contentDigest,
                cidHash: evidences[0].cidHash,
                uploader: evidences[0].uploader,
                timestamp: BigInt(evidences[0].timestamp)
            };
            const evidence1ForVerify = {
                caseId: BigInt(evidences[1].caseId),
                contentDigest: evidences[1].contentDigest,
                cidHash: evidences[1].cidHash,
                uploader: evidences[1].uploader,
                timestamp: BigInt(evidences[1].timestamp)
            };
            expect(helper.verifyProof(evidence0ForVerify, proof0, root)).to.be.true;
            expect(helper.verifyProof(evidence1ForVerify, proof1, root)).to.be.true;
        });

        it('should export and import batches correctly', function() {
            const evidence = {
                caseId: 1,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('test')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('test-cid')),
                uploader: uploader1.address,
                timestamp: Math.floor(Date.now() / 1000)
            };

            helper.addEvidence(evidence);
            const exported = helper.exportBatch();

            expect(exported.merkleRoot).to.be.a('string');
            expect(exported.evidenceCount).to.equal(1);
            expect(exported.proofs).to.have.property('0');

            const newHelper = new MerkleEvidenceHelper();
            newHelper.importBatch(exported);

            expect(newHelper.getRoot()).to.equal(exported.merkleRoot);
            expect(newHelper.getEvidenceCount()).to.equal(1);
        });
    });

    describe('EvidenceBatcher', function() {
        let batcher;

        beforeEach(function() {
            batcher = new EvidenceBatcher(3); // Small batch size for testing
        });

        it('should auto-finalize when batch is full', function() {
            const evidences = [
                {
                    caseId: 1,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content1')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid1')),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000)
                },
                {
                    caseId: 2,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content2')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid2')),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000) + 1
                },
                {
                    caseId: 3,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content3')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid3')),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000) + 2
                }
            ];

            let result1 = batcher.addEvidence(evidences[0]);
            let result2 = batcher.addEvidence(evidences[1]);
            expect(result1).to.be.null;
            expect(result2).to.be.null;

            let result3 = batcher.addEvidence(evidences[2]);
            expect(result3).to.not.be.null;
            expect(result3.evidenceCount).to.equal(3);

            expect(batcher.getCompletedBatches()).to.have.length(1);
            expect(batcher.getCurrentBatchStatus().itemCount).to.equal(0);
        });
    });

    describe('MerkleEvidenceManager (on-chain)', function() {
        it('should submit evidence batch and verify proofs', async function() {
            const helper = new MerkleEvidenceHelper();
            
            const evidences = [
                {
                    caseId: 1,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content1')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid1')),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000)
                },
                {
                    caseId: 2,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content2')),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid2')),
                    uploader: uploader2.address,
                    timestamp: Math.floor(Date.now() / 1000) + 1
                }
            ];

            evidences.forEach(evidence => helper.addEvidence(evidence));
            
            const batchData = helper.createBatchData();
            
            // Submit batch to contract
            const tx = await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
            const receipt = await tx.wait();
            
            expect(receipt.logs).to.have.length.greaterThan(0);
            
            // Get batch ID from event
            const event = receipt.logs.find(log => 
                log.fragment && log.fragment.name === 'BatchCreated'
            );
            expect(event).to.not.be.undefined;
            const batchId = event.args.batchId;

            // Verify first evidence item
            const proof0 = helper.getProof(0);
            const evidence0 = helper.getEvidenceItem(0);
            
            await expect(
                merkleEvidenceManager.verifyEvidence(batchId, evidence0, proof0)
            ).to.emit(merkleEvidenceManager, 'EvidenceVerified')
             .withArgs(batchId, evidence0.caseId, evidence0.cidHash, evidence0.uploader, evidence0.contentDigest);

            // Check that evidence is marked as verified
            const isVerified = await merkleEvidenceManager.isEvidenceVerified(evidence0);
            expect(isVerified).to.be.true;

            // Verify second evidence item
            const proof1 = helper.getProof(1);
            const evidence1 = helper.getEvidenceItem(1);
            
            await expect(
                merkleEvidenceManager.verifyEvidence(batchId, evidence1, proof1)
            ).to.emit(merkleEvidenceManager, 'EvidenceVerified');
        });

        it('should prevent duplicate Merkle roots', async function() {
            const helper = new MerkleEvidenceHelper();
            helper.addEvidence({
                caseId: 1,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('test')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('test-cid')),
                uploader: uploader1.address,
                timestamp: Math.floor(Date.now() / 1000)
            });

            const batchData = helper.createBatchData();
            
            // First submission should succeed
            await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);

            // Second submission with same root should fail
            await expect(
                merkleEvidenceManager.connect(submitter)
                    .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount)
            ).to.be.revertedWith('Merkle root already used');
        });

        it('should prevent invalid Merkle proofs', async function() {
            const helper = new MerkleEvidenceHelper();
            helper.addEvidence({
                caseId: 1,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('content1')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('cid1')),
                uploader: uploader1.address,
                timestamp: Math.floor(Date.now() / 1000)
            });

            const batchData = helper.createBatchData();
            
            // Submit batch
            const tx = await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
            const receipt = await tx.wait();
            const batchId = receipt.logs[0].args.batchId;

            // Try to verify with wrong evidence item
            const wrongEvidence = {
                caseId: 999,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('wrong')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('wrong-cid')),
                uploader: uploader2.address,
                timestamp: Math.floor(Date.now() / 1000)
            };

            const proof = helper.getProof(0); // Valid proof for different evidence

            await expect(
                merkleEvidenceManager.verifyEvidence(batchId, wrongEvidence, proof)
            ).to.be.revertedWith('Invalid Merkle proof');
        });

        it('should finalize batches correctly', async function() {
            const helper = new MerkleEvidenceHelper();
            helper.addEvidence({
                caseId: 1,
                contentDigest: ethers.keccak256(ethers.toUtf8Bytes('test')),
                cidHash: ethers.keccak256(ethers.toUtf8Bytes('test-cid')),
                uploader: uploader1.address,
                timestamp: Math.floor(Date.now() / 1000)
            });

            const batchData = helper.createBatchData();
            
            const tx = await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
            const receipt = await tx.wait();
            const batchId = receipt.logs[0].args.batchId;

            // Finalize batch
            await expect(
                merkleEvidenceManager.connect(submitter).finalizeBatch(batchId)
            ).to.emit(merkleEvidenceManager, 'BatchFinalized')
             .withArgs(batchId, batchData.merkleRoot);

            // Check finalization status
            const batch = await merkleEvidenceManager.getBatch(batchId);
            expect(batch.finalized).to.be.true;

            // Should not be able to finalize again
            await expect(
                merkleEvidenceManager.connect(submitter).finalizeBatch(batchId)
            ).to.be.revertedWith('Already finalized');
        });
    });

    describe('Gas Optimization Analysis', function() {
        it('should measure gas costs for batch vs individual submissions', async function() {
            const helper = new MerkleEvidenceHelper();
            
            // Add multiple evidence items
            const evidenceCount = 10;
            for (let i = 0; i < evidenceCount; i++) {
                helper.addEvidence({
                    caseId: i + 1,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes(`content${i}`)),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes(`cid${i}`)),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000) + i
                });
            }

            const batchData = helper.createBatchData();
            
            // Measure gas for batch submission
            const batchTx = await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
            const batchReceipt = await batchTx.wait();
            const batchGas = batchReceipt.gasUsed;

            console.log(`Batch submission gas: ${batchGas}`);
            console.log(`Per evidence (batch): ${batchGas / BigInt(evidenceCount)}`);
            console.log(`Traditional per evidence: ~79,000 gas`);
            console.log(`Gas savings: ${((79000n * BigInt(evidenceCount) - batchGas) * 100n) / (79000n * BigInt(evidenceCount))}%`);

            // Verify gas savings are significant
            const traditionalTotalGas = 79000n * BigInt(evidenceCount);
            expect(batchGas).to.be.lessThan(traditionalTotalGas);
            
            // Should save at least 60% for 10 items
            const savings = ((traditionalTotalGas - batchGas) * 100n) / traditionalTotalGas;
            expect(savings).to.be.greaterThan(60n);
        });

        it('should measure verification gas costs', async function() {
            const helper = new MerkleEvidenceHelper();
            
            // Add evidence items
            for (let i = 0; i < 5; i++) {
                helper.addEvidence({
                    caseId: i + 1,
                    contentDigest: ethers.keccak256(ethers.toUtf8Bytes(`content${i}`)),
                    cidHash: ethers.keccak256(ethers.toUtf8Bytes(`cid${i}`)),
                    uploader: uploader1.address,
                    timestamp: Math.floor(Date.now() / 1000) + i
                });
            }

            const batchData = helper.createBatchData();
            
            // Submit batch
            const batchTx = await merkleEvidenceManager.connect(submitter)
                .submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
            const batchReceipt = await batchTx.wait();
            const batchId = batchReceipt.logs[0].args.batchId;

            // Measure verification gas
            const evidence0 = helper.getEvidenceItem(0);
            const proof0 = helper.getProof(0);
            
            const verifyTx = await merkleEvidenceManager.verifyEvidence(batchId, evidence0, proof0);
            const verifyReceipt = await verifyTx.wait();
            const verifyGas = verifyReceipt.gasUsed;

            console.log(`Evidence verification gas: ${verifyGas}`);
            
            // Verification should be reasonably efficient
            expect(verifyGas).to.be.lessThan(100000n);
        });
    });
});