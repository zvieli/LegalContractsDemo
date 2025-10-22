import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { processEvidenceWithOllama } from '../modules/ollamaLLMArbitrator.js';

// Simple in-memory queue + worker for forwarding evidence to LLM
export class DisputeForwarder {
  constructor({ llmClient, previewResolver, responseHandler, concurrency = 1, dataPath = null } = {}) {
    this.llmClient = llmClient;
    this.previewResolver = previewResolver; // { fetchPlaintext(ref) }
    this.responseHandler = responseHandler; // optional handler to send CCIP response
    this.queue = [];
    this.processing = new Map();
    this.concurrency = concurrency;
    this.running = false;
    this.dataPath = dataPath || path.join(process.cwd(), 'server', 'data');
    if (!fs.existsSync(this.dataPath)) fs.mkdirSync(this.dataPath, { recursive: true });
    this.verdictsFile = path.join(this.dataPath, 'llm-verdicts.json');
  }

  enqueueJob(job) {
    const jobId = uuidv4();
    const j = {
      jobId,
      evidenceRef: job.evidenceRef,
      caseId: job.caseId || null,
      contractAddress: job.contractAddress || null,
      triggerSource: job.triggerSource || 'api',
      submittedAt: new Date().toISOString(),
      attempts: 0
    };
    this.queue.push(j);
    this._ensureRunning();
    return j;
  }

  _ensureRunning() {
    if (!this.running) {
      this.running = true;
      // start worker(s)
      for (let i = 0; i < this.concurrency; i++) this._runWorker();
    }
  }

  async _runWorker() {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      this.processing.set(job.jobId, job);
      try {
        await this._processJob(job);
      } catch (err) {
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts < 3) {
          this.queue.push(job); // retry
        } else {
          // persist failure
          this._persistVerdict({ jobId: job.jobId, error: String(err), status: 'failed' });
        }
      } finally {
        this.processing.delete(job.jobId);
      }
    }
    this.running = false;
  }

  async _processJob(job) {
    // fetch plaintext via previewResolver (capture errors for debugging)
    let plaintext = null;
    let previewError = null;
    try {
      plaintext = await this.previewResolver.fetchPlaintext(job.evidenceRef);
    } catch (err) {
      previewError = String(err);
      // fallback to evidenceRef so LLM still receives something useful
      plaintext = job.evidenceRef || '';
    }

    // optional: summarizer step could be here
    // Use host-side structured prompt pipeline so LLM receives inline evidence and returns JSON
    let llmRes = null;
    try {
      llmRes = await processEvidenceWithOllama({ evidence_text: plaintext, contract_text: job.contractAddress || '', dispute_id: job.jobId });
    } catch (e) {
      // fallback to direct llm client if our structured wrapper fails
      try {
        llmRes = await this.llmClient.callLLM({ input: plaintext, options: {} });
      } catch (e2) {
        llmRes = { ok: false, error: String(e2 || e) };
      }
    }

    // write a debug file with plaintext + full llm response to help debugging
    try {
      const dbgPath = path.join(this.dataPath, `llm-debug-${job.jobId}.json`);
      const dbg = { jobId: job.jobId, evidenceRef: job.evidenceRef, plaintext, previewError, llmRes, ts: new Date().toISOString() };
      fs.writeFileSync(dbgPath, JSON.stringify(dbg, null, 2), 'utf8');
    } catch (e) {
      // ignore debug write failures
    }

    const record = {
      jobId: job.jobId,
      evidenceRef: job.evidenceRef,
      caseId: job.caseId,
      contractAddress: job.contractAddress,
      model: llmRes.model || null,
      raw: (llmRes && Object.prototype.hasOwnProperty.call(llmRes, 'raw')) ? llmRes.raw : null,
      verdict: (llmRes && Object.prototype.hasOwnProperty.call(llmRes, 'verdict')) ? llmRes.verdict : null,
      ok: llmRes && llmRes.ok !== false,
      processedAt: new Date().toISOString(),
      previewError: previewError || null,
      llmResponse: llmRes || null
    };

    this._persistVerdict(record);

    if (this.responseHandler && record.ok) {
      try {
        await this.responseHandler.processAndSendDecision({
          messageId: job.jobId,
          disputeId: job.jobId,
          sourceChainSelector: null,
          sourceContract: job.contractAddress
        }, { final_verdict: record.verdict, rationale: 'Automated LLM' });
      } catch (err) {
        // log and continue
        this._persistVerdict({ jobId: job.jobId, error: String(err), status: 'response_failed' });
      }
    }
  }

  _persistVerdict(record) {
    let arr = [];
    if (fs.existsSync(this.verdictsFile)) {
      try { arr = JSON.parse(fs.readFileSync(this.verdictsFile, 'utf8') || '[]'); } catch(e) { arr = []; }
    }
    arr.push(record);
    fs.writeFileSync(this.verdictsFile, JSON.stringify(arr, null, 2), 'utf8');
  }

  getStatus() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      verdictsFile: this.verdictsFile
    };
  }
}

export default DisputeForwarder;
