// Robust polyfills for browser environment to support packages expecting Node globals
// Provide globalThis, Buffer (prefer the 'buffer' package) and a minimal process stub.
/* global process */
(function () {
  // Ensure a global object exists
  if (typeof globalThis === 'undefined') {
    // eslint-disable-next-line no-undef
    this.globalThis = this; // fallback (should not happen in modern browsers)
  }

  // Expose global (some libs use global)
  if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;

  // Buffer: provide a shim if not present. We avoid calling `require` here to keep
  // this file parsable by ESLint and bundlers. If your bundler injects the 'buffer'
  // package automatically the global will already exist.
  if (typeof globalThis.Buffer === 'undefined') {
      class BufferShim {
        constructor(input) {
          if (typeof input === 'number') {
            this._u8 = new Uint8Array(input);
          } else if (typeof input === 'string') {
            this._u8 = new TextEncoder().encode(input);
          } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
            this._u8 = new Uint8Array(input);
          } else if (Array.isArray(input)) {
            this._u8 = new Uint8Array(input);
          } else {
            this._u8 = new Uint8Array(0);
          }
        }
        static from(input, enc) {
          if (typeof input === 'string') {
            if (!enc || enc === 'utf8' || enc === 'utf-8') {
              return new BufferShim(new TextEncoder().encode(input));
            }
            if (enc === 'hex') {
              const bytes = input.match(/.{1,2}/g).map(h => parseInt(h, 16));
              return new BufferShim(bytes);
            }
          }
          if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return new BufferShim(input);
          if (Array.isArray(input)) return new BufferShim(input);
          return new BufferShim([]);
        }
        static alloc(size, fill = 0) {
          const b = new BufferShim(size);
          if (fill) b._u8.fill(fill);
          return b;
        }
        static concat(list) {
          const total = list.reduce((s, b) => s + (b._u8 ? b._u8.length : 0), 0);
          const out = new Uint8Array(total);
          let offset = 0;
          for (const b of list) {
            const src = b._u8 || new Uint8Array(b);
            out.set(src, offset);
            offset += src.length;
          }
          const buf = new BufferShim(0);
          buf._u8 = out;
          return buf;
        }
        toString(enc = 'utf8') {
          if (enc === 'hex') return Array.from(this._u8).map(x => x.toString(16).padStart(2, '0')).join('');
          return new TextDecoder().decode(this._u8);
        }
        toJSON() {
          return { type: 'Buffer', data: Array.from(this._u8) };
        }
        get length() {
          return this._u8.length;
        }
      }
      globalThis.Buffer = BufferShim;
  }

  // process stub: provide env and nextTick at minimum
  if (typeof globalThis.process === 'undefined') {
    globalThis.process = {
      env: (function () {
        // Prefer a global injection if present (e.g. window.__ENV__ or globalThis.__ENV__)
        try {
          if (globalThis.__ENV__ && typeof globalThis.__ENV__.NODE_ENV === 'string') return { NODE_ENV: globalThis.__ENV__.NODE_ENV };
        } catch (_) {
          // ignore
        }
        return { NODE_ENV: 'development' };
      })(),
      nextTick: (cb) => Promise.resolve().then(cb),
      cwd: () => '/',
      browser: true
    };
  }
})();
