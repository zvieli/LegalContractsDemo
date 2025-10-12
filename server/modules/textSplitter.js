


export class TextSplitter {
  constructor(config = {}) {
    this.config = {
      maxChunkSize: config.maxChunkSize || 2000, // Characters per chunk
      overlap: config.overlap || 200, // Overlap between chunks for context
      preserveContext: config.preserveContext !== false,
      ...config
    };
  }

  

  splitText(text, type = 'general') {
    if (!text || text.length <= this.config.maxChunkSize) {
      return [{
        text: text,
        index: 0,
        total: 1,
        type: type,
        length: text?.length || 0,
        contextBefore: '',
        contextAfter: '',
        keyTerms: this.extractKeyTerms(text, type)
      }];
    }

    const chunks = [];
    let currentPosition = 0;
    let chunkIndex = 0;

    // Extract important terms and patterns for context preservation
    const keyTerms = this.extractKeyTerms(text, type);
    console.log(`🔑 Extracted ${keyTerms.length} key terms for context preservation`);

    while (currentPosition < text.length) {
      const chunkEnd = Math.min(currentPosition + this.config.maxChunkSize, text.length);
      let actualEnd = chunkEnd;

      // Try to break at natural boundaries (sentences, paragraphs)
      if (chunkEnd < text.length) {
        actualEnd = this.findBestBreakPoint(text, currentPosition, chunkEnd);
      }

      const chunkText = text.substring(currentPosition, actualEnd);
      
      // Extract context before and after for continuity
      const contextBefore = this.extractContextBefore(text, currentPosition, 150);
      const contextAfter = this.extractContextAfter(text, actualEnd, 150);
      
      chunks.push({
        text: chunkText.trim(),
        index: chunkIndex,
        total: 0, // Will be set after all chunks are created
        type: type,
        length: chunkText.length,
        startPos: currentPosition,
        endPos: actualEnd,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        keyTerms: keyTerms, // All key terms available to each chunk
        chunkKeyTerms: this.extractKeyTerms(chunkText, type) // Terms specific to this chunk
      });

      // Move position with overlap consideration
      currentPosition = actualEnd - (this.config.overlap / 2);
      if (currentPosition >= actualEnd) {
        currentPosition = actualEnd;
      }
      
      chunkIndex++;
    }

    // Set total count for all chunks
    chunks.forEach(chunk => chunk.total = chunks.length);

    console.log(`📄 Split ${type} text (${text.length} chars) into ${chunks.length} chunks with context preservation`);
    return chunks;
  }

  

  extractKeyTerms(text, type) {
    const terms = new Set();
    
    // Simplified extraction to avoid memory issues
    try {
      // Legal terms - limit matches
      const legalMatches = text.match(/\b(contract|agreement|clause|section|article|paragraph|whereas|therefore|party|breach|violation|damages|compensation|liable|obligation|duty|right|term|condition)\b/gi);
      if (legalMatches && legalMatches.length < 100) {
        legalMatches.slice(0, 20).forEach(term => terms.add(term.toLowerCase()));
      }

      // Evidence terms - limit matches
      const evidenceMatches = text.match(/\b(evidence|witness|testified|document|email|attachment|exhibit|proof|shows|indicates|demonstrates|confirms)\b/gi);
      if (evidenceMatches && evidenceMatches.length < 100) {
        evidenceMatches.slice(0, 20).forEach(term => terms.add(term.toLowerCase()));
      }

      // Names - limit matches
      const nameMatches = text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g);
      if (nameMatches && nameMatches.length < 50) {
        nameMatches.slice(0, 10).forEach(name => terms.add(name));
      }

      // Money amounts - limit matches
      const moneyMatches = text.match(/\$[\d,]+(?:\.\d{2})?\b/g);
      if (moneyMatches && moneyMatches.length < 20) {
        moneyMatches.forEach(amount => terms.add(amount));
      }

    } catch (error) {
      console.warn('⚠️ Error extracting key terms:', error.message);
    }

