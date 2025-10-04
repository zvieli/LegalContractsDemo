import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { keccak256, toUtf8Bytes, randomBytes } from 'ethers';

// Lightweight buildEncryptedEnvelope replica for unit test validation (mirrors frontend logic)
function canonicalize(obj){ if(obj===null||obj===undefined) return 'null'; if(typeof obj!=='object') return JSON.stringify(obj); if(Array.isArray(obj)) return '['+obj.map(canonicalize).join(',')+']'; const k=Object.keys(obj).sort(); return '{'+k.map(x=>JSON.stringify(x)+':'+canonicalize(obj[x])).join(',')+'}'; }
function computeContentDigest(obj){ const canon = typeof obj==='string'?obj:canonicalize(obj); return keccak256(toUtf8Bytes(canon)); }
async function buildEncryptedEnvelope(contentObj){
  const jsonCanon = canonicalize(contentObj);
  const contentDigest = computeContentDigest(jsonCanon);
  const symKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(symKey), Buffer.from(iv));
  const ct = Buffer.concat([cipher.update(jsonCanon,'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = { version:1, ciphertext: ct.toString('base64'), encryption:{ aes:{ iv:Buffer.from(iv).toString('base64'), tag:tag.toString('base64'), algo:'AES-256-GCM' } }, recipients:[], contentDigest, createdAt: Date.now() };
  return { envelope, symmetricKeyHex: Buffer.from(symKey).toString('hex'), contentDigest };
}

describe('Envelope builder + decrypt CLI (legacy placeholder)', function(){
  it('buildEncryptedEnvelope produces AES envelope', async () => {
    const content = { hello: 'world', ts: 1 };
    const { envelope, symmetricKeyHex, contentDigest } = await buildEncryptedEnvelope(content, []);
    expect(envelope).to.have.property('ciphertext');
    expect(envelope.encryption).to.have.property('aes');
    expect(envelope.encryption.aes).to.have.property('iv');
    expect(envelope.encryption.aes).to.have.property('tag');
    expect(symmetricKeyHex.length).to.equal(64);
    expect(contentDigest).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it('decryptEvidence CLI handles legacy envelope', async () => {
    const legacy = {
      ciphertext: Buffer.from('hello').toString('base64'),
      recipients: [ { address: '0x0000000000000000000000000000000000000001', encryptedKey: { ciphertext: 'legacy' } } ],
      encryption: { aes: { iv: Buffer.alloc(12).toString('base64'), tag: Buffer.alloc(16).toString('base64'), algo: 'AES-256-GCM' } }
    };
    const file = path.join(process.cwd(),'evidence_storage','legacy-test.json');
    fs.writeFileSync(file, JSON.stringify(legacy,null,2));
    const script = path.join(process.cwd(),'tools','admin','decryptEvidence.js');
    const out = spawnSync(process.execPath, [script, file, '--privkey', '0x01'.padEnd(66,'0')], { encoding:'utf8' });
    expect(out.status).to.equal(0);
    expect(out.stdout).to.include('ok');
  });
});
