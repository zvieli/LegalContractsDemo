// --- NLP Verdict Mapping ---
function nlpVerdictMapping({ evidence_text, rationale }) {
  // --- Upgraded NLP verdict mapping ---
  // Critical keywords for verdict mapping
  const criticalKeywords = {
    PARTY_A_WINS: [
      "breach by party B", "liable party B", "penalty owed by party B", "breach of contract by vendor", "supplier failed", "vendor failed", "client wins", "party B at fault"
    ],
    PARTY_B_WINS: [
      "breach by party A", "liable party A", "penalty owed by party A", "breach of contract by client", "client failed", "party A at fault", "contractor wins",
      // positive contractor indicators
      "contractor completed", "fulfilled obligations", "fulfilled all contractual obligations", "submitted on schedule", "accepted by the client", "invoices were paid", "delivered on time"
    ],
    NO_PENALTY: [
      "no penalty", "no reimbursement", "unfounded claim", "no breach", "no financial loss", "no contractual damage", "no basis for reimbursement", "accepted without issue",
      // acceptance phrases
      "accepted the final deliverables", "client accepted", "no material financial loss", "payment was processed in full", "invoices were paid in full"
    ],
    DRAW: [
      "insufficient evidence", "unresolved", "mutually agreed", "partial settlement", "cannot determine", "fragmented", "unclear", "ambiguous", "both parties", "equally responsible"
    ]
  };


  // Helper: scan for critical keywords and return all matches per category
  function scanAllVerdicts(text) {
    const found = {};
    if (!text) return found;
    const lower = text.toLowerCase();
    for (const [verdict, keywords] of Object.entries(criticalKeywords)) {
      for (const k of keywords) {
        if (lower.includes(k)) {
          if (!found[verdict]) found[verdict] = new Set();
          found[verdict].add(k);
        }
      }
    }
    // Convert sets to arrays
    for (const k of Object.keys(found)) found[k] = Array.from(found[k]);
    return found;
  }

  const evidenceFound = scanAllVerdicts(evidence_text);
  const rationaleFound = scanAllVerdicts(rationale);
  const allFound = {};
  for (const v of Object.keys(criticalKeywords)) {
    allFound[v] = [ ...(evidenceFound[v] || []), ...(rationaleFound[v] || []) ];
  }

  // Decide mapped verdict using counts-based scoring and conflict rules
  // Compute counts per verdict and select the one with the highest support
  const counts = {};
  for (const v of Object.keys(criticalKeywords)) {
    counts[v] = (allFound[v] || []).length;
  }

  // If both DRAW and NO_PENALTY indicators are present, prefer DRAW (don't auto-map to NO_PENALTY)
  let mappedVerdict = undefined;
  let foundKeywords = [];
  if (counts['DRAW'] > 0 && counts['NO_PENALTY'] > 0) {
    mappedVerdict = 'DRAW';
    foundKeywords = [ ...(allFound['DRAW'] || []), ...(allFound['NO_PENALTY'] || []) ];
  } else if (counts['NO_PENALTY'] > 0 && counts['PARTY_B_WINS'] > 0) {
    // When both NO_PENALTY and PARTY_B_WINS appear, decide by strong acceptance indicators or counts
    const strongNoPenaltyIndicators = ['accepted the final deliverables', 'payment was processed in full', 'invoices were paid in full', 'waived penalties', 'client accepted', 'payment was processed', 'accepted without issue'];
    const noPenaltyKeywords = allFound['NO_PENALTY'] || [];
    const partyBKeywords = allFound['PARTY_B_WINS'] || [];
    const hasStrongNoPenalty = noPenaltyKeywords.some(k => strongNoPenaltyIndicators.some(s => k.includes(s)));
    if (hasStrongNoPenalty) {
      mappedVerdict = 'NO_PENALTY';
      foundKeywords = [ ...partyBKeywords, ...noPenaltyKeywords ];
    } else if ((partyBKeywords.length || 0) > (noPenaltyKeywords.length || 0)) {
      mappedVerdict = 'PARTY_B_WINS';
      foundKeywords = partyBKeywords;
    } else {
      mappedVerdict = 'NO_PENALTY';
      foundKeywords = noPenaltyKeywords;
    }
  } else {
    // Choose the verdict with the largest number of supporting keywords
    let best = null;
    let bestCount = 0;
    for (const [v, c] of Object.entries(counts)) {
      if (c > bestCount) { best = v; bestCount = c; }
    }
    if (best && bestCount > 0) {
      mappedVerdict = best;
      foundKeywords = allFound[best] || [];
    }
  }

  // Confidence: higher when multiple supporting keywords found
  // Boost NO_PENALTY slightly when strong acceptance/payment indicators exist
  let confidence = mappedVerdict ? Math.min(0.7 + (foundKeywords.length * 0.05), 0.95) : 0.4;
  const strongNoPenaltyIndicators = ['accepted the final deliverables', 'payment was processed in full', 'invoices were paid in full', 'waived penalties', 'client accepted', 'payment was processed'];
  if (mappedVerdict === 'NO_PENALTY') {
    const hasStrong = foundKeywords.some(k => strongNoPenaltyIndicators.some(s => k.includes(s)));
    if (hasStrong) confidence = Math.min(0.85 + (foundKeywords.length * 0.03), 0.98);
  }
  let source = mappedVerdict ? 'NLP' : 'NLP_LOW_CONFIDENCE';
  let rationaleOut = rationale || '';

  // Debug log
  console.log(`[NLP Mapping] evidenceFound:`, evidenceFound, `rationaleFound:`, rationaleFound, `mappedVerdict:`, mappedVerdict, `confidence:`, confidence, `foundKeywords:`, foundKeywords);

  return {
    verdict: mappedVerdict,
    confidence,
    rationale: rationaleOut,
    reimbursement: 0,
    source,
    foundKeywords
  };
}


  // --- Advanced merge logic ---
  function mergeArbitrationVerdicts(llmResult, nlpResult) {
    // --- Upgraded merge logic ---
    // Edge case: both undefined
    if ((!llmResult || typeof llmResult.verdict === 'undefined') && (!nlpResult || typeof nlpResult.verdict === 'undefined')) {
      console.log(`[MERGE] Both verdicts undefined → fallback to DRAW`);
      return {
        verdict: 'DRAW',
        confidence: 0.5,
        rationale: 'Both verdicts undefined',
        reimbursement: 0,
        source: 'FALLBACK'
      };
    }
    if (!llmResult) llmResult = {};
    if (!nlpResult) nlpResult = {};

    // Logging
    console.log(`[MERGE] LLM verdict:`, llmResult.verdict, `NLP mapped verdict:`, nlpResult.verdict, `LLM confidence:`, llmResult.confidence, `NLP confidence:`, nlpResult.confidence);

    // Rationale analysis for critical keywords
    const rationaleText = (llmResult.rationale || '').toLowerCase();
    const rationaleKeywords = [
      'insufficient evidence', 'unresolved', 'draw', 'no penalty', 'no reimbursement',
      'cannot determine', 'no dispute', 'no clear evidence', 'both parties', 'equally responsible',
      'fragmented', 'unclear', 'ambiguous', 'no financial loss', 'no contractual damage',
      'waived penalties', 'accepted without issue', 'no basis for reimbursement', 'no harm or loss', 'mutually agreed', 'partial settlement', 'unfounded claim'
    ];
    let rationaleFound = rationaleKeywords.filter(k => rationaleText.includes(k));
    console.log(`[MERGE] Rationale keywords found:`, rationaleFound);

    // Normalize LLM result first so we can reason over a known set
    const normalizedLLM = normalizeLLMResponse(llmResult);
    if (normalizedLLM && normalizedLLM.verdict) {
      // adopt normalized fields if not already present
      llmResult.verdict = llmResult.verdict || normalizedLLM.verdict;
      llmResult.confidence = llmResult.confidence || normalizedLLM.confidence;
      llmResult._normalizedKeywords = normalizedLLM.foundKeywords;
    }

    // Additional heuristics:
    const nlpFound = (nlpResult && nlpResult.foundKeywords) || [];
    const drawIndicators = ['insufficient evidence', 'fragmented', 'unclear', 'cannot determine', 'incomplete', 'no clear evidence', 'unresolved'];
    const noPenaltyIndicators = ['no penalty', 'no reimbursement', 'no financial loss', 'accepted', 'invoices were paid', 'payment was processed', 'accepted the final deliverables', 'client accepted'];
    const nlpHasDraw = nlpFound.some(k => drawIndicators.some(d => k.includes(d)));
    const nlpHasNoPenalty = nlpFound.some(k => noPenaltyIndicators.some(d => k.includes(d)));

    // If NLP found both draw-like and no-penalty indicators, prefer DRAW
    if (nlpHasDraw && nlpHasNoPenalty) {
      console.log('[MERGE] NLP indicates both DRAW and NO_PENALTY -> prefer DRAW');
      return { verdict: 'DRAW', confidence: Math.max(nlpResult.confidence || 0.6, 0.6), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_CONFLICT_PREFER_DRAW' };
    }

    // If NLP strongly indicates NO_PENALTY (accepted/payment) with high confidence and LLM is lower confidence, prefer NLP NO_PENALTY
    if (nlpResult && nlpResult.verdict === 'NO_PENALTY' && (nlpResult.confidence || 0) >= 0.8 && (llmResult.confidence || 0) < 0.8 && (nlpHasNoPenalty)) {
      console.log('[MERGE] NLP strongly indicates NO_PENALTY and LLM is lower confidence -> prefer NLP NO_PENALTY');
      return { verdict: 'NO_PENALTY', confidence: nlpResult.confidence, rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_STRONG_OVERRIDE' };
    }

    // If NLP indicates PARTY_B_WINS and LLM suggests NO_PENALTY with low or medium confidence, prefer NLP PARTY_B_WINS
    if (nlpResult && nlpResult.verdict === 'PARTY_B_WINS' && llmResult && llmResult.verdict === 'NO_PENALTY' && ((llmResult.confidence || 0) < 0.75)) {
      console.log('[MERGE] NLP indicates PARTY_B_WINS while LLM suggested NO_PENALTY with low/medium confidence -> prefer NLP PARTY_B_WINS');
      return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.8, 0.8), rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_OVERRIDE_PARTY_B' };
    }

    // Decision logic
    let finalVerdict, finalConfidence, finalSource, finalRationale, finalReimbursement;

    // 1. If LLM verdict is defined and confidence high, take it — but allow a strong NLP to override
    if (llmResult.verdict && (llmResult.confidence || 0) >= 0.75) {
      // If NLP has a higher confidence by margin, prefer NLP
      const nlpOverLc = (nlpResult && (nlpResult.confidence || 0) - (llmResult.confidence || 0) >= 0.12);
      if (nlpOverLc && nlpResult.verdict) {
        finalVerdict = nlpResult.verdict;
        finalConfidence = nlpResult.confidence;
        finalSource = 'NLP_OVERRIDES_HIGH_LLM';
        finalRationale = nlpResult.rationale;
        finalReimbursement = nlpResult.reimbursement || 0;
      } else {
        finalVerdict = llmResult.verdict;
        finalConfidence = llmResult.confidence;
        finalSource = 'LLM_HIGH_CONFIDENCE';
        finalRationale = llmResult.rationale;
        finalReimbursement = llmResult.reimbursement || 0;
      }
    }
    // 2. If LLM verdict is undefined or low confidence, use NLP mapping if available (prefer NLP when defined)
    else if (nlpResult.verdict) {
      finalVerdict = nlpResult.verdict;
      finalConfidence = nlpResult.confidence;
      finalSource = 'NLP_HIGH_CONFIDENCE';
      finalRationale = nlpResult.rationale;
      finalReimbursement = nlpResult.reimbursement || 0;
    }
    // 3. If both verdicts exist but disagree, analyze rationale and confidence
    else if (llmResult.verdict && nlpResult.verdict && llmResult.verdict !== nlpResult.verdict) {
      // If rationale contains DRAW/NO_PENALTY keywords, override
      if (rationaleFound.length > 0) {
        // If rationale contains both 'insufficient' and 'no penalty' prefer DRAW
        if (rationaleText.includes('insufficient') && (rationaleText.includes('no penalty') || rationaleText.includes('no reimbursement'))) {
          finalVerdict = 'DRAW';
        } else {
          finalVerdict = (rationaleText.includes('no penalty') || rationaleText.includes('no reimbursement')) ? 'NO_PENALTY' : 'DRAW';
        }
        finalConfidence = Math.max(llmResult.confidence || 0.7, nlpResult.confidence || 0.5);
        finalSource = 'LLM_RATIONALE_OVERRIDE';
        finalRationale = 'LLM rationale override: ' + llmResult.rationale;
        finalReimbursement = llmResult.reimbursement || 0;
      } else {
        // Weighted decision: prefer higher confidence
        if ((llmResult.confidence || 0) > (nlpResult.confidence || 0)) {
          finalVerdict = llmResult.verdict;
          finalConfidence = llmResult.confidence;
          finalSource = 'LLM_WEIGHTED';
          finalRationale = llmResult.rationale;
          finalReimbursement = llmResult.reimbursement || 0;
        } else {
          finalVerdict = nlpResult.verdict;
          finalConfidence = nlpResult.confidence;
          finalSource = 'NLP_WEIGHTED';
          finalRationale = nlpResult.rationale;
          finalReimbursement = nlpResult.reimbursement || 0;
        }
      }
    }
    // 4. If rationale contains DRAW/NO_PENALTY keywords, override
    else if (rationaleFound.length > 0) {
      // If rationale contains both 'insufficient' and 'no penalty' prefer DRAW
      if (rationaleText.includes('insufficient') && (rationaleText.includes('no penalty') || rationaleText.includes('no reimbursement'))) {
        finalVerdict = 'DRAW';
      } else {
        finalVerdict = (rationaleText.includes('no penalty') || rationaleText.includes('no reimbursement')) ? 'NO_PENALTY' : 'DRAW';
      }
      finalConfidence = Math.max(llmResult.confidence || 0.7, nlpResult.confidence || 0.5);
      finalSource = 'LLM_RATIONALE_OVERRIDE';
      finalRationale = 'LLM rationale override: ' + llmResult.rationale;
      finalReimbursement = llmResult.reimbursement || 0;
    }
    // 5. If only one verdict is defined, use it (even if low confidence)
    else if (llmResult.verdict) {
      finalVerdict = llmResult.verdict;
      finalConfidence = llmResult.confidence || 0.5;
      finalSource = 'LLM_ONLY';
      finalRationale = llmResult.rationale;
      finalReimbursement = llmResult.reimbursement || 0;
    } else if (nlpResult.verdict) {
      // If NLP strongly indicates PARTY_B_WINS but LLM suggested NO_PENALTY earlier, prefer PARTY_B_WINS
      if (nlpResult.verdict === 'PARTY_B_WINS' && llmResult.verdict === 'NO_PENALTY') {
        finalVerdict = 'PARTY_B_WINS';
        finalConfidence = Math.max(nlpResult.confidence || 0.8, llmResult.confidence || 0.5);
        finalSource = 'NLP_OVERRIDE';
        finalRationale = nlpResult.rationale;
        finalReimbursement = nlpResult.reimbursement || 0;
      } else {
        finalVerdict = nlpResult.verdict;
        finalConfidence = nlpResult.confidence || 0.5;
        finalSource = 'NLP_ONLY';
        finalRationale = nlpResult.rationale;
        finalReimbursement = nlpResult.reimbursement || 0;
      }
    } else {
      // Fallback only if no other indication
      finalVerdict = 'DRAW';
      finalConfidence = 0.5;
      finalSource = 'FALLBACK';
      finalRationale = 'No verdicts defined';
      finalReimbursement = 0;
    }

    // If LLM and NLP agree, boost confidence
    if (llmResult.verdict && nlpResult.verdict && llmResult.verdict === nlpResult.verdict) {
      finalConfidence = Math.min(Math.max(finalConfidence, (llmResult.confidence || 0.7)) + 0.1, 1);
      finalSource = 'AGREEMENT';
    }

    // Normalize verdict
    const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'DRAW', 'NO_PENALTY'];
    if (!validVerdicts.includes(finalVerdict)) {
      finalVerdict = 'DRAW';
    }

    // Debug log
    console.log(`[MERGE] Final merged verdict:`, finalVerdict, `Confidence:`, finalConfidence, `Source:`, finalSource);

    // Normalize output
    return {
      verdict: finalVerdict,
      confidence: Math.min(finalConfidence, 1),
      rationale: finalRationale,
      reimbursement: finalReimbursement,
      source: finalSource
    };
}

