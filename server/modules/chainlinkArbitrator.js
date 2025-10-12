// Chainlink Functions: chainlink_arbitrator.js - V7 Enhanced Implementation
// Implements Mitigation 4.5 (robust error handling) and 4.4 (financial precision using BigInt)
// Based on arbitration_specification_v7_final.md requirements

export const ARBITRATOR_API_URL = process.env.ARBITRATOR_API_URL || 'http://localhost:8000/arbitrate';
// FAILURE_CODE per spec: MAX_UINT256 - 1 (Mitigation 4.5)
export const FAILURE_CODE = (BigInt(2) ** BigInt(256)) - BigInt(2);



export async function handleRequest(args) {
  try {
    // Input validation
    if (!args || args.length !== 3) {
      console.error('Invalid arguments length:', args?.length);
      return FAILURE_CODE.toString();
    }

    const [contractText, evidenceText, disputeQuestion] = args;

    // Validate argument types and content
    if (typeof contractText !== 'string' || typeof evidenceText !== 'string' || typeof disputeQuestion !== 'string') {
      console.error('Invalid argument types');
      return FAILURE_CODE.toString();
    }

    if (!contractText.trim() || !evidenceText.trim() || !disputeQuestion.trim()) {
      console.error('Empty arguments provided');
      return FAILURE_CODE.toString();
    }

    // Build payload for AI Arbitrator API
    const payload = {
      contract_text: contractText,
      evidence_text: evidenceText,
      dispute_question: disputeQuestion
    };

    console.log('Sending request to AI Arbitrator API:', ARBITRATOR_API_URL);

    // Make HTTP request with timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    let response;
    try {
      response = await fetch(ARBITRATOR_API_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'ChainlinkFunctions/1.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error('Fetch error:', fetchError.message);
      return FAILURE_CODE.toString();
    }

    // Validate HTTP response
    if (!response.ok) {
      console.error('HTTP error:', response.status, response.statusText);
      return FAILURE_CODE.toString();
    }

    // Parse response body
    let responseText;
    try {
      responseText = await response.text();
    } catch (textError) {
      console.error('Error reading response text:', textError.message);
      return FAILURE_CODE.toString();
    }

    if (!responseText || responseText.trim().length === 0) {
      console.error('Empty response received');
      return FAILURE_CODE.toString();
    }

    // Parse JSON response
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (jsonError) {
      console.error('JSON parse error:', jsonError.message);
      return FAILURE_CODE.toString();
    }

    // Validate response structure
    if (typeof jsonResponse !== 'object' || jsonResponse === null) {
      console.error('Invalid response structure');
      return FAILURE_CODE.toString();
    }

    // Validate required fields per AI Arbitrator API spec
    if (typeof jsonResponse.reimbursement_amount_dai === 'undefined' || 
        typeof jsonResponse.final_verdict === 'undefined' ||
        typeof jsonResponse.rationale_summary === 'undefined') {
      console.error('Missing required fields in response');
      return FAILURE_CODE.toString();
    }

    // Validate and process reimbursement amount
    const amountDai = jsonResponse.reimbursement_amount_dai;
    if (typeof amountDai !== 'number' || !Number.isInteger(amountDai) || amountDai < 0) {
      console.error('Invalid reimbursement amount:', amountDai);
      return FAILURE_CODE.toString();
    }

    // Mitigation 4.4: Financial precision using BigInt
    // Convert DAI amount to Wei (assuming 18 decimals for both DAI and ETH)
    const amountDaiBigInt = BigInt(amountDai);
    const weiAmount = amountDaiBigInt * BigInt(10 ** 18);

    // Validate final amount doesn't exceed reasonable bounds
    const maxReasonableAmount = BigInt(10 ** 6) * BigInt(10 ** 18); // 1M ETH max
    if (weiAmount > maxReasonableAmount) {
      console.error('Amount exceeds reasonable bounds:', weiAmount.toString());
      return FAILURE_CODE.toString();
    }

    console.log('Arbitration successful:', {
      verdict: jsonResponse.final_verdict,
      amountDai: amountDai,
      weiAmount: weiAmount.toString()
    });

    // Return wei amount as decimal string for Chainlink Functions
    return weiAmount.toString();

  } catch (error) {
    // Mitigation 4.5: Catch-all error handler
    console.error('Unexpected error in handleRequest:', error.message);
    return FAILURE_CODE.toString();
  }
}

// ESM: exports above

// For Chainlink Functions runtime (if running as script)
if (typeof args !== 'undefined') {
  handleRequest(args).then(result => {
    console.log('Final result:', result);
    return result;
  }).catch(error => {
    console.error('Top-level error:', error);
    return FAILURE_CODE.toString();
  });
}
