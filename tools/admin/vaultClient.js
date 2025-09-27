/**
 * Minimal Vault KV v2 fetch helper for tests.
 * fetchFromVault(baseUrl, token, path, keyName) -> returns the secret value for keyName
 */
export async function fetchFromVault(baseUrl, token, path, keyName) {
  if (!baseUrl || !path) throw new Error('baseUrl and path required');
  const url = baseUrl.endsWith('/') ? (baseUrl.slice(0, -1) + path) : (baseUrl + path);
  const headers = { 'Accept': 'application/json' };
  if (token) headers['X-Vault-Token'] = token;
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) throw new Error('vault fetch failed: ' + res.status);
  const body = await res.json();
  // expected KV-v2 shape: { data: { data: { <key>: value } } }
  try {
    if (body && body.data && body.data.data && Object.prototype.hasOwnProperty.call(body.data.data, keyName)) {
      return body.data.data[keyName];
    }
  } catch (e) {}
  throw new Error('key not found in vault response');
}