// Parse and validate the target output schema
function validateResponse(responseText) {
  try {
    // Accept a broader set of free-form verdict phrases and map them to canonical labels
    const rawVerdict = (responseText.match(/VERDICT:\s*([^\n\r]+)/i) || [null,null])[1];
    let verdictMatch = null;
    if (rawVerdict) {
      const v = rawVerdict.trim().toLowerCase();
      if (v.match(/party\s*a|client|breach of contract|supplier failed|vendor failed/)) verdictMatch = [null, 'PARTY_A_WINS'];
      else if (v.match(/party\s*b|contractor|in favor of the contractor|in favor|contractor wins/)) verdictMatch = [null, 'PARTY_B_WINS'];
      else if (v.match(/no penalty|no reimbursement|none|no basis for reimbursement|no dispute/)) verdictMatch = [null, 'NO_PENALTY'];
      else if (v.match(/insufficient|unresolved|draw|cannot determine|mutually agreed|unclear|ambiguous/)) verdictMatch = [null, 'DRAW'];
    }
    const reimbursementMatch = responseText.match(/REIMBURSEMENT:\s*([\d\$%\.\s\w]+)/i);
    // Confidence may be numeric or a word like HIGH/MEDIUM/LOW or "8/10" or "80%"
    const confidenceMatch = responseText.match(/CONFIDENCE:\s*([0-9]{1,3}%?|\d(?:\.\d+)?|high|low|medium|moderate|\d\/10|\(\d+\/10\))/i);
    // Improved rationale extraction: allow for missing double newlines, fallback to everything after RATIONALE:
    let rationaleMatch = responseText.match(/RATIONALE:\s*([\s\S]*?)(?=\n[A-Z_]+:|$)/i);
    if (!rationaleMatch) {
      rationaleMatch = responseText.match(/RATIONALE:\s*([\s\S]*)/i);
    }

    const missing = [];
    if (!verdictMatch) missing.push('VERDICT');
    if (!rationaleMatch || !rationaleMatch[1] || rationaleMatch[1].trim().length < 10) missing.push('RATIONALE');

    if (missing.length) {
      return { valid: false, message: `Missing: ${missing.join(', ')}`, missing, hasContent: responseText.length > 50 };
    }

    // Normalise confidence strings to numeric 0..1
    let conf = undefined;
    if (confidenceMatch && confidenceMatch[1]) {
      const raw = confidenceMatch[1].toString();
      if (/high/i.test(raw)) conf = 0.9;
      else if (/low/i.test(raw)) conf = 0.2;
      else if (/med|moderate/i.test(raw)) conf = 0.6;
      else if (/\d+%/.test(raw)) conf = parseFloat(raw.replace('%',''))/100;
      else if (/\d+\/10/.test(raw)) conf = parseFloat(raw.split('/')[0])/10;
      else if (!isNaN(parseFloat(raw))) conf = parseFloat(raw);
    }

    return {
      valid: true,
      verdict: (verdictMatch && verdictMatch[1]) ? verdictMatch[1].toUpperCase() : (verdictMatch ? verdictMatch[1] : undefined),
      reimbursement: reimbursementMatch ? (parseFloat(reimbursementMatch[1].replace(/[^0-9\.]/g,'')) || 0) : 0,
      confidence: typeof conf === 'number' ? conf : 0.7,
      rationale: rationaleMatch ? rationaleMatch[1].trim() : ''
    };
  } catch {
    return { valid: false, message: 'Validation error', hasContent: false };
  }
}

