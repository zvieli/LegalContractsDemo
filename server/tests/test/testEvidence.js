


import { validateHeliaEvidence, getEvidenceMetadata, generateEvidenceDigest } from '../../modules/evidenceValidator.js';

async function testEvidenceValidation() {
  console.log('🧪 Testing Evidence Validation Module...\n');
  
  // Test valid CIDs
  const validCIDs = [
    'bafybeitest1234567890abcdef0000000000000000000000000',
    'bafyTest1234567890abcdef',
    'bafybeitestvalidEvidence1234567890000000000000000000',
    'bafyValidAppeal987654321'
  ];
  
  // Test invalid CIDs
  const invalidCIDs = [
    'invalid-cid',
    'bafybeitestinvalidEvidence000000000000000000000000000',
    'short',
    '',
    null
  ];
  
  console.log('Testing valid CIDs:');
  for (const cid of validCIDs) {
    const isValid = await validateHeliaEvidence(cid);
    console.log(`  ${cid}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
  }
  
  console.log('\nTesting invalid CIDs:');
  for (const cid of invalidCIDs) {
    const isValid = await validateHeliaEvidence(cid);
    console.log(`  ${cid || 'null'}: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
  }
  
  // Test metadata
  console.log('\nTesting evidence metadata:');
  const testCID = 'bafybeitest1234567890abcdef0000000000000000000000000';
  const metadata = await getEvidenceMetadata(testCID);
  console.log(`  Metadata for ${testCID}:`, metadata);
  
  // Test digest generation
  console.log('\nTesting digest generation:');
  const digest = await generateEvidenceDigest(testCID);
  console.log(`  Digest for ${testCID}: ${digest}`);
  
  console.log('\n✅ Evidence validation tests completed!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testEvidenceValidation().catch(console.error);
}

export default testEvidenceValidation;