    return Array.from(terms).slice(0, 30); // Strict limit
  }

  

  extractContextBefore(text, position, maxLength) {
    if (position === 0) return '';
    
    const start = Math.max(0, position - maxLength);
    const context = text.substring(start, position);
    
    // Try to start at sentence boundary
    const sentenceStart = context.lastIndexOf('. ');
    if (sentenceStart > context.length * 0.3) {
      return context.substring(sentenceStart + 2);
    }
    
    return context;
  }

  

  extractContextAfter(text, position, maxLength) {
    if (position >= text.length) return '';
    
    const end = Math.min(text.length, position + maxLength);
    const context = text.substring(position, end);
    
    // Try to end at sentence boundary
    const sentenceEnd = context.indexOf('. ');
    if (sentenceEnd > 0 && sentenceEnd < context.length * 0.7) {
      return context.substring(0, sentenceEnd + 1);
    }
    
    return context;
  }

  

  findBestBreakPoint(text, start, end) {
    const searchText = text.substring(start, end);
    
    // Simple approach: look for paragraph breaks first
    const paragraphBreak = searchText.lastIndexOf('\n\n');
    if (paragraphBreak > searchText.length * 0.4) {
      console.log(`📄 Using paragraph break at position ${paragraphBreak}`);
      return start + paragraphBreak + 2;
    }

    // Then sentence endings
    const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    for (const ending of sentenceEndings) {
      const lastIndex = searchText.lastIndexOf(ending);
      if (lastIndex > searchText.length * 0.6) {
        console.log(`📄 Using sentence break at position ${lastIndex}`);
        return start + lastIndex + ending.length;
      }
    }

    // Finally word boundaries
    const wordBreak = searchText.lastIndexOf(' ');
    if (wordBreak > searchText.length * 0.7) {
      console.log(`📄 Using word boundary at position ${wordBreak}`);
      return start + wordBreak + 1;
    }

    console.log('📄 Using fallback break point');
    return Math.min(end, text.length);
  }

  

  wouldBreakImportantContext(text, breakPoint, legalPatterns, evidencePatterns) {
    // Simplified check - just look for mid-sentence breaks
    const beforeContext = text.substring(Math.max(0, breakPoint - 50), breakPoint);
    const afterContext = text.substring(breakPoint, Math.min(text.length, breakPoint + 50));
    
    // Check for incomplete sentences
    const incompleteSentence = /[a-z,]\s*$/i.test(beforeContext) && /^[a-z]/i.test(afterContext);
    if (incompleteSentence) {
      console.log('⚠️ Would break mid-sentence');
      return true;
    }

    return false;
  }

  

  createChunkPrompt(chunk, contractInfo, disputeQuestion) {
    // Build context information
    const contextInfo = chunk.contextBefore || chunk.contextAfter ? 
      `\nCONTEXT PRESERVATION:
${chunk.contextBefore ? `Previous context: "${chunk.contextBefore.slice(-100)}..."` : ''}
${chunk.contextAfter ? `Following context: "...${chunk.contextAfter.slice(0, 100)}"` : ''}` : '';

    const keyTermsInfo = chunk.keyTerms && chunk.keyTerms.length > 0 ?
      `\nKEY TERMS TO CONSIDER: ${chunk.keyTerms.slice(0, 15).join(', ')}` : '';

    return `LEGAL ANALYSIS - CHUNK ${chunk.index + 1}/${chunk.total}

CONTRACT CONTEXT:
${contractInfo}

EVIDENCE CHUNK (${chunk.type}):
${chunk.text}${contextInfo}${keyTermsInfo}

IMPORTANT INSTRUCTIONS:
- This is chunk ${chunk.index + 1} of ${chunk.total} total chunks
- Analyze ONLY the evidence in this chunk, but consider the provided context
- Look for connections to key terms and legal concepts
- If this chunk seems incomplete, note what context might be missing
- Focus on facts, legal relevance, and impact on each party

TASK: Analyze this evidence chunk and provide:
1. KEY FACTS found in this chunk (be specific about what's in THIS chunk)
2. LEGAL RELEVANCE to the dispute (how these facts matter legally)
3. PARTY IMPACT (how this chunk affects each party's position)
4. CONTEXT ASSESSMENT (is this chunk complete or does it need information from other chunks?)
5. PRELIMINARY ASSESSMENT (based on this chunk alone)

QUESTION: ${disputeQuestion}

Respond in JSON format:
{
  "chunk_id": ${chunk.index},
  "key_facts": ["specific facts from this chunk"],
  "legal_relevance": "how these facts relate to legal principles",
  "party_a_impact": "specific impact on party A based on this chunk",
  "party_b_impact": "specific impact on party B based on this chunk", 
  "context_assessment": "is this chunk complete or missing context?",
  "preliminary_verdict": "PARTY_A_FAVOR|PARTY_B_FAVOR|NEUTRAL",
  "confidence": 0.0-1.0,
  "summary": "brief summary of this chunk's contribution",
  "missing_context": ["what information might be in other chunks"],
  "key_terms_found": ["important terms identified in this chunk"]
}`;
  }
}



