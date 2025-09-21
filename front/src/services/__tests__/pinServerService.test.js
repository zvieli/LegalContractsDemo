import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const svcPath = path.join(__dirname, '..', 'pinServerService.js')
const svc = await import(pathToFileURL(svcPath).href)

let originalFetch

beforeEach(() => {
  originalFetch = globalThis.fetch
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
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('pinServerService', () => {
  it('fetchPinnedRecord returns expected metadata', async () => {
    const rec = await svc.fetchPinnedRecord('pin_test')
    expect(rec).toBeTruthy()
    expect(rec.meta).toBeTruthy()
    expect(rec.meta.filename).toBe('evidence.txt')
  })

  it('decryptPinnedRecord returns decrypted payload', async () => {
    const dec = await svc.decryptPinnedRecord('pin_test', 'admin')
    expect(dec).toBe('TEST EVIDENCE')
  })
})
