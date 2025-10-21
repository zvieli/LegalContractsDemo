import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

const gzip = promisify(zlib.gzip);

class RotatingLogger {
  constructor(opts = {}) {
    this.dir = opts.dir || path.join(process.cwd(), 'server', 'logs');
    this.baseName = opts.baseName || 'server.log';
    this.maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : 5 * 1024 * 1024; // 5MB default
    this.compress = opts.compress !== false; // default true
    this.maxArchived = typeof opts.maxArchived === 'number' ? opts.maxArchived : 20;
    this.stream = null;
    this.currentPath = path.join(this.dir, this.baseName);
    this._ensureDir();
    this._openStream();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  _openStream() {
    this.stream = fs.createWriteStream(this.currentPath, { flags: 'a' });
  }

  async _rotate() {
    try {
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedName = `${this.baseName.replace(/\.log$/, '')}.${timestamp}.log`;
      const rotatedPath = path.join(this.dir, rotatedName);
      // rename current file
      try { fs.renameSync(this.currentPath, rotatedPath); } catch (e) { /* no-op */ }
      // async compress
      if (this.compress) {
        (async () => {
          try {
            const data = await fs.promises.readFile(rotatedPath);
            const gz = await gzip(data);
            const gzPath = rotatedPath + '.gz';
            await fs.promises.writeFile(gzPath, gz);
            // remove plain rotated file after successful compression
            await fs.promises.unlink(rotatedPath).catch(() => {});
            // prune old archives
            this._pruneArchived();
          } catch (e) {
            // if compression fails, keep the rotated file
          }
        })();
      } else {
        // prune archives even if not compressing
        this._pruneArchived();
      }
    } catch (e) {
      // swallow to avoid crashing logger
    } finally {
      this._openStream();
    }
  }

  async _pruneArchived() {
    try {
      const files = await fs.promises.readdir(this.dir);
      const archives = files
        .filter(f => f.startsWith(this.baseName.replace(/\.log$/, '') + '.'))
        .map(f => ({ name: f, path: path.join(this.dir, f) }));
      if (archives.length <= this.maxArchived) return;
      // sort by mtime ascending
      const stats = await Promise.all(archives.map(async a => ({ ...(await fs.promises.stat(a.path)), name: a.name, path: a.path })));
      stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toDelete = stats.slice(0, stats.length - this.maxArchived);
      for (const item of toDelete) {
        try { await fs.promises.unlink(item.path); } catch (e) { }
      }
    } catch (e) {
      // ignore prune errors
    }
  }

  async _shouldRotate() {
    try {
      const st = await fs.promises.stat(this.currentPath).catch(() => null);
      if (!st) return false;
      return st.size >= this.maxBytes;
    } catch (e) { return false; }
  }

  async write(chunk) {
    try {
      if (!this.stream) this._openStream();
      const need = await this._shouldRotate();
      if (need) await this._rotate();
      // ensure stream still open
      if (!this.stream) this._openStream();
      return this.stream.write(typeof chunk === 'string' ? chunk : chunk.toString());
    } catch (e) {
      // best-effort
      return false;
    }
  }
}

export default RotatingLogger;