export class EvidenceSynthesizer {
  constructor(config = {}) {
    this.config = {
      weightingStrategy: config.weightingStrategy || 'equal', // equal, length-based, confidence-based
      ...config
    };
  }

  

  synthesizeAnalyses(chunkAnalyses, contractInfo, disputeQuestion) {
    console.log(`🔗 Synthesizing ${chunkAnalyses.length} chunk analyses with context preservation...`);

    const allFacts = [];
    const partyAPoints = [];
    const partyBPoints = [];
    const contextIssues = [];
    const keyTermsFound = new Set();
    let totalConfidence = 0;
    const verdictCounts = { PARTY_A_FAVOR: 0, PARTY_B_FAVOR: 0, NEUTRAL: 0 };

    // Aggregate all chunk findings with context awareness
    chunkAnalyses.forEach((analysis, index) => {
      if (analysis.key_facts) {
        allFacts.push(...analysis.key_facts.map(fact => `[Chunk ${index + 1}] ${fact}`));
      }
      if (analysis.party_a_impact) {
        partyAPoints.push(`[Chunk ${index + 1}] ${analysis.party_a_impact}`);
      }
      if (analysis.party_b_impact) {
        partyBPoints.push(`[Chunk ${index + 1}] ${analysis.party_b_impact}`);
      }
      if (analysis.context_assessment && analysis.context_assessment.includes('missing')) {
        contextIssues.push(`Chunk ${index + 1}: ${analysis.context_assessment}`);
      }
      if (analysis.key_terms_found) {
        analysis.key_terms_found.forEach(term => keyTermsFound.add(term));
      }
      if (analysis.confidence) {
        totalConfidence += analysis.confidence;
      }
      if (analysis.preliminary_verdict) {
        verdictCounts[analysis.preliminary_verdict]++;
      }
    });

    // Determine final verdict based on chunk votes with context consideration
    const finalVerdict = this.determineFinalVerdict(verdictCounts, chunkAnalyses);
    const avgConfidence = totalConfidence / chunkAnalyses.length;

    // Adjust confidence based on context completeness
    const contextCompleteness = 1 - (contextIssues.length / chunkAnalyses.length);
    const adjustedConfidence = avgConfidence * (0.7 + 0.3 * contextCompleteness);

    // Create synthesis prompt for final decision
    const synthesisPrompt = this.createEnhancedSynthesisPrompt(
      allFacts, partyAPoints, partyBPoints, contextIssues, 
      Array.from(keyTermsFound), contractInfo, disputeQuestion, finalVerdict
    );

    return {
      synthesisPrompt,
      metadata: {
        chunks_processed: chunkAnalyses.length,
        preliminary_verdict: finalVerdict,
        average_confidence: avgConfidence,
        adjusted_confidence: adjustedConfidence,
        verdict_distribution: verdictCounts,
        total_facts: allFacts.length,
        context_completeness: contextCompleteness,
        context_issues: contextIssues.length,
        key_terms_identified: keyTermsFound.size
      }
    };
  }

  

