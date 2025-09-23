import http from 'http';
import https from 'https';

export async function fetchFromVault(vaultAddr, vaultToken, secretPath, secretKey = 'privateKey') {
  let url = vaultAddr;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/v1\//.test(secretPath)) {
    if (!secretPath.startsWith('/')) secretPath = '/' + secretPath;
    secretPath = `/v1${secretPath}`;
  }
  const fullUrl = new URL(secretPath, url).toString();

  const lib = fullUrl.startsWith('https://') ? https : http;
  const opts = {
    method: 'GET',
    headers: {
      'X-Vault-Token': vaultToken,
      'Accept': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(fullUrl, opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Vault responded with status ${res.statusCode}: ${data}`));
        }
        try {
          const obj = JSON.parse(data);
          const v2 = obj && obj.data && obj.data.data ? obj.data.data : null;
          const val = v2 && v2[secretKey] ? v2[secretKey] : (obj && obj.data && obj.data[secretKey] ? obj.data[secretKey] : null);
          if (!val) return reject(new Error('Secret key not found in Vault response'));
          resolve(val);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

export default { fetchFromVault };