// Normalize free-form LLM response into our target verdicts using the same critical keywords
function normalizeLLMResponse(llmRaw) {
  if (!llmRaw) return { verdict: undefined, confidence: undefined, foundKeywords: [] };
  const text = (llmRaw.response || llmRaw || '').toString();
  const lower = text.toLowerCase();

  const mapping = {
    PARTY_A_WINS: ["breach of contract", "breach by party b", "vendor failed", "supplier failed", "liable by party b", "client wins", "party b at fault"],
    PARTY_B_WINS: ["breach by party a", "liable by party a", "client failed", "contractor wins", "party a at fault"],
    NO_PENALTY: ["no penalty", "no reimbursement", "unfounded claim", "no breach", "no financial loss", "accepted without issue", "no basis for reimbursement"],
    DRAW: ["insufficient evidence", "unresolved", "mutually agreed", "partial settlement", "cannot determine", "both parties", "equally responsible", "fragmented", "unclear"]
  };

  for (const [verdict, keys] of Object.entries(mapping)) {
    for (const k of keys) {
      if (lower.includes(k)) {
        // Try to extract CONFIDENCE if present in text
        const confMatch = text.match(/CONFIDENCE:\s*([0-9]{1,3}%?|\d(?:\.\d+)?|high|low|medium|moderate|\d\/10)/i);
        let conf = confMatch ? confMatch[1] : (llmRaw.confidence || undefined);
        // Normalise textual confidences if necessary
        if (typeof conf === 'string') {
          if (/high/i.test(conf)) conf = 0.9;
          else if (/low/i.test(conf)) conf = 0.2;
          else if (/med|moderate/i.test(conf)) conf = 0.6;
          else if (/\d+%/.test(conf)) conf = parseFloat(conf.replace('%',''))/100;
          else if (/\d+\/10/.test(conf)) conf = parseFloat(conf.split('/')[0])/10;
          else conf = parseFloat(conf);
        }
        // Heuristic: if LLM explicitly states a party-wins or breach phrase but no numeric confidence, assume it's high-confidence
        if (typeof conf === 'undefined' || Number.isNaN(conf)) {
          if (verdict === 'PARTY_A_WINS' || verdict === 'PARTY_B_WINS') conf = 0.85;
          else if (verdict === 'NO_PENALTY') conf = 0.75;
          else conf = 0.6; // DRAW or ambiguous
        }
        return { verdict, confidence: conf, foundKeywords: [k], normalizedText: text };
      }
    }
  }

  // If no direct keyword found, attempt to parse structural VERDICT lines like "VERDICT: ..."
  const verdictLine = text.match(/VERDICT:\s*([A-Z_\s]+)/i);
  if (verdictLine) {
    const v = verdictLine[1].trim().toLowerCase();
    // Heuristic confidences for structural verdict lines
    if (v.includes('breach') || v.includes('vendor') || v.includes('supplier') || v.includes('in favor of the client') || v.includes('in favor of the claimant')) return { verdict: 'PARTY_A_WINS', confidence: llmRaw.confidence || 0.85, foundKeywords: [verdictLine[1]] };
    if (v.includes('contractor') || v.includes('in favor of the contractor') || v.includes('in favor') || v.includes('contractor wins')) return { verdict: 'PARTY_B_WINS', confidence: llmRaw.confidence || 0.85, foundKeywords: [verdictLine[1]] };
    if (v.includes('unfounded') || v.includes('no reimbursement') || v.includes('no penalty') || v.includes('none')) return { verdict: 'NO_PENALTY', confidence: llmRaw.confidence || 0.75, foundKeywords: [verdictLine[1]] };
    if (v.includes('insufficient') || v.includes('unresolved') || v.includes('draw') || v.includes('cannot determine')) return { verdict: 'DRAW', confidence: llmRaw.confidence || 0.6, foundKeywords: [verdictLine[1]] };
  }

  return { verdict: undefined, confidence: llmRaw.confidence || undefined, foundKeywords: [] };
}

