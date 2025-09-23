// Minimal polyfills for browser environment to support packages expecting Node globals
// Provide global and Buffer for libraries like eth-crypto
if (typeof window !== 'undefined') {
  if (typeof window.global === 'undefined') {
    window.global = window;
  }
  // Minimal Buffer shim using Uint8Array to satisfy common Buffer usage in libraries
  if (typeof window.Buffer === 'undefined') {
    class BufferShim extends Uint8Array {
      constructor(input) {
        if (typeof input === 'number') {
          super(input);
        } else if (typeof input === 'string') {
          super(BufferShim._fromString(input));
        } else if (input instanceof ArrayBuffer) {
          super(input);
        } else if (Array.isArray(input)) {
          super(input);
        } else {
          super(input);
        }
      }
      static _fromString(str) {
        // UTF-8 encode
        const encoder = new TextEncoder();
        return encoder.encode(str);
      }
      static from(value, enc) {
        if (typeof value === 'string') return new BufferShim(BufferShim._fromString(value));
        if (value instanceof ArrayBuffer) return new BufferShim(value);
        if (Array.isArray(value)) return new BufferShim(value);
        return new BufferShim(value);
      }
      static alloc(size) {
        return new BufferShim(size);
      }
      static concat(list) {
        const total = list.reduce((s, b) => s + b.length, 0);
        const out = new BufferShim(total);
        let offset = 0;
        for (const b of list) {
          out.set(b, offset);
          offset += b.length;
        }
        return out;
      }
      toString(enc = 'utf8') {
        if (enc === 'hex') {
          return Array.from(this).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        const dec = new TextDecoder();
        return dec.decode(this);
      }
    }
    window.Buffer = BufferShim;
  }
}
