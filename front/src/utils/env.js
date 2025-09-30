// Centralized build-time E2E flag for DCE.
// For Vite builds this will be inlined from import.meta.env and allow DCE.
// For Node-based tests (Mocha/Hardhat) import.meta.env may be undefined, so
// fall back to process.env (TESTING or VITE_E2E_TESTING) so tests can import
// frontend helpers without throwing during module evaluation.
export const IN_E2E = (
	typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_E2E_TESTING === 'true'
) || (
	typeof process !== 'undefined' && process.env && (process.env.VITE_E2E_TESTING === 'true' || process.env.TESTING === '1')
);