// Adaptive chunking thresholds
const CHUNK_STRATEGIES = {
  aggressive: { maxSize: 6000, timeout: 45000 },
  balanced: { maxSize: 4000, timeout: 60000 },
  conservative: { maxSize: 2000, timeout: 90000 }
};
let currentStrategy = 'balanced';
let lastProcessingTime = 0;
function selectChunkStrategy() {
  if (lastProcessingTime > 120000) currentStrategy = 'conservative';
  else if (lastProcessingTime < 30000) currentStrategy = 'aggressive';
  else currentStrategy = 'balanced';
  return CHUNK_STRATEGIES[currentStrategy];
}

// Core Ollama call (with configurable num_predict)
async function callOllama(prompt, timeout = 200000, useSmallModel = false, numPredict = 400) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const modelName = useSmallModel ? 'llama3.2:1b' : 'llama3.2:latest';
  const start = Date.now();
  try {
    console.log('🟡 [callOllama] Sending prompt to Ollama:', prompt);
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt,
        stream: false,
        options: { temperature: 0.25, top_p: 0.9, top_k: 40, num_predict: numPredict }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.error('🔴 [callOllama] Ollama API error:', response.status, response.statusText);
      throw new Error(`Ollama API error: ${response.status}`);
    }
    const json = await response.json();
    console.log('🟢 [callOllama] Ollama response:', JSON.stringify(json));
    return { response: json.response, processingTime: Date.now() - start, model: modelName };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('🔴 [callOllama] Error:', err);
    if (err.name === 'AbortError') throw new Error(`Ollama request timed out after ${timeout / 1000}s`);
    throw err;
  }
}

