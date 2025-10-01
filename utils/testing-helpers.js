/**
 * Testing and Tracing Utilities for Evidence Processing
 * 
 * This module provides TESTING-only helpers for debugging, tracing, and logging
 * administrative key handling and envelope encryption flows across the entire
 * evidence processing pipeline.
 * 
 * All functions in this module check for process.env.TESTING and are no-ops
 * in production environments.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Appends a trace marker to the test_trace.log file for debugging and sequencing.
 * This is ONLY active in TESTING mode.
 * @param {string} marker - A unique identifier for the trace point (e.g., "TEST_TRACE_01").
 * @param {object|function} contextData - Data to log alongside the marker (e.g., recipients list size).
 *                                       Can be a function for lazy evaluation to avoid pre-evaluation errors.
 */
export function appendTestingTrace(marker, contextData) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    
    const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
    if (!fs.existsSync(dbgDir)) {
      try {
        fs.mkdirSync(dbgDir, { recursive: true });
      } catch (e) {
        console.error('TESTING_TRACE_DIR_CREATE_ERROR', e && e.message ? e.message : e);
        return;
      }
    }
    
    // Allow lazy payloads (functions) so callers can pass expressions
    // that reference in-scope variables without evaluating at call site.
    let evalPayload = null;
    try {
      if (typeof contextData === 'function') {
        evalPayload = contextData();
      } else {
        evalPayload = contextData;
      }
    } catch (e) {
      evalPayload = { __payload_error: String(e && e.message ? e.message : e) };
    }
    
    const out = { 
      ts: new Date().toISOString(), 
      tag: String(marker), 
      payload: evalPayload 
    };
    
    const tracePath = path.join(dbgDir, 'test_trace.log');
    try {
      fs.appendFileSync(tracePath, JSON.stringify(out) + '\n', 'utf8');
      console.error('TESTING_TRACE_WRITTEN tag=' + String(marker) + ' file=' + tracePath);
    } catch (e) {
      console.error('TESTING_TRACE_WRITE_ERROR tag=' + String(marker) + ' file=' + tracePath + ' err=' + (e && e.message ? e.message : String(e)));
    }
    
    // Always print the trace payload to console as backup
    try {
      console.error('TESTING_TRACE_OUT tag=' + String(marker) + ' payload=' + JSON.stringify(evalPayload));
    } catch (e) {
      console.error('TESTING_TRACE_CONSOLE_ERROR tag=' + String(marker));
    }
  } catch (e) {
    // Fail silently in production or if there are any unexpected errors
  }
}

/**
 * Wrapper around appendTestingTrace that forces a console marker before calling appendTestingTrace.
 * This ensures traces are visible even if file writes fail.
 */
export function traceNow(marker, contextData) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    console.error('TESTING_TRACE_CALL marker=' + String(marker));
    appendTestingTrace(marker, contextData);
  } catch (e) {
    // Fail silently
  }
}

/**
 * Initialize the test trace log with a startup marker.
 * Should be called once when starting TESTING mode processes.
 */
export function initializeTestTrace(context = {}) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    
    const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
    if (!fs.existsSync(dbgDir)) {
      fs.mkdirSync(dbgDir, { recursive: true });
    }
    
    const tracePath = path.join(dbgDir, 'test_trace.log');
    const startupEntry = {
      ts: new Date().toISOString(),
      tag: 'TEST_TRACE_STARTUP',
      payload: { 
        pid: process.pid,
        module: context.module || 'unknown',
        ...context 
      }
    };
    
    try {
      fs.appendFileSync(tracePath, JSON.stringify(startupEntry) + '\n', 'utf8');
      console.error('TESTING_TRACE_STARTUP_WRITTEN file=' + tracePath);
    } catch (e) {
      console.error('TESTING_TRACE_STARTUP_ERROR', e && e.message ? e.message : String(e));
    }
  } catch (e) {
    // Fail silently
  }
}

/**
 * Normalize a public key for use with EthCrypto (canonical form).
 * Returns lowercase hex string with '04' prefix for uncompressed keys.
 */
