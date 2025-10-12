


import { validateIPFSEvidence, getEvidenceMetadata, generateEvidenceDigest } from '../modules/evidenceValidator.js';

async function testEvidenceValidation() {
  console.log('🧪 Testing Evidence Validation Module...\n');
  
  // Test valid CIDs
  const validCIDs = [
    'QmTest1234567890abcdef',
    'bafyTest1234567890abcdef',
    'QmValidEvidence123456789',
    'bafyValidAppeal987654321'
  ];
  
  // Test invalid CIDs
  const invalidCIDs = [
    'invalid-cid',
    'QmInvalidEvidence',
    'short',
    '',
    null
  ];
  
  console.log('Testing valid CIDs:');
  for (const cid of validCIDs) {
    const isValid = await validateIPFSEvidence(cid);
    console.log(`  ${cid}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
  }
  
  console.log('\nTesting invalid CIDs:');
  for (const cid of invalidCIDs) {
    const isValid = await validateIPFSEvidence(cid);
    console.log(`  ${cid || 'null'}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
  }
  
  // Test metadata
  console.log('\nTesting evidence metadata:');
  const testCID = 'QmTest1234567890abcdef';
  const metadata = await getEvidenceMetadata(testCID);
  console.log(`  Metadata for ${testCID}:`, metadata);
  
  // Test digest generation
  console.log('\nTesting digest generation:');
  const digest = generateEvidenceDigest(testCID);
  console.log(`  Digest for ${testCID}: ${digest}`);
  
  console.log('\n✅ Evidence validation tests completed!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testEvidenceValidation().catch(console.error);
}

export default testEvidenceValidation;