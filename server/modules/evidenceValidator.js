


import { ethers } from 'ethers';
import heliaStore from './heliaStore.js';

// No in-process Helia here; use the Helia HTTP API through heliaStore.



export async function validateIPFSEvidence(cid) {
  try {
    // Basic CID format validation
    if (!cid || typeof cid !== 'string') {
      console.log('❌ Invalid CID format:', cid);
      return false;
    }
    
    // CID should start with appropriate prefixes
    const validPrefixes = ['Qm', 'baf', 'bafy', 'bagu', 'bah'];
    const isValidPrefix = validPrefixes.some(prefix => cid.startsWith(prefix));
    
    if (!isValidPrefix) {
      console.log('❌ Invalid CID prefix:', cid.substring(0, 5));
      return false;
    }
    
    // Length validation (basic check)
    if (cid.length < 32 || cid.length > 100) {
      console.log('❌ Invalid CID length:', cid.length);
      return false;
    }
    
    // Use heliaStore to attempt to cat the CID and consider it valid if retrievable
    try {
      const content = await heliaStore.getEvidenceFromHelia(cid);
      if (content && content.length > 0) return true;
      return false;
    } catch (err) {
      console.log('Helia fetch failed for CID', cid, err.message || err);
      return false;
    }
    
  } catch (error) {
    console.error('Error validating IPFS evidence:', error);
    return false;
  }
}



async function mockIPFSValidation(cid) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
  
  // Mock validation logic
  const validationResults = {
    // Test CIDs that should pass
    'QmTest1234567890abcdef': true,
    'bafyTest1234567890abcdef': true,
    'QmValidEvidence123456789': true,
    'bafyValidAppeal987654321': true,
    
    // Test CIDs that should fail
    'QmInvalidEvidence': false,
    'bafyBadContent': false
  };
  
  // Check if it's a known test CID
  if (cid in validationResults) {
    const result = validationResults[cid];
    console.log(`🧪 Mock validation for ${cid}:`, result ? '✅ PASS' : '❌ FAIL');
    return result;
  }
  
  // For unknown CIDs, validate based on format
  const isValid = cid.length >= 40 && 
                  (cid.startsWith('Qm') || cid.startsWith('baf')) &&
                  !cid.includes('invalid') &&
                  !cid.includes('error');
  
  console.log(`🧪 Mock validation for ${cid}:`, isValid ? '✅ PASS' : '❌ FAIL');
  return isValid;
}



export async function getEvidenceMetadata(cid) {
  try {
    await initializeHelia();
    
    // Mock metadata for development
    if (heliaInstance.mock) {
      return {
        cid,
        size: Math.floor(Math.random() * 1000000) + 1000,
        type: 'application/json',
        pinned: true,
        accessible: true,
        timestamp: Date.now(),
        mock: true
      };
    }
    
    // Real implementation would fetch actual metadata
    

    
    return null;
    
  } catch (error) {
    console.error('Error getting evidence metadata:', error);
    return null;
  }
}



export async function validateEvidenceType(cid, allowedTypes = ['application/json', 'text/plain', 'image/jpeg', 'image/png']) {
  try {
    const metadata = await getEvidenceMetadata(cid);
    
    if (!metadata) {
      return false;
    }
    
    return allowedTypes.includes(metadata.type);
    
  } catch (error) {
    console.error('Error validating evidence type:', error);
    return false;
  }
}



export function generateEvidenceDigest(cid) {
  try {
    // Create a consistent hash of the CID for blockchain storage
    return ethers.keccak256(ethers.toUtf8Bytes(cid));
  } catch (error) {
    console.error('Error generating evidence digest:', error);
    throw new Error('Failed to generate evidence digest');
  }
}

// Module no longer performs in-process initialization; validation uses heliaStore on-demand.