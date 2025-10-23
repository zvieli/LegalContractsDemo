// Centralized EIP-712 domain helpers
export function rentDomain(chainId, verifyingContract) {
  return {
    name: 'TemplateRentContract',
    version: '1',
    chainId: Number(chainId || 0),
    verifyingContract: verifyingContract
  };
}

export function ndaDomain(chainId, verifyingContract) {
  return {
    name: 'NDATemplate',
    version: '1',
    chainId: Number(chainId || 0),
    verifyingContract: verifyingContract
  };
}

export default { rentDomain, ndaDomain };
