// --- NLP Verdict Mapping ---
function nlpVerdictMapping({ evidence_text, rationale }) {
  // --- Upgraded NLP verdict mapping ---
  // Critical keywords for verdict mapping
  const criticalKeywords = {
    PARTY_A_WINS: [
      "breach by party B", "liable party B", "penalty owed by party B", "breach of contract by vendor", "supplier failed", "vendor failed", "client wins", "party B at fault",
      "breaches", "withheld", "non-compliance", "substandard", "incomplete", "failing", "failed"
    ],
    PARTY_B_WINS: [
      "breach by party A", "liable party A", "penalty owed by party A", "breach of contract by client", "client failed", "party A at fault", "contractor wins",
      // positive contractor indicators
      "contractor completed", "completed all deliverables", "fulfilled obligations", "fulfilled all contractual obligations", "submitted on schedule", "accepted by the client", "invoices were paid", "delivered on time", "passed testing", "all modules passed testing", "accepted after review"
    ],
    NO_PENALTY: [
      "no penalty", "no reimbursement", "unfounded claim", "no breach", "no financial loss", "no contractual damage", "no basis for reimbursement", "accepted without issue",
      // acceptance phrases
      "accepted the final deliverables", "client accepted", "no material financial loss", "payment was processed in full", "invoices were paid in full",
      // confirmation/acceptance variants
      "confirmed acceptance", "client confirmed acceptance", "confirmed in writing", "confirmed in a meeting", "accepted all deliverables", "no payments are withheld", "payment was processed",
      "agreed to accept", "no harm", "no penalties necessary", "no penalties specified"
    ],
    DRAW: [
      "insufficient evidence", "unresolved", "mutually agreed", "partial settlement", "cannot determine", "fragmented", "unclear", "ambiguous", "both parties", "equally responsible",
      "incomplete", "inconsistent", "no clear evidence", "cannot be determined"
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
  const lowerEvidence = (evidence_text || '').toLowerCase();

  // Strict conclusive pattern: detect completion signals + exculpatory language (no-evidence-of-late / unfounded)
  // Use regex-based detection to avoid brittle exact-string matches (handles punctuation, unicode quotes, dates)
  const completionRegex = /\b(complet(?:e|ed)|fulfil|fulfilled|fulfilment|fulfilled obligations|passed testing|all modules passed testing|delivered on time|submitted on schedule|completed all deliverables)\b/i;
  const exculpatoryRegex = /\b(no evidence of (late|late delivery)|no evidence of late|unfounded|complaint appears to be unfounded|no evidence of late delivery or breach)\b/i;
  const acceptedRegex = /\b(accepted (after review|the final deliverables|by the client|in writing|in a meeting)|invoices were paid in full|invoices were paid|payment was processed in full|payment was processed)\b/i;
  const strongCompletion = completionRegex.test(evidence_text || '') || completionRegex.test(rationale || '');
  const exculpatory = exculpatoryRegex.test(evidence_text || '') || exculpatoryRegex.test(rationale || '');
  const accepted = acceptedRegex.test(evidence_text || '') || acceptedRegex.test(rationale || '');
  const conclusiveCompletion = strongCompletion && exculpatory && !accepted;
  // expose a flag to the merger for strict evidence-based overrides
  const strongCompletionEvidenceFlag = conclusiveCompletion;
  if (conclusiveCompletion) {
    const pk = [ 'completed all deliverables', 'all modules passed testing', 'unfounded' ];
    console.log('[NLP Mapping] Evidence matches conclusive completion + exculpatory language -> prefer PARTY_B_WINS', pk);
    return {
      verdict: 'PARTY_B_WINS',
      confidence: 0.98,
      rationale: rationale || '',
      reimbursement: 0,
      source: 'NLP_EVIDENCE_CONCLUSIVE',
      foundKeywords: Array.from(new Set(Object.values(evidenceFound).flat())),
      mappedFoundKeywords: pk,
      strongCompletionEvidence: true
    };
  }
  // If evidence text itself contains direct PARTY_B_WINS signals, prefer those
  // immediately — evidence should trump stray rationale tokens.
  // If evidence text itself contains direct PARTY_B_WINS signals, prefer those
  // immediately — evidence should trump stray rationale tokens. Also consider
  // strong contractor indicators within evidence (synonyms) to make the rule robust.
  const evidencePartyB = (evidenceFound['PARTY_B_WINS'] || []).slice();
  const strongPartyBIndicators = ['contractor completed', 'completed all deliverables', 'fulfilled obligations', 'fulfilled all contractual obligations', 'submitted on schedule', 'delivered on time', 'passed testing', 'all modules passed testing', 'accepted after review', 'accepted by the client'];
  const evidenceStrongMatches = evidencePartyB.concat(Object.values(evidenceFound).flat().filter(k => strongPartyBIndicators.some(s => k.includes(s))));
  if (evidenceStrongMatches.length > 0) {
    // If evidence also contains strong acceptance/payment indicators and/or explicit
    // no-material-loss phrases, prefer NO_PENALTY in many cases (client accepted work).
    const acceptanceIndicators = ['accepted the final deliverables', 'payment was processed in full', 'invoices were paid', 'invoices were paid in full', 'accepted by the client', 'payment was processed', 'confirmed in writing', 'confirmed acceptance'];
    const noMaterialLossIndicators = ['no material financial loss', 'no financial loss', 'no contractual damage', 'no material loss'];
    const acceptanceMatches = (evidenceFound['NO_PENALTY'] || []).concat(Object.values(evidenceFound).flat().filter(k => acceptanceIndicators.some(s => k.includes(s))));
    const noMaterialMatches = (evidenceFound['NO_PENALTY'] || []).filter(k => noMaterialLossIndicators.some(s => k.includes(s))).concat(Object.values(evidenceFound).flat().filter(k => noMaterialLossIndicators.some(s => k.includes(s))));
    const pk = Array.from(new Set(evidenceStrongMatches));
    // If acceptance + explicit no-material-loss exists, prefer NO_PENALTY
    if (acceptanceMatches.length > 0 && noMaterialMatches.length > 0) {
      const ak = Array.from(new Set(acceptanceMatches));
      console.log('[NLP Mapping] Evidence contains contractor completion BUT also acceptance+no-material-loss -> prefer NO_PENALTY', ak.concat(noMaterialMatches));
      return {
        verdict: 'NO_PENALTY',
        confidence: Math.min(0.8 + (ak.length * 0.03), 0.98),
        rationale: rationale || '',
        reimbursement: 0,
        source: 'NLP_EVIDENCE_ACCEPTANCE_OVER_COMPLETION',
        foundKeywords: Array.from(new Set(Object.values(evidenceFound).flat())),
        mappedFoundKeywords: ak
      };
    }
    // If acceptance indicators exist but no explicit no-material-loss, make a simple
    // comparison: if acceptance indicators are as numerous or more numerous than
    // contractor completion indicators, prefer NO_PENALTY; otherwise prefer PARTY_B_WINS.
    const acceptanceCount = acceptanceMatches.length;
    const completionCount = pk.length;
    if (acceptanceCount > 0 && acceptanceCount >= completionCount) {
      const ak = Array.from(new Set(acceptanceMatches));
      console.log('[NLP Mapping] Evidence contains contractor completion and acceptance indicators -> prefer NO_PENALTY by count', { acceptanceCount, completionCount });
      return {
        verdict: 'NO_PENALTY',
        confidence: Math.min(0.75 + (ak.length * 0.03), 0.95),
        rationale: rationale || '',
        reimbursement: 0,
        source: 'NLP_EVIDENCE_ACCEPTANCE_COUNT_PREFERENCE',
        foundKeywords: Array.from(new Set(Object.values(evidenceFound).flat())),
        mappedFoundKeywords: ak
      };
    }
    // Default: contractor completion signals without sufficient acceptance/no-loss -> PARTY_B_WINS
    console.log('[NLP Mapping] Evidence contains PARTY_B_WINS strong signals -> prefer PARTY_B_WINS', pk);
    return {
      verdict: 'PARTY_B_WINS',
      confidence: Math.min(0.85 + (pk.length * 0.03), 0.99),
      rationale: rationale || '',
      reimbursement: 0,
      source: 'NLP_EVIDENCE_STRONG',
      foundKeywords: Array.from(new Set(Object.values(evidenceFound).flat())),
      mappedFoundKeywords: pk
    };
  }
  const allFound = {};
  for (const v of Object.keys(criticalKeywords)) {
    allFound[v] = [ ...(evidenceFound[v] || []), ...(rationaleFound[v] || []) ];
  }

  // Combined list of all found keywords across verdict categories (deduped)
  const combinedFoundKeywords = Array.from(new Set(Object.values(allFound).flat()));

  // Decide mapped verdict using weighted scoring and conflict rules.
  // Give higher weight to keywords found in the evidence_text (evidenceFound) than
  // those only present in the LLM rationale, so the raw evidence drives the NLP mapping
  // instead of noisy LLM rationale text.
  const counts = {};
  const weightedCounts = {};
  for (const v of Object.keys(criticalKeywords)) {
    const eCount = (evidenceFound[v] || []).length;
    const rCount = (rationaleFound[v] || []).length;
    counts[v] = eCount + rCount;
    // weight evidence matches heavier (x2) so they dominate conflicting rationale-only signals
    weightedCounts[v] = (eCount * 2) + rCount;
  }

  // Decide mappedVerdict using weightedCounts; prefer DRAW only when its weighted support
  // genuinely exceeds NO_PENALTY's weighted support (avoid defaulting to DRAW when LLM rationale
  // contains a stray 'both parties' but the evidence strongly supports another outcome).
  let mappedVerdict = undefined;
  let foundKeywords = [];
    if ((weightedCounts['DRAW'] || 0) > 0 && (weightedCounts['NO_PENALTY'] || 0) > 0 && (weightedCounts['DRAW'] > weightedCounts['NO_PENALTY'])) {
      mappedVerdict = 'DRAW';
      foundKeywords = [ ...(allFound['DRAW'] || []), ...(allFound['NO_PENALTY'] || []) ];
    } else if ((weightedCounts['NO_PENALTY'] || 0) > 0 && (weightedCounts['PARTY_B_WINS'] || 0) > 0) {
    // When both NO_PENALTY and PARTY_B_WINS appear, decide by stronger indicators.
    // Order of precedence:
    // 1) explicit waiver phrases (very strong -> NO_PENALTY)
    // 2) strong contractor completion indicators -> PARTY_B_WINS
    // 3) explicit acceptance/payment indicators -> NO_PENALTY
    const strongNoPenaltyIndicators = ['waived penalties', 'no penalties necessary', 'no penalties were necessary', 'no penalties claimed', 'waived any penalties', 'client waived', 'no penalty necessary'];
    const noPenaltyKeywords = allFound['NO_PENALTY'] || [];
    const partyBKeywords = allFound['PARTY_B_WINS'] || [];
    const hasStrongNoPenalty = noPenaltyKeywords.some(k => strongNoPenaltyIndicators.some(s => k.includes(s)));
    // Strong contractor indicators should bias toward PARTY_B_WINS
    const strongPartyBIndicators = ['contractor completed', 'fulfilled obligations', 'fulfilled all contractual obligations', 'submitted on schedule', 'delivered on time', 'accepted by the client', 'passed testing', 'accepted'];
  // include explicit completion phrasing
  if (!strongPartyBIndicators.includes('completed all deliverables')) strongPartyBIndicators.push('completed all deliverables');
    const strongAcceptanceIndicators = ['accepted the final deliverables', 'payment was processed in full', 'invoices were paid', 'invoices were paid in full', 'accepted by the client', 'payment was processed'];
    const hasStrongPartyB = partyBKeywords.some(k => strongPartyBIndicators.some(s => k.includes(s)));
    const hasStrongAcceptance = noPenaltyKeywords.some(k => strongAcceptanceIndicators.some(s => k.includes(s)));

    // If explicit waiver/strong no-penalty indicators exist, prefer NO_PENALTY
    if (hasStrongNoPenalty) {
      // Explicit waiver wins
      mappedVerdict = 'NO_PENALTY';
      foundKeywords = [ ...partyBKeywords, ...noPenaltyKeywords ];
    } else if (hasStrongPartyB) {
      // If contractor completed strongly and payments/acceptance are present, prefer PARTY_B_WINS
      const hasPayment = noPenaltyKeywords.some(k => strongAcceptanceIndicators.some(s => k.includes(s))) || partyBKeywords.some(k => k.includes('invoices were paid'));
      if (hasPayment || hasStrongPartyB) {
        mappedVerdict = 'PARTY_B_WINS';
        foundKeywords = partyBKeywords;
      } else {
        mappedVerdict = 'PARTY_B_WINS';
        foundKeywords = partyBKeywords;
      }
    } else if (hasStrongAcceptance) {
      // Acceptance/payment indicators prefer NO_PENALTY but only when combined with
      // explicit waiver or an explicit "no material loss" signal. This avoids mapping
      // to NO_PENALTY on mere invoice/payment presence when contractor completed work.
      const hasNoMaterialLoss = noPenaltyKeywords.some(k => k.includes('no material financial loss') || k.includes('no financial loss') || k.includes('no contractual damage'));
      const hasExplicitWaiver = noPenaltyKeywords.some(k => strongNoPenaltyIndicators.some(s => k.includes(s)));
      if (hasExplicitWaiver || hasNoMaterialLoss) {
        mappedVerdict = 'NO_PENALTY';
        foundKeywords = noPenaltyKeywords;
      } else {
        // leave undecided here; let later weighted logic choose
        mappedVerdict = undefined;
        foundKeywords = [];
      }
    } else if ((partyBKeywords.length || 0) > (noPenaltyKeywords.length || 0)) {
      mappedVerdict = 'PARTY_B_WINS';
      foundKeywords = partyBKeywords;
    } else {
      mappedVerdict = 'NO_PENALTY';
      foundKeywords = noPenaltyKeywords;
    }
  } else {
    // Choose the verdict with the largest number of supporting keywords, preferring DRAW when counts are equal
    let best = null;
    let bestCount = 0;
    for (const [v, c] of Object.entries(counts)) {
      if (c > bestCount || (c === bestCount && v === 'DRAW')) {
        best = v;
        bestCount = c;
      }
    }
    if (best && bestCount > 0) {
      mappedVerdict = best;
      foundKeywords = allFound[best] || [];
    }
  }

  // Confidence: higher when multiple supporting keywords found
  // Boost NO_PENALTY slightly when strong acceptance/payment indicators exist
  let confidence = mappedVerdict ? Math.min(0.7 + (foundKeywords.length * 0.05), 0.95) : 0.4;
  const strongNoPenaltyIndicators = ['waived penalties', 'no penalties necessary', 'no penalties were necessary', 'no penalties claimed', 'waived any penalties', 'client waived', 'no penalty necessary'];
  if (mappedVerdict === 'NO_PENALTY') {
    const hasStrong = foundKeywords.some(k => strongNoPenaltyIndicators.some(s => k.includes(s)));
    if (hasStrong) confidence = Math.min(0.85 + (foundKeywords.length * 0.03), 0.98);
  }
  let source = mappedVerdict ? 'NLP' : 'NLP_LOW_CONFIDENCE';
  let rationaleOut = rationale || '';

  // Debug log
  console.log(`[NLP Mapping flags] strongCompletion:${strongCompletion}, exculpatory:${exculpatory}, accepted:${accepted}, conclusiveCompletion:${conclusiveCompletion}`);
  console.log(`[NLP Mapping] evidenceFound:`, evidenceFound, `rationaleFound:`, rationaleFound, `mappedVerdict:`, mappedVerdict, `confidence:`, confidence, `foundKeywords:`, foundKeywords);

  return {
    verdict: mappedVerdict,
    confidence,
    rationale: rationaleOut,
    reimbursement: 0,
    source,
    // Return both the keywords that supported the mapped verdict and the full set
    foundKeywords: combinedFoundKeywords,
    mappedFoundKeywords: foundKeywords
    , strongCompletionEvidence: strongCompletionEvidenceFlag || false
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

    // Top-level safety: if NLP mapping found a strict conclusive completion signal in the evidence
    // (strongCompletionEvidence), prefer PARTY_B_WINS immediately. This is a targeted rule for
    // cases where the evidence explicitly states completion + exculpatory language (e.g. "completed all deliverables" + "unfounded" / "no evidence of late").
    if (nlpResult && nlpResult.strongCompletionEvidence) {
      console.log('[MERGE] Top-level NLP strict completion evidence -> prefer PARTY_B_WINS (immediate override)');
      return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.95, 0.9), rationale: nlpResult.rationale || '', reimbursement: nlpResult.reimbursement || 0, source: 'NLP_STRICT_EVIDENCE_TOP_OVERRIDE' };
    }

      // Helper: normalize confidence to 0..1 (defensive) - accepts strings, percentages, /10, or raw numbers
      function normalizeConfidence(c) {
        if (typeof c === 'string') {
          const s = c.trim();
          if (/\d+%$/.test(s)) return Math.min(parseFloat(s.replace('%',''))/100, 1);
          if (/\d+\/10$/.test(s)) return Math.min(parseFloat(s.split('/')[0])/10, 1);
          if (!isNaN(parseFloat(s))) return Math.min(parseFloat(s), 1);
          if (/high/i.test(s)) return 0.9;
          if (/low/i.test(s)) return 0.2;
          if (/med|moderate/i.test(s)) return 0.6;
          return undefined;
        }
        if (typeof c === 'number') {
          if (c > 1) {
            // if likely 0-10 scale
            if (c <= 10) return Math.min(c/10, 1);
            // if percent-like
            if (c <= 100) return Math.min(c/100, 1);
            return Math.min(c/100, 1);
          }
          return c;
        }
        return undefined;
      }

      // Normalize existing confidence fields defensively
      llmResult.confidence = normalizeConfidence(llmResult.confidence) || llmResult.confidence || 0;
      nlpResult.confidence = normalizeConfidence(nlpResult.confidence) || nlpResult.confidence || 0;

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

  // Additional heuristics: prefer mappedFoundKeywords (the keywords the NLP mapping chose)
  // for scoring and decision logic; fall back to foundKeywords if mapped not available.
  const nlpFound = (nlpResult && (nlpResult.mappedFoundKeywords && nlpResult.mappedFoundKeywords.length ? nlpResult.mappedFoundKeywords : nlpResult.foundKeywords)) || [];
    const drawIndicators = ['insufficient evidence', 'fragmented', 'unclear', 'cannot determine', 'incomplete', 'no clear evidence', 'unresolved'];
    const noPenaltyIndicators = ['no penalty', 'no reimbursement', 'no financial loss', 'accepted', 'invoices were paid', 'payment was processed', 'accepted the final deliverables', 'client accepted'];
    const nlpHasDraw = nlpFound.some(k => drawIndicators.some(d => k.includes(d)));
    const nlpHasNoPenalty = nlpFound.some(k => noPenaltyIndicators.some(d => k.includes(d)));

    // If NLP indicates both PARTY_B_WINS and NO_PENALTY but we see explicit acceptance/payment phrases,
    // prefer NO_PENALTY because the client accepted the work and payments were processed.
    const partyBIndicators = ['fulfilled obligations', 'delivered on time', 'contractor completed', 'fulfilled all contractual obligations', 'submitted on schedule'];
    const acceptanceIndicators = ['accepted the final deliverables', 'payment was processed in full', 'invoices were paid', 'client accepted', 'no penalties necessary', 'no penalties claimed'];
    const nlpHasPartyB = nlpFound.some(k => partyBIndicators.some(p => k.includes(p)));
    const nlpHasAcceptance = nlpFound.some(k => acceptanceIndicators.some(p => k.includes(p)));
    // Strong completion checks used later in merge decisions
    const hasStrongCompleted = nlpFound.some(k => k.includes('completed all deliverables') || k.includes('fulfilled all contractual obligations') || k.includes('fulfilled obligations') || k.includes('all modules passed testing') || k.includes('passed testing') || k.includes('accepted after review'));
    if (nlpHasPartyB && nlpHasNoPenalty && nlpHasAcceptance) {
      // Use a small scoring heuristic to decide when contractor success should be treated as a WIN vs when acceptance/payment indicates NO_PENALTY.
      const partyBScore = nlpFound.reduce((s,k) => s + (partyBIndicators.some(p => k.includes(p)) ? 1 : 0), 0);
      const noPenaltyScore = nlpFound.reduce((s,k) => s + (acceptanceIndicators.some(p => k.includes(p)) ? 1 : 0), 0);
      // bonuses
  const hasStrongCompleted = nlpFound.some(k => k.includes('completed all deliverables') || k.includes('fulfilled all contractual obligations') || k.includes('fulfilled obligations'));
  const hasNoMaterialLoss = nlpFound.some(k => k.includes('no material financial loss') || k.includes('no financial loss'));
  const hasPayment = nlpFound.some(k => k.includes('payment') || k.includes('invoices were paid') || k.includes('payment was processed') || k.includes('invoices were paid in full'));
  // Slightly reduce completion bonus, increase payment/no-loss bonuses to prefer NO_PENALTY when acceptance + no material loss exist
  // Increase completion bonus to make contractor success more decisive
  const completionBonus = hasStrongCompleted ? 1.0 : 0;
  // Reduce no-material-loss bonus slightly to avoid tipping to NO_PENALTY too easily
  const noMaterialLossBonus = hasNoMaterialLoss ? 0.6 : 0;
  // Reduce payment bonus to avoid payment-only turning the scale
  const paymentBonus = hasPayment ? 0.4 : 0;
  let scoreParty = partyBScore + completionBonus;
  let scoreNoPenalty = noPenaltyScore + noMaterialLossBonus + paymentBonus;
      console.log('[MERGE] partyBScore', partyBScore, 'noPenaltyScore', noPenaltyScore, 'scoreParty', scoreParty, 'scoreNoPenalty', scoreNoPenalty);
      if (scoreParty > scoreNoPenalty + 0.15) {
        console.log('[MERGE] Scoring prefers PARTY_B_WINS');
        return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.8, 0.8), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_SCORING_PREFER_PARTY_B' };
      }
      if (scoreNoPenalty > scoreParty + 0.15) {
        console.log('[MERGE] Scoring prefers NO_PENALTY');
        return { verdict: 'NO_PENALTY', confidence: Math.max(nlpResult.confidence || 0.75, 0.75), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_SCORING_PREFER_NO_PENALTY' };
      }
      // Close scores: make tie-breaker smarter
      const scoreDiff = Math.abs(scoreParty - scoreNoPenalty);
      if (scoreDiff <= 0.2) {
        // If both acceptance/payment and no-material-loss indicators present, prefer NO_PENALTY
        if (hasNoMaterialLoss && hasPayment) {
          console.log('[MERGE] Close scores but acceptance + no material loss -> prefer NO_PENALTY');
          return { verdict: 'NO_PENALTY', confidence: Math.max(nlpResult.confidence || 0.8, 0.8), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_TIE_ACCEPTANCE_PREFER_NO_PENALTY' };
        }
        // If contractor completed all deliverables and there's no strong acceptance/no-loss signal, prefer PARTY_B_WINS
        if (hasStrongCompleted && !hasNoMaterialLoss && !hasPayment) {
          console.log('[MERGE] Close scores and strong completion without acceptance signals -> prefer PARTY_B_WINS');
          return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.8, 0.8), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_TIE_PREFER_PARTY_B' };
        }
        // Default conservative: prefer NO_PENALTY when ambiguous
        console.log('[MERGE] Close scores with no decisive signals -> prefer NO_PENALTY');
        return { verdict: 'NO_PENALTY', confidence: Math.max(nlpResult.confidence || 0.75, 0.75), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_TIE_DEFAULT_NO_PENALTY' };
      }
    }

    // If NLP found both draw-like and no-penalty indicators, decide by confidence and counts
    if (nlpHasDraw && nlpHasNoPenalty) {
      const drawCount = (nlpFound || []).reduce((s,k) => s + (k.includes('insufficient') || k.includes('unclear') || k.includes('fragmented') ? 1 : 0), 0);
      const noPenaltyCount = (nlpFound || []).reduce((s,k) => s + (noPenaltyIndicators.some(d => k.includes(d)) ? 1 : 0), 0);
      console.log('[MERGE] NLP indicates both DRAW and NO_PENALTY -> counts', { drawCount, noPenaltyCount, nlpConfidence: nlpResult.confidence });
      // Prefer NO_PENALTY only when there is explicit acceptance/payment/waiver/no-material-loss signals
      // Require stronger signals before preferring NO_PENALTY when DRAW is also present.
      // "Requested no penalty" or only "no financial loss" should NOT by itself flip to NO_PENALTY.
      const explicitAcceptance = nlpFound.some(k => ['confirmed in writing', 'confirmed acceptance', 'accepted the final deliverables', 'accepted by the client'].some(a => k.includes(a)));
      const explicitWaiver = nlpFound.some(k => ['waived penalties','no penalties necessary','no penalties were necessary','no penalties claimed','waived any penalties','client waived'].some(a => k.includes(a)));
      const explicitNoMaterial = nlpFound.some(k => ['no material financial loss','no financial loss','no contractual damage','no material loss'].some(a => k.includes(a)));
      const hasPaymentProcessed = nlpFound.some(k => ['payment was processed','payment was processed in full','invoices were paid','invoices were paid in full'].some(a => k.includes(a)));

      // Only prefer NO_PENALTY when we see a clear acceptance/waiver/payment signal combined with
      // either an explicit no-material-loss indicator or a payment confirmation/explicit waiver.
      const preferNoPenalty = explicitWaiver || (explicitAcceptance && (explicitNoMaterial || hasPaymentProcessed)) || (hasPaymentProcessed && explicitNoMaterial);

      if (noPenaltyCount >= drawCount && (nlpResult.confidence || 0) >= 0.65 && preferNoPenalty) {
        console.log('[MERGE] Prefer NO_PENALTY based on explicit acceptance/waiver/payment + no-material-loss signals');
        return { verdict: 'NO_PENALTY', confidence: Math.max(nlpResult.confidence || 0.65, 0.65), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_CONFLICT_PREFER_NO_PENALTY' };
      }
      console.log('[MERGE] Prefer DRAW due to fragmented/unclear evidence');
      return { verdict: 'DRAW', confidence: Math.max(nlpResult.confidence || 0.6, 0.6), rationale: nlpResult.rationale, reimbursement: 0, source: 'NLP_CONFLICT_PREFER_DRAW' };
    }

    // If NLP strongly indicates NO_PENALTY (accepted/payment) with high confidence and LLM is lower confidence, prefer NLP NO_PENALTY
    if (nlpResult && nlpResult.verdict === 'NO_PENALTY' && (nlpResult.confidence || 0) >= 0.8 && (llmResult.confidence || 0) < 0.8 && (nlpHasNoPenalty)) {
      console.log('[MERGE] NLP strongly indicates NO_PENALTY and LLM is lower confidence -> prefer NLP NO_PENALTY');
      return { verdict: 'NO_PENALTY', confidence: nlpResult.confidence, rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_STRONG_OVERRIDE' };
    }

    // Special-case: if NLP says NO_PENALTY with very high confidence and contains explicit waiver language,
    // prefer NLP even against a high-confidence LLM (transparency: client explicitly waived penalties)
  const explicitWaiverPhrases = ['waived penalties', 'no penalties necessary', 'no penalties were necessary', 'no penalties claimed', 'waived any penalties', 'client waived', 'no penalty necessary'];
  const nlpFoundKeywords = (nlpResult && nlpResult.foundKeywords) || [];
  const nlpRationaleText = (nlpResult && nlpResult.rationale || '').toLowerCase();
  // reuse earlier computed nlpHasExplicitWaiver when available; if not, compute from nlpFoundKeywords
  // (the earlier nlpHasExplicitWaiver variable may be available in this scope)
  let _nlpHasExplicitWaiverFallback = nlpFoundKeywords.some(k => explicitWaiverPhrases.some(p => k.includes(p))) || explicitWaiverPhrases.some(p => nlpRationaleText.includes(p));
  try { if (typeof nlpHasExplicitWaiver === 'boolean') { 
 } } catch (e) { var nlpHasExplicitWaiver = _nlpHasExplicitWaiverFallback; }
    if (nlpResult && nlpResult.verdict === 'NO_PENALTY' && (nlpResult.confidence || 0) >= 0.88 && nlpHasExplicitWaiver) {
      console.log('[MERGE] NLP explicit waiver with very high confidence -> prefer NLP NO_PENALTY over high-confidence LLM');
      return { verdict: 'NO_PENALTY', confidence: nlpResult.confidence, rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_EXPLICIT_WAIVER_OVERRIDE' };
    }

    // If NLP indicates PARTY_B_WINS and LLM suggests NO_PENALTY with low or medium confidence, prefer NLP PARTY_B_WINS
    if (nlpResult && nlpResult.verdict === 'PARTY_B_WINS' && llmResult && llmResult.verdict === 'NO_PENALTY' && ((llmResult.confidence || 0) < 0.75)) {
      console.log('[MERGE] NLP indicates PARTY_B_WINS while LLM suggested NO_PENALTY with low/medium confidence -> prefer NLP PARTY_B_WINS');
      return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.8, 0.8), rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_OVERRIDE_PARTY_B' };
    }

    // If NLP indicates PARTY_B_WINS with high confidence and its confidence is close to LLM's (within 0.12), prefer NLP—handles cases where LLM returned NO_PENALTY but NLP found contractor-completion indicators
    if (nlpResult && nlpResult.verdict === 'PARTY_B_WINS' && (nlpResult.confidence || 0) >= 0.75 && llmResult && (llmResult.confidence || 0) - (nlpResult.confidence || 0) <= 0.12) {
      console.log('[MERGE] NLP PARTY_B_WINS confidence close to LLM -> prefer NLP PARTY_B_WINS');
      return { verdict: 'PARTY_B_WINS', confidence: Math.max(nlpResult.confidence || 0.75, llmResult.confidence || 0.75), rationale: nlpResult.rationale, reimbursement: nlpResult.reimbursement || 0, source: 'NLP_CLOSE_CONFIDENCE_OVERRIDE' };
    }

    // Decision logic
    let finalVerdict, finalConfidence, finalSource, finalRationale, finalReimbursement;

    // 1. If NLP verdict is defined and confidence very high, take it
    if (nlpResult.verdict && (nlpResult.confidence || 0) >= 0.85) {
      finalVerdict = nlpResult.verdict;
      finalConfidence = nlpResult.confidence;
      finalSource = 'NLP_VERY_HIGH_CONFIDENCE';
      finalRationale = nlpResult.rationale;
      finalReimbursement = nlpResult.reimbursement || 0;
    } else if (llmResult.verdict === 'DRAW' && nlpResult.verdict && (nlpResult.confidence || 0) >= 0.5) {
      // If LLM returns DRAW but NLP has high confidence, prefer NLP
      finalVerdict = nlpResult.verdict;
      finalConfidence = nlpResult.confidence;
      finalSource = 'NLP_OVERRIDE_DRAW';
      finalRationale = nlpResult.rationale;
      finalReimbursement = nlpResult.reimbursement || 0;
    } else if (nlpResult.verdict && (nlpResult.confidence || 0) >= 0.8 && nlpResult.verdict !== 'DRAW') {
      // General NLP high confidence override
      finalVerdict = nlpResult.verdict;
      finalConfidence = nlpResult.confidence;
      finalSource = 'NLP_HIGH_CONFIDENCE_OVERRIDE';
      finalRationale = nlpResult.rationale;
      finalReimbursement = nlpResult.reimbursement || 0;
    } else if (llmResult.verdict && (llmResult.confidence || 0) >= 0.75) {
      // Special-case override: if LLM says NO_PENALTY but NLP indicates a CONCLUSIVE completion pattern in evidence,
      // allow NLP to override even against high-confidence LLM. This is targeted to avoid regressions: only when
      // the NLP mapping explicitly flagged 'strongCompletionEvidence'.
      if (llmResult.verdict === 'NO_PENALTY' && nlpResult && nlpResult.strongCompletionEvidence) {
        console.log('[MERGE] LLM NO_PENALTY but NLP found STRICT conclusive completion evidence -> prefer PARTY_B_WINS (override high-LLM)');
        finalVerdict = 'PARTY_B_WINS';
        finalConfidence = Math.max(nlpResult.confidence || 0.9, llmResult.confidence || 0.75);
        finalSource = 'NLP_STRICT_EVIDENCE_OVERRIDE';
        finalRationale = nlpResult.rationale || llmResult.rationale;
        finalReimbursement = nlpResult.reimbursement || 0;
        console.log('[MERGE] Final merged verdict:', finalVerdict, 'Confidence:', finalConfidence, 'Source:', finalSource);
        return { verdict: finalVerdict, confidence: finalConfidence, rationale: finalRationale, reimbursement: finalReimbursement, source: finalSource };
      }
      // Special-case override: if LLM says NO_PENALTY but NLP strongly indicates contractor completed all deliverables
      // and there is no explicit waiver language, allow NLP to override even if the confidence margin is small.
      if (llmResult.verdict === 'NO_PENALTY' && nlpResult && nlpResult.verdict === 'PARTY_B_WINS' && hasStrongCompleted && !nlpHasExplicitWaiver && (nlpResult.confidence || 0) >= 0.7) {
        console.log('[MERGE] LLM NO_PENALTY but strong NLP completion found -> prefer PARTY_B_WINS (override high-LLM)');
        finalVerdict = 'PARTY_B_WINS';
        finalConfidence = Math.max(nlpResult.confidence || 0.75, llmResult.confidence || 0.75);
        finalSource = 'NLP_OVERRIDE_STRONG_COMPLETION';
        finalRationale = nlpResult.rationale;
        finalReimbursement = nlpResult.reimbursement || 0;
        // Return early
        console.log('[MERGE] Final merged verdict:', finalVerdict, 'Confidence:', finalConfidence, 'Source:', finalSource);
        return { verdict: finalVerdict, confidence: finalConfidence, rationale: finalRationale, reimbursement: finalReimbursement, source: finalSource };
      }
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
      // If rationale contains DRAW/NO_PENALTY keywords and NLP confidence is low, override
      if (rationaleFound.length > 0 && (nlpResult.confidence || 0) < 0.8) {
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

    // Build merged rationale depending on source
    let mergedRationale = '';
    try {
      // Prefer LLM rationale when the final source is LLM-based
      if (finalSource && finalSource.startsWith('LLM')) {
        mergedRationale = llmResult.rationale || llmResult._normalizedText || (nlpResult && (nlpResult.rationale || ('Based on keywords: ' + (nlpResult.foundKeywords || []).join(', ')))) || '';
      } else if (finalSource && finalSource.startsWith('NLP')) {
        // Build short NLP rationale if not present
        mergedRationale = nlpResult.rationale || ('Based on detected keywords: ' + (nlpResult.foundKeywords || []).join(', '));
      } else if (finalSource === 'AGREEMENT') {
        mergedRationale = '';
        if (llmResult.rationale) mergedRationale += 'LLM rationale:\n' + llmResult.rationale + '\n';
        if (nlpResult && nlpResult.foundKeywords && nlpResult.foundKeywords.length) mergedRationale += '\nNLP detected keywords: ' + nlpResult.foundKeywords.join(', ');
        if (!mergedRationale) mergedRationale = llmResult.rationale || (nlpResult && nlpResult.rationale) || '';
      } else {
        // Fallback: prefer LLM rationale if available, otherwise short NLP rationale
        mergedRationale = llmResult.rationale || (nlpResult && ('Based on keywords: ' + (nlpResult.foundKeywords || []).join(', '))) || '';
      }
    } catch (e) {
      mergedRationale = llmResult.rationale || nlpResult && nlpResult.rationale || '';
    }

    // Debug log
    console.log(`[MERGE] Final merged verdict:`, finalVerdict, `Confidence:`, finalConfidence, `Source:`, finalSource);
    console.log(`[MERGE] Final merged rationale (truncated 1000 chars):`, (mergedRationale||'').slice(0,1000));

    // Normalize output
    return {
      verdict: finalVerdict,
      confidence: Math.min(finalConfidence, 1),
      rationale: mergedRationale,
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
  if (!llmRaw) return { verdict: undefined, confidence: undefined, foundKeywords: [], rationale: '' };
  const text = (llmRaw.response || llmRaw || '').toString();
  const lower = text.toLowerCase();
  // Attempt to extract a RATIONALE: block early so subsequent logic can reference it
  let rationale = '';
  try {
    const ratMatchEarly = text.match(/RATIONALE:\s*([\s\S]*?)(?=\n[A-Z_]+:|$)/i) || text.match(/RATIONALE:\s*([\s\S]*)/i);
    if (ratMatchEarly && ratMatchEarly[1]) rationale = ratMatchEarly[1].trim();
  } catch (e) {
    rationale = '';
  }

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
        return { verdict, confidence: conf, foundKeywords: [k], normalizedText: text, rationale };
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

  // (rationale was extracted earlier)

  return { verdict: undefined, confidence: llmRaw.confidence || undefined, foundKeywords: [], rationale };
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
  // Accept multiple common keys used in test fixtures and callers (evidenceData, evidence_text, evidence, evidenceText, text)
  const evidence_text = payload.evidence_text || payload.evidence || payload.evidenceData || payload.evidenceText || payload.text || '';
  // Accept multiple contract field names (contract_text, contractText, contract)
  const contract_text = payload.contract_text || payload.contractText || payload.contract || 'GENERIC CONTRACT FOR TESTING';
    const dispute_id = payload.dispute_id || payload.disputeId || payload.caseId || 'unknown';

    const prompt = `EVIDENCE:\n${evidence_text}\nCONTRACT:\n${contract_text}\nDISPUTE_ID: ${dispute_id}\n\nYou are an arbitrator. In this dispute, PARTY_A is the client/claimant who initiated the contract, and PARTY_B is the contractor/supplier who was hired to perform the work. Analyze the evidence and contract dispute above. Determine if PARTY_A wins (breach by PARTY_B), PARTY_B wins (breach by PARTY_A), NO_PENALTY (no breach or mutual agreement), or DRAW (insufficient evidence). Key guidelines: - PARTY_A_WINS if PARTY_B breached the contract causing material harm to PARTY_A. - NO_PENALTY if deliverables were accepted and no material financial loss occurred. - PARTY_B_WINS if PARTY_A breached. - DRAW if evidence is insufficient or ambiguous. Provide your decision in EXACTLY this format:\n\nVERDICT: [PARTY_A_WINS or PARTY_B_WINS or NO_PENALTY or DRAW]\nRATIONALE: [brief explanation]\nCONFIDENCE: [0.0-1.0 or percentage]\nREIMBURSEMENT: [amount or NONE]`;

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

