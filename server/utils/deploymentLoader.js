import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));



export function getContractAddress(name) {
  // 1) try deployment-summary.json
  try {
    const deploymentPath = path.resolve(__dirname, '../../front/src/utils/contracts/deployment-summary.json');
    if (fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      if (deployment && deployment.contracts && deployment.contracts[name]) return deployment.contracts[name];
      // ccip contracts nested
      if (name === 'CCIPArbitrationSender' && deployment.ccip && deployment.ccip.contracts && deployment.ccip.contracts.CCIPArbitrationSender) return deployment.ccip.contracts.CCIPArbitrationSender;
      if (name === 'CCIPArbitrationReceiver' && deployment.ccip && deployment.ccip.contracts && deployment.ccip.contracts.CCIPArbitrationReceiver) return deployment.ccip.contracts.CCIPArbitrationReceiver;
    }
  } catch (e) {
    // ignore
  }

  // 2) try artifacts JSON files (search for contract name key under artifacts/contracts)
  try {
    const artifactsDir = path.resolve(__dirname, '../..', 'artifacts', 'contracts');
    if (fs.existsSync(artifactsDir)) {
      const files = fs.readdirSync(artifactsDir, { withFileTypes: true });
      for (const d of files) {
        if (!d.isDirectory()) continue;
        const subdir = path.join(artifactsDir, d.name);
        const artifactFiles = fs.readdirSync(subdir).filter(f => f.endsWith('.json'));
        for (const af of artifactFiles) {
          const ap = path.join(subdir, af);
          try {
            const json = JSON.parse(fs.readFileSync(ap, 'utf8'));
            // sometimes artifact has deployed address in 'networks' or in separate deployments; we can't rely on it
            // but check for name match in filename
            if (af.startsWith(name) || ap.includes(`/${name}.json`)) {
              // no address here reliably; skip
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  // 3) environment variables
  const envKey = `${name.toUpperCase()}_ADDRESS`;
  if (process.env[envKey]) return process.env[envKey];

  // 4) common alternatives
  const altEnv = {
    ArbitrationService: 'ARBITRATION_SERVICE_ADDRESS',
    ContractFactory: 'CONTRACT_FACTORY_ADDRESS'
  };
  if (altEnv[name] && process.env[altEnv[name]]) return process.env[altEnv[name]];

  return null;
}