  createEnhancedSynthesisPrompt(allFacts, partyAPoints, partyBPoints, contextIssues, keyTerms, contractInfo, disputeQuestion, preliminaryVerdict) {
    // Limit the data to prevent memory issues
    const limitedFacts = allFacts.slice(0, 20);
    const limitedPartyA = partyAPoints.slice(0, 10);
    const limitedPartyB = partyBPoints.slice(0, 10);
    const limitedKeyTerms = keyTerms.slice(0, 15);
    const limitedContextIssues = contextIssues.slice(0, 5);

    const contextWarnings = limitedContextIssues.length > 0 ? 
      `\nCONTEXT ANALYSIS NOTES:\n${limitedContextIssues.join('\n')}\n⚠️ Some chunks may have incomplete context.` : '';

    const keyTermsSection = limitedKeyTerms.length > 0 ?
      `\nKEY TERMS: ${limitedKeyTerms.join(', ')}` : '';

    return `FINAL LEGAL ARBITRATION SYNTHESIS

CONTRACT: ${contractInfo.substring(0, 500)}

FACTS: ${limitedFacts.join(', ').substring(0, 1000)}

PARTY A: ${limitedPartyA.join(', ').substring(0, 500)}
PARTY B: ${limitedPartyB.join(', ').substring(0, 500)}

${contextWarnings}${keyTermsSection}

PRELIMINARY: ${preliminaryVerdict}

QUESTION: ${disputeQuestion}

Respond in JSON:
{
  "final_verdict": "PARTY_A_WINS|PARTY_B_WINS|DRAW",
  "confidence": 0.8,
  "rationale_summary": "brief explanation",
  "reimbursement_amount_dai": 0,
  "model": "llama3.2:latest",
  "llm_used": true
}`;
  }

  

  determineFinalVerdict(verdictCounts, chunkAnalyses) {
    const { PARTY_A_FAVOR, PARTY_B_FAVOR, NEUTRAL } = verdictCounts;
    
    if (PARTY_A_FAVOR > PARTY_B_FAVOR + NEUTRAL) {
      return 'PARTY_A_WINS';
    } else if (PARTY_B_FAVOR > PARTY_A_FAVOR + NEUTRAL) {
      return 'PARTY_B_WINS';
    } else {
      // Consider confidence levels for ties
      const avgConfidenceA = this.getAverageConfidenceForVerdict(chunkAnalyses, 'PARTY_A_FAVOR');
      const avgConfidenceB = this.getAverageConfidenceForVerdict(chunkAnalyses, 'PARTY_B_FAVOR');
      
      return avgConfidenceA > avgConfidenceB ? 'PARTY_A_WINS' : 'PARTY_B_WINS';
    }
  }

  

  getAverageConfidenceForVerdict(analyses, verdict) {
    const relevantAnalyses = analyses.filter(a => a.preliminary_verdict === verdict);
    if (relevantAnalyses.length === 0) return 0;
    
    const totalConfidence = relevantAnalyses.reduce((sum, a) => sum + (a.confidence || 0), 0);
    return totalConfidence / relevantAnalyses.length;
  }

  

  createSynthesisPrompt(allFacts, partyAPoints, partyBPoints, contractInfo, disputeQuestion, preliminaryVerdict) {
    return `FINAL LEGAL ARBITRATION SYNTHESIS

CONTRACT CONTEXT:
${contractInfo}

AGGREGATED EVIDENCE ANALYSIS:

KEY FACTS DISCOVERED:
${allFacts.map((fact, i) => `${i + 1}. ${fact}`).join('\n')}

PARTY A IMPACT ANALYSIS:
${partyAPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}

PARTY B IMPACT ANALYSIS:
${partyBPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}

PRELIMINARY VERDICT INDICATION: ${preliminaryVerdict}

TASK: Based on ALL the evidence analyzed above, provide a FINAL ARBITRATION DECISION.

QUESTION: ${disputeQuestion}

Respond in JSON format with comprehensive analysis:
{
  "final_verdict": "PARTY_A_WINS|PARTY_B_WINS|DRAW",
  "confidence": 0.0-1.0,
  "rationale_summary": "brief explanation of decision",
  "detailed_reasoning": {
    "key_facts": ["most important facts"],
    "contract_analysis": "how contract terms apply",
    "party_a_position": "party A's case assessment", 
    "party_b_position": "party B's case assessment",
    "violation_analysis": "what violations occurred",
    "damage_assessment": "compensation assessment",
    "legal_precedent": "applicable legal principles",
    "decision_factors": ["main factors in decision"]
  },
  "confidence_breakdown": {
    "evidence_strength": 1-10,
    "legal_clarity": 1-10, 
    "overall_confidence": 1-10
  },
  "reimbursement_amount_dai": 0,
  "model": "llama3.2:latest",
  "llm_used": true
}`;
  }
}