export function normalizePubForEthCrypto(pub) {
  if (!pub) return null;
  let s = String(pub).trim();
  if (s.startsWith('0x')) s = s.slice(2);
  if (s.length === 128 && !s.startsWith('04')) s = '04' + s;
  if (s.length === 130 && !s.startsWith('04')) s = '04' + s;
  return s.toLowerCase();
}

/**
 * Canonicalize an Ethereum address (ensure 0x prefix and lowercase).
 */
export function canonicalizeAddress(addr) {
  if (!addr) return null;
  let s = String(addr).trim();
  if (!s) return null;
  if (!s.startsWith('0x')) s = '0x' + s;
  return s.toLowerCase();
}

/**
 * Log TESTING information about admin key derivation and recipient processing.
 * This helps debug which admin key is being used and how recipients are processed.
 */
export function logAdminKeyDerivation(context) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    
    const {
      adminPubArg,
      ADMIN_PUB,
      finalAdminPub,
      finalAdminNorm,
      finalAdminAddr,
      derivedAdminAddr,
      candidateAddrs
    } = context;
    
    console.error('TESTING_ADMIN_DERIVATION adminPubArg=' + String(adminPubArg));
    console.error('TESTING_ADMIN_DERIVATION ADMIN_PUB=' + String(ADMIN_PUB));
    console.error('TESTING_ADMIN_DERIVATION finalAdminPub=' + String(finalAdminPub));
    console.error('TESTING_ADMIN_DERIVATION finalAdminNorm=' + String(finalAdminNorm));
    console.error('TESTING_ADMIN_DERIVATION finalAdminAddr=' + String(finalAdminAddr));
    console.error('TESTING_ADMIN_DERIVATION derivedAdminAddr=' + String(derivedAdminAddr));
    console.error('TESTING_ADMIN_DERIVATION candidateAddrs=' + JSON.stringify(candidateAddrs || []));
  } catch (e) {
    // Fail silently
  }
}

/**
 * Log TESTING information about recipient entries processing.
 */
export function logRecipientProcessing(context) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    
    const { 
      recipientEntries, 
      phase, 
      additionalInfo = {} 
    } = context;
    
    const entriesInfo = (recipientEntries || []).map(r => ({
      address: r.address,
      pubkey: r.pubkey ? (r.pubkey.slice(0, 12) + '...') : null,
      hasEncrypted: !!r.encryptedKey
    }));
    
    console.error('TESTING_RECIPIENT_PROCESSING phase=' + String(phase) + ' count=' + entriesInfo.length);
    console.error('TESTING_RECIPIENT_PROCESSING entries=' + JSON.stringify(entriesInfo));
    
    if (Object.keys(additionalInfo).length > 0) {
      console.error('TESTING_RECIPIENT_PROCESSING additional=' + JSON.stringify(additionalInfo));
    }
  } catch (e) {
    // Fail silently
  }
}

/**
 * Check if recipient already has encrypted key to avoid re-encryption.
 * Returns true if recipient should be skipped.
 */
export function shouldSkipRecipient(recipientEntries, canonAddr) {
  try {
    if (!(process && process.env && process.env.TESTING)) return false;
    
    const exists = recipientEntries.find(r => 
      r.address && 
      r.address.toLowerCase() === canonAddr && 
      r.encryptedKey
    );
    
    if (exists) {
      console.error('TESTING_SKIP_EXISTING_RECIP addr=' + canonAddr + ' reason=already_encrypted');
      return true;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Write a debug dump file with detailed encryption context.
 * Used for correlating encryption parameters between producer and consumer.
 */
export function writeDebugDump(filename, context) {
  try {
    if (!(process && process.env && process.env.TESTING)) return;
    
    const dbgDir = path.resolve(__dirname, '..', '..', 'evidence_storage');
    if (!fs.existsSync(dbgDir)) {
      fs.mkdirSync(dbgDir, { recursive: true });
    }
    
    const filePath = path.join(dbgDir, filename);
    const content = {
      ts: new Date().toISOString(),
      ...context
    };
    
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
    console.error('TESTING_DEBUG_DUMP_WRITTEN file=' + filePath);
  } catch (e) {
    console.error('TESTING_DEBUG_DUMP_ERROR file=' + filename + ' err=' + (e && e.message ? e.message : String(e)));
  }
}