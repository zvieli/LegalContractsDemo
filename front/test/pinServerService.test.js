import assert from 'assert'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const svcPath = path.join(__dirname, '..', 'src', 'services', 'pinServerService.js')
const svc = await import(pathToFileURL(svcPath).href)

// Monkeypatch global.fetch
const originalFetch = globalThis.fetch

globalThis.fetch = async (url, opts) => {
  if (url.includes('/pin/')) {
    return {
      ok: true,
      json: async () => ({ meta: { filename: 'evidence.txt', size: 14 }, id: 'pin_test' })
    }
  }
  if (url.includes('/admin/decrypt/')) {
    return {
      ok: true,
      json: async () => ({ decrypted: 'TEST EVIDENCE' })
    }
  }
  return { ok: false }
}

async function run() {
  try {
    console.log('Testing fetchPinnedRecord...')
    const rec = await svc.fetchPinnedRecord('pin_test')
    assert(rec && rec.meta && rec.meta.filename === 'evidence.txt', 'fetchPinnedRecord returned unexpected data')
    console.log('fetchPinnedRecord OK')

    console.log('Testing decryptPinnedRecord...')
    const dec = await svc.decryptPinnedRecord('pin_test', 'admin')
    assert(dec === 'TEST EVIDENCE', 'decryptPinnedRecord returned unexpected data')
    console.log('decryptPinnedRecord OK')

    console.log('\nAll front pinServerService tests: OK')
    process.exit(0)
  } catch (e) {
    console.error('Test failed', e)
    process.exit(2)
  } finally {
    globalThis.fetch = originalFetch
  }
}

run()
