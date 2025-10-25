import React, { useEffect, useState } from 'react';

export default function ArbitrationHealth({ intervalMs = 20000, onChange = null }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        const res = await fetch('/api/v7/arbitration/ollama/health');
        const j = await res.json().catch(() => null);
        const h = j || (res.ok ? { ok: true } : { ok: false });
        if (!mounted) return;
        setHealth(h);
        if (typeof onChange === 'function') onChange(h);
      } catch (e) { void e;
        const h = { ok: false, err: String(e?.message || e) };
        if (!mounted) return;
        setHealth(h);
        if (typeof onChange === 'function') onChange(h);
      }
    }
    check();
    const t = setInterval(check, intervalMs);
    return () => { mounted = false; clearInterval(t); };
  }, [intervalMs, onChange]);

  if (!health) return <span className="arb-health arb-health-checking">Checking LLM...</span>;
  if (health.ok) return <span className="arb-health arb-health-ok" title="Ollama OK">Ollama: ✓</span>;
  return <span className="arb-health arb-health-down" title={health.err || 'Unavailable'}>Ollama: ✕</span>;
}
