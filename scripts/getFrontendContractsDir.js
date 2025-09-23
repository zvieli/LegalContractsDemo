const path = require('path');

// Returns an absolute path to the frontend contracts directory.
// By default this points to the public served path where deploy writes
// artifacts: front/public/utils/contracts
// Override by setting the env var FRONTEND_CONTRACTS_DIR to a filesystem path
module.exports = function getFrontendContractsDir() {
  const env = process.env.FRONTEND_CONTRACTS_DIR;
  if (env && typeof env === 'string' && env.trim()) return path.resolve(process.cwd(), env.trim());
  return path.join(__dirname, '../front/public/utils/contracts');
};
