import express from 'express';

const router = express.Router();

// simple admin key guard
function requireAdminKey(req, res, next) {
  // allow multiple env var names for admin key (backwards compatible)
  const key = process.env.PREVIEW_API_KEY || process.env.ADMIN_PREVIEW_KEY || process.env.PLATFORM_ADMIN_ADDRESS || 'admin-key';
  const provided = req.headers['x-api-key'] || req.query.api_key;
  // also accept platform admin address as key for local/dev convenience
  if (!provided || (provided !== key && provided !== process.env.PLATFORM_ADMIN_ADDRESS)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

export default function createAdminForwarderRouter(forwarder) {
  // Resolve forwarder at request time to allow mounting the router before the forwarder is initialized.
  const resolveForwarder = () => forwarder || global.__DISPUTE_FORWARDER_INSTANCE || null;

  router.post('/forward-evidence', requireAdminKey, async (req, res) => {
    try {
      const { evidenceRef, caseId, contractAddress } = req.body;
      if (!evidenceRef) return res.status(400).json({ error: 'missing evidenceRef' });
      const f = resolveForwarder();
      if (!f) return res.status(503).json({ error: 'forwarder_unavailable', message: 'Dispute forwarder is not initialized yet' });
      const job = f.enqueueJob({ evidenceRef, caseId, contractAddress, triggerSource: 'admin' });
      return res.json({ ok: true, jobId: job.jobId });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  router.get('/status', requireAdminKey, (req, res) => {
    const f = resolveForwarder();
    if (!f) return res.status(503).json({ ok: false, status: 'forwarder_unavailable' });
    try {
      return res.json({ ok: true, status: f.getStatus() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  return router;
}
