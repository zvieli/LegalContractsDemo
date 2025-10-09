/**
 * Ultra-Simple Text Splitter - No Memory Issues
 */

export class UltraSimpleTextSplitter {
  constructor(config = {}) {
    this.maxChunkSize = config.maxChunkSize || 2000;
    this.overlap = config.overlap || 100;
  }

  splitText(text, type = 'general') {
    if (!text || text.length <= this.maxChunkSize) {
      return [{
        text: text,
        index: 0,
        total: 1,
        type: type
      }];
    }

    const chunks = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      let end = Math.min(start + this.maxChunkSize, text.length);
      
      // Simple word boundary check
      if (end < text.length && text[end] !== ' ') {
        // Go back to find a space
        for (let i = end; i > start + this.maxChunkSize * 0.8; i--) {
          if (text[i] === ' ') {
            end = i;
            break;
          }
        }
      }

      const chunkText = text.substring(start, end).trim();
      
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          index: chunkIndex,
          total: 0, // Will be updated
          type: type,
          length: chunkText.length
        });
        chunkIndex++;
      }

      start = end - Math.min(this.overlap, end - start);
      if (start >= end) start = end;
    }

    // Update total count
    chunks.forEach(chunk => chunk.total = chunks.length);

    console.log(`📄 Split ${type} text (${text.length} chars) into ${chunks.length} chunks`);
    return chunks;
  }

  createChunkPrompt(chunk, contractInfo, disputeQuestion) {
    return `LEGAL ANALYSIS - CHUNK ${chunk.index + 1}/${chunk.total}

CONTRACT: ${contractInfo.substring(0, 300)}

EVIDENCE CHUNK:
${chunk.text}

TASK: Analyze this evidence.

QUESTION: ${disputeQuestion}

Respond in JSON:
{
  "chunk_id": ${chunk.index},
  "key_facts": ["fact1", "fact2"],
  "preliminary_verdict": "PARTY_A_FAVOR|PARTY_B_FAVOR|NEUTRAL",
  "confidence": 0.8,
  "summary": "brief summary"
}`;
  }
}

export class UltraSimpleEvidenceSynthesizer {
  synthesizeAnalyses(chunkAnalyses, contractInfo, disputeQuestion) {
    console.log(`🔗 Synthesizing ${chunkAnalyses.length} analyses...`);

    const facts = [];
    let confidence = 0;
    const verdicts = { PARTY_A_FAVOR: 0, PARTY_B_FAVOR: 0, NEUTRAL: 0 };

    for (const analysis of chunkAnalyses) {
      if (analysis.key_facts) {
        facts.push(...analysis.key_facts);
      }
      if (analysis.confidence) {
        confidence += analysis.confidence;
      }
      if (analysis.preliminary_verdict) {
        verdicts[analysis.preliminary_verdict]++;
      }
    }

    // Determine winner
    let finalVerdict = 'DRAW';
    if (verdicts.PARTY_A_FAVOR > verdicts.PARTY_B_FAVOR) {
      finalVerdict = 'PARTY_A_WINS';
    } else if (verdicts.PARTY_B_FAVOR > verdicts.PARTY_A_FAVOR) {
      finalVerdict = 'PARTY_B_WINS';
    }

    const avgConfidence = confidence / chunkAnalyses.length;

    const synthesisPrompt = `FINAL ARBITRATION DECISION

CONTRACT: ${contractInfo.substring(0, 200)}

EVIDENCE FACTS: ${facts.slice(0, 5).join(', ')}

QUESTION: ${disputeQuestion}

Based on all evidence, provide final decision:
{
  "final_verdict": "${finalVerdict}",
  "confidence": ${avgConfidence.toFixed(2)},
  "rationale_summary": "explanation",
  "reimbursement_amount_dai": 0,
  "model": "llama3.2:latest",
  "llm_used": true
}`;

    return {
      synthesisPrompt,
      metadata: {
        chunks_processed: chunkAnalyses.length,
        average_confidence: avgConfidence,
        verdict_distribution: verdicts
      }
    };
  }
}

// Export with original names for compatibility
export const SimpleTextSplitter = UltraSimpleTextSplitter;
export const SimpleEvidenceSynthesizer = UltraSimpleEvidenceSynthesizer;