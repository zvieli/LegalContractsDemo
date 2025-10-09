/**
 * Simple and Memory-Efficient Text Splitter
 * Designed for legal arbitration without memory leaks
 */

export class SimpleTextSplitter {
  constructor(config = {}) {
    this.config = {
      maxChunkSize: config.maxChunkSize || 2000,
      overlap: config.overlap || 100,
      ...config
    };
  }

  /**
   * Split text into simple chunks
   */
  splitText(text, type = 'general') {
    if (!text || text.length <= this.config.maxChunkSize) {
      return [{
        text: text,
        index: 0,
        total: 1,
        type: type
      }];
    }

    const chunks = [];
    let currentPosition = 0;
    let chunkIndex = 0;

    while (currentPosition < text.length) {
      const chunkEnd = Math.min(currentPosition + this.config.maxChunkSize, text.length);
      let actualEnd = chunkEnd;

      // Find good break point
      if (chunkEnd < text.length) {
        actualEnd = this.findSimpleBreakPoint(text, currentPosition, chunkEnd);
      }

      const chunkText = text.substring(currentPosition, actualEnd);
      
      chunks.push({
        text: chunkText.trim(),
        index: chunkIndex,
        total: 0, // Will be set later
        type: type,
        length: chunkText.length
      });

      currentPosition = actualEnd - Math.floor(this.config.overlap / 2);
      if (currentPosition >= actualEnd) {
        currentPosition = actualEnd;
      }
      
      chunkIndex++;
    }

    // Set total count
    chunks.forEach(chunk => chunk.total = chunks.length);

    console.log(`📄 Split ${type} text (${text.length} chars) into ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * Find simple break point
   */
  findSimpleBreakPoint(text, start, end) {
    const searchText = text.substring(start, end);
    
    // Look for sentence endings
    const sentenceEndings = ['. ', '! ', '? '];
    for (const ending of sentenceEndings) {
      const lastIndex = searchText.lastIndexOf(ending);
      if (lastIndex > searchText.length * 0.6) {
        return start + lastIndex + ending.length;
      }
    }

    // Look for word boundaries
    const wordBreak = searchText.lastIndexOf(' ');
    if (wordBreak > searchText.length * 0.7) {
      return start + wordBreak + 1;
    }

    return end;
  }

  /**
   * Create simple chunk prompt
   */
  createChunkPrompt(chunk, contractInfo, disputeQuestion) {
    return `LEGAL ANALYSIS - CHUNK ${chunk.index + 1}/${chunk.total}

CONTRACT: ${contractInfo.substring(0, 500)}

EVIDENCE CHUNK:
${chunk.text}

TASK: Analyze this evidence and provide key findings.

QUESTION: ${disputeQuestion}

Respond in JSON:
{
  "chunk_id": ${chunk.index},
  "key_facts": ["list of facts"],
  "preliminary_verdict": "PARTY_A_FAVOR|PARTY_B_FAVOR|NEUTRAL",
  "confidence": 0.8,
  "summary": "brief summary"
}`;
  }
}

/**
 * Simple Evidence Synthesizer
 */
export class SimpleEvidenceSynthesizer {
  synthesizeAnalyses(chunkAnalyses, contractInfo, disputeQuestion) {
    console.log(`🔗 Synthesizing ${chunkAnalyses.length} analyses...`);

    const allFacts = [];
    let totalConfidence = 0;
    const verdictCounts = { PARTY_A_FAVOR: 0, PARTY_B_FAVOR: 0, NEUTRAL: 0 };

    // Collect data
    chunkAnalyses.forEach((analysis, index) => {
      if (analysis.key_facts) {
        allFacts.push(...analysis.key_facts.map(fact => `[Chunk ${index + 1}] ${fact}`));
      }
      if (analysis.confidence) {
        totalConfidence += analysis.confidence;
      }
      if (analysis.preliminary_verdict) {
        verdictCounts[analysis.preliminary_verdict]++;
      }
    });

    // Determine final verdict
    const finalVerdict = this.determineFinalVerdict(verdictCounts);
    const avgConfidence = totalConfidence / chunkAnalyses.length;

    const synthesisPrompt = `FINAL ARBITRATION DECISION

CONTRACT: ${contractInfo.substring(0, 300)}

FACTS: ${allFacts.slice(0, 10).join(', ').substring(0, 800)}

PRELIMINARY: ${finalVerdict}

QUESTION: ${disputeQuestion}

Based on all evidence, provide final decision in JSON:
{
  "final_verdict": "PARTY_A_WINS|PARTY_B_WINS|DRAW",
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
        verdict_distribution: verdictCounts
      }
    };
  }

  determineFinalVerdict(verdictCounts) {
    const { PARTY_A_FAVOR, PARTY_B_FAVOR, NEUTRAL } = verdictCounts;
    
    if (PARTY_A_FAVOR > PARTY_B_FAVOR) {
      return 'PARTY_A_WINS';
    } else if (PARTY_B_FAVOR > PARTY_A_FAVOR) {
      return 'PARTY_B_WINS';
    } else {
      return 'DRAW';
    }
  }
}

// Keep backward compatibility
export const TextSplitter = SimpleTextSplitter;
export const EvidenceSynthesizer = SimpleEvidenceSynthesizer;