// --- Merge Arbitration Verdicts ---

// ESM export (if using type: "module" in package.json)
// Process arbitration payload using Ollama and our NLP+merge pipeline
async function processV7ArbitrationWithOllama(payload = {}) {
  try {
    const evidence_text = payload.evidence_text || payload.evidence || payload.evidenceText || payload.text || '';
    const contract_text = payload.contract_text || payload.contract_text || payload.contractText || 'GENERIC CONTRACT FOR TESTING';
    const dispute_id = payload.dispute_id || payload.disputeId || payload.caseId || 'unknown';

    const prompt = `EVIDENCE:\n${evidence_text}\nCONTRACT:\n${contract_text}\nDISPUTE_ID: ${dispute_id}\n\nPlease provide VERDICT, RATIONALE, CONFIDENCE, REIMBURSEMENT.`;

    const raw = await callOllama(prompt, 200000, false, 400);
    const responseText = raw.response || '';

    // Try formal validation first
    const validated = validateResponse(responseText);
    let llmResult = {};
    if (validated && validated.valid) {
      llmResult = {
        verdict: validated.verdict,
        confidence: validated.confidence,
        rationale: validated.rationale,
        reimbursement: validated.reimbursement
      };
    } else {
      // Normalize free-form response
      const normalized = normalizeLLMResponse({ response: responseText, confidence: undefined });
      llmResult = {
        verdict: normalized.verdict,
        confidence: normalized.confidence,
        rationale: responseText,
        reimbursement: normalized.reimbursement || 0
      };
    }

    const nlpResult = nlpVerdictMapping({ evidence_text, rationale: llmResult.rationale });
    const merged = mergeArbitrationVerdicts(llmResult, nlpResult);

    return {
      decision: merged.verdict,
      arbitration: merged.verdict,
      reasoning: merged.rationale,
      confidence: merged.confidence,
      source: merged.source,
      raw: responseText
    };
  } catch (err) {
    console.error('[OLLAMA] processV7ArbitrationWithOllama error:', err);
    throw err;
  }
}

// Minimal Ollama arbitrator object used by other modules for health checks
const ollamaLLMArbitrator = {
  async getStats() {
    return { healthy: true, model: 'llama3.2', ollama: 'local' };
  },
  process: processV7ArbitrationWithOllama
};

export { nlpVerdictMapping, mergeArbitrationVerdicts, validateResponse, callOllama, processV7ArbitrationWithOllama, ollamaLLMArbitrator };
// For CommonJS, uncomment below:
// module.exports = { nlpVerdictMapping, splitToChunks, summarizeChunksConcurrently };

