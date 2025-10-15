import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'

/**
 * העלאת סעיפים מותאמים אישית ל-IPFS/Helia והחזרת ה-hash
 * @param {string} clauses - טקסט של סעיפי חוזה מותאמים אישית
 * @returns {Promise<string|null>} CID string או null במקרה של שגיאה
 */
export async function uploadCustomClausesToIPFS(clauses) {
  if (!clauses || typeof clauses !== 'string' || clauses.trim() === '') return null

  try {
    const cid = await addJson({ customClauses: clauses })
    const cidStr = cid.toString().replace(/^ipfs:\/\//, '') // להחזיר רק את ה-hash הנקי
    console.log('📦 Uploaded custom clauses CID:', cidStr)
    return cidStr
  } catch (e) {
    console.error('❌ Failed to upload custom clauses to IPFS:', e)
    return null
  }
}

// משתנים פנימיים לשמירה על מופע יחיד (Singleton)
let _helia = null
let _fs = null

/** יוצר או מחזיר מופע Helia יחיד */
export async function getHelia() {
  if (_helia) return _helia
  _helia = await createHelia()
  return _helia
}

/** יוצר או מחזיר מופע UnixFS יחיד */
export async function getUnixFs() {
  if (_fs) return _fs
  const h = await getHelia()
  _fs = unixfs(h)
  return _fs
}

/** העלאת JSON ל-IPFS והחזרת CID */
export async function addJson(obj) {
  const fs = await getUnixFs()
  const bytes = new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj))
  const cid = await fs.addBytes(bytes)
  return cid.toString()
}

/** קריאת JSON מתוך IPFS לפי CID */
export async function catJson(cid) {
  try {
    const fs = await getUnixFs()
    const decoder = new TextDecoder()
    let data = ''
    for await (const chunk of fs.cat(cid)) {
      data += decoder.decode(chunk, { stream: true })
      if (data.length > 5_000_000) break // 5MB cap
    }
    return JSON.parse(data)
  } catch (e) {
    console.error('⚠️ Failed to read JSON from IPFS:', e)
    return null
  }
}

/** העלאת bytes גולמיים ל-IPFS */
export async function addBytesToHelia(bytes) {
  const fs = await getUnixFs()
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const cid = await fs.addBytes(data)
  return cid.toString()
}

/** קריאת bytes גולמיים מ-IPFS לפי CID */
export async function catBytes(cid, maxBytes = 10_000_000) {
  const fs = await getUnixFs()
  const chunks = []
  let total = 0

  for await (const chunk of fs.cat(cid)) {
    chunks.push(chunk)
    total += chunk.length
    if (total > maxBytes) break
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }

  return out
}
