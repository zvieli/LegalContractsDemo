


export class FinalSimpleTextSplitter {
  constructor(config = {}) {
    this.maxChunkSize = config.maxChunkSize || 2000;
  }

  splitText(text, type = 'general') {
    console.log(`📄 Splitting text of ${text.length} chars...`);
    
    if (!text || text.length <= this.maxChunkSize) {
      console.log('📄 Text is short, returning single chunk');
      return [{
        text: text,
        index: 0,
        total: 1,
        type: type
      }];
    }

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.maxChunkSize, text.length);
      const chunkText = text.substring(start, end).trim();
      
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          index: chunks.length,
          total: 0, // Will be updated
          type: type
        });
      }

      start = end; // NO OVERLAP to avoid infinite loop
      console.log(`📄 Processed chunk ${chunks.length}, next start: ${start}`);
    }

    // Update total count
    chunks.forEach(chunk => chunk.total = chunks.length);

    console.log(`📄 Final result: ${chunks.length} chunks`);
    return chunks;
  }

  createChunkPrompt(chunk, contractInfo, disputeQuestion) {
    return `LEGAL ANALYSIS - CHUNK ${chunk.index + 1}/${chunk.total}

CONTRACT: ${contractInfo.substring(0, 300)}

EVIDENCE:
${chunk.text}

QUESTION: ${disputeQuestion}

Respond in JSON format:
{
  "chunk_id": ${chunk.index},
  "key_facts": ["fact1", "fact2"],
  "preliminary_verdict": "PARTY_A_FAVOR",
  "confidence": 0.8,
  "summary": "brief summary"
}`;
  }
}

export class FinalSimpleEvidenceSynthesizer {
  synthesizeAnalyses(chunkAnalyses, contractInfo, disputeQuestion) {
    console.log(`🔗 Synthesizing ${chunkAnalyses.length} chunk analyses...`);

    // Simple aggregation
    const allFacts = [];
    let totalConfidence = 0;
    const verdictCount = { PARTY_A_FAVOR: 0, PARTY_B_FAVOR: 0, NEUTRAL: 0 };

    for (const analysis of chunkAnalyses) {
      if (analysis.key_facts && Array.isArray(analysis.key_facts)) {
        allFacts.push(...analysis.key_facts);
      }
      if (typeof analysis.confidence === 'number') {
        totalConfidence += analysis.confidence;
      }
      if (analysis.preliminary_verdict) {
        verdictCount[analysis.preliminary_verdict] = (verdictCount[analysis.preliminary_verdict] || 0) + 1;
      }
    }

    // Determine winner
    const maxVerdictType = Object.keys(verdictCount).reduce((a, b) => 
      verdictCount[a] > verdictCount[b] ? a : b
    );

    let finalVerdict = 'DRAW';
    if (maxVerdictType === 'PARTY_A_FAVOR') finalVerdict = 'PARTY_A_WINS';
    else if (maxVerdictType === 'PARTY_B_FAVOR') finalVerdict = 'PARTY_B_WINS';

    const avgConfidence = chunkAnalyses.length > 0 ? totalConfidence / chunkAnalyses.length : 0.5;

    const synthesisPrompt = `FINAL ARBITRATION DECISION

CONTRACT: ${contractInfo.substring(0, 200)}...

EVIDENCE SUMMARY: ${allFacts.slice(0, 3).join(', ')}

QUESTION: ${disputeQuestion}

Based on analysis of ${chunkAnalyses.length} evidence chunks, provide final decision:

{
  "final_verdict": "${finalVerdict}",
  "confidence": ${avgConfidence.toFixed(2)},
  "rationale_summary": "Based on analysis of evidence chunks",
  "reimbursement_amount_dai": 0,
  "model": "llama3.2:latest",
  "llm_used": true
}`;

    return {
      synthesisPrompt,
      metadata: {
        chunks_processed: chunkAnalyses.length,
        average_confidence: avgConfidence,
        verdict_distribution: verdictCount
      }
    };
  }
}

// Export with expected names
export const SimpleTextSplitter = FinalSimpleTextSplitter;
export const SimpleEvidenceSynthesizer = FinalSimpleEvidenceSynthesizer;