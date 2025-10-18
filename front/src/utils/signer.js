export async function safeGetAddress(signer, providerOrService) {
  try {
    if (!signer && !providerOrService) return null;
    // If signer provided and has getAddress
    if (signer && typeof signer.getAddress === 'function') {
      try {
        return await signer.getAddress();
      } catch (_) {
        // fallthrough to provider-derived signer
      }
    }

    // Accept either a provider or a ContractService instance with _providerForRead
    let p = null;
    if (providerOrService) {
      if (typeof providerOrService._providerForRead === 'function') {
        try { p = providerOrService._providerForRead(); } catch (_) { p = null; }
      } else {
        p = providerOrService;
      }
    }

    // Only use provider-derived signer if provider exposes getSigner
    if (p && typeof p.getSigner === 'function') {
      try {
        const s = await p.getSigner();
        if (s && typeof s.getAddress === 'function') return await s.getAddress();
      } catch (_) {}
    }
    return null;
  } catch (e) {
    return null;
  }
}
