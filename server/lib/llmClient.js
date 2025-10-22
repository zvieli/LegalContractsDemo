import fetch from 'node-fetch';

export class LLMClient {
  constructor(opts = {}) {
    this.adapter = opts.adapter || 'ollama';
    // prefer project .env names
    this.baseUrl = opts.baseUrl || process.env.OLLAMA_HOST || process.env.LLM_ARBITRATOR_URL || null;
    this.model = opts.model || process.env.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'default';
    this.maxRetries = opts.maxRetries ?? 3;
    // prefer OLLAMA_TIMEOUT (ms)
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.OLLAMA_TIMEOUT || process.env.OLLAMA_TIMEOUT_MS) || 30000);
  }

  async callLLM({ model = this.model, input = '', options = {} } = {}) {
    // require a configured baseUrl for real LLM calls
    if (!this.baseUrl) {
      throw new Error('OLLAMA_HOST (or LLM_ARBITRATOR_URL) not configured in environment');
    }

    // Ollama local API: POST /api/generate with { model, prompt, stream, options }
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/generate`;
    const body = { model, prompt: input, stream: false, options };

    let attempt = 0;
    while (attempt < this.maxRetries) {
      attempt += 1;
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(id);

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`LLM HTTP ${res.status}: ${txt}`);
        }

        const json = await res.json();
        // Ollama returns { response: 'text', model, ... }
        const verdict = json?.response || json?.result || json;
        return { ok: true, model, raw: json, verdict };

      } catch (err) {
        if (attempt >= this.maxRetries) {
          return { ok: false, error: err.message || String(err) };
        }
        // backoff
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    return { ok: false, error: 'max_retries_exhausted' };
  }
}

export default LLMClient;
