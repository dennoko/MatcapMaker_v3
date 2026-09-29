import { AsyncUnzipInflate, Unzip, UnzipInflate, type UnzipFile } from 'fflate';

/**
 * Size limits for opening a project archive (same values as the desktop side).
 * A small or crafted zip can declare, or inflate to, far more data than fits in
 * memory, so the actually decompressed bytes are counted as they arrive.
 */
export interface UnzipLimits {
  entries: number;
  projectJson: number;
  entry: number;
  total: number;
}

export const BUNDLE_LIMITS: UnzipLimits = {
  entries: 4096,
  projectJson: 32 << 20,
  entry: 512 << 20,
  total: 1 << 30,
};

const tooLarge = (name: string, limit: number) => new Error(`${name} is too large (limit ${Math.floor(limit / 1048576)} MiB)`);

/**
 * Extracts `project.json` and `assets/*` from a project archive. Decompression
 * runs chunk by chunk (in a worker when `async`), and stops as soon as a limit
 * is exceeded instead of inflating everything first.
 */
export function unzipBundle(data: Uint8Array, limits = BUNDLE_LIMITS, async = true): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const out: Record<string, Uint8Array> = {};
    const running = new Set<UnzipFile>();
    let entries = 0;
    let total = 0;
    let pushed = false;
    let failed = false;

    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      running.forEach((f) => f.terminate());
      running.clear();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const settle = () => {
      if (!failed && pushed && running.size === 0) resolve(out);
    };

    const unzip = new Unzip((file) => {
      if (failed) return;
      if (++entries > limits.entries) return fail(new Error(`too many entries in archive (> ${limits.entries})`));
      const name = file.name.replace(/\\/g, '/');
      const isProject = name === 'project.json';
      if (!isProject && (!name.startsWith('assets/') || name.endsWith('/'))) return; // never inflated
      const limit = Math.min(isProject ? limits.projectJson : limits.entry, limits.total - total);
      if (file.originalSize !== undefined && file.originalSize > limit) return fail(tooLarge(name, limit));
      const chunks: Uint8Array[] = [];
      let size = 0;
      running.add(file);
      file.ondata = (err, chunk, final) => {
        if (failed) return;
        if (err) return fail(err);
        size += chunk.length;
        total += chunk.length;
        if (size > limit) return fail(tooLarge(name, limit));
        if (total > limits.total) return fail(tooLarge('archive', limits.total));
        chunks.push(chunk);
        if (!final) return;
        const buf = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          buf.set(c, o);
          o += c.length;
        }
        out[name] = buf;
        running.delete(file);
        settle();
      };
      file.start();
    });
    unzip.register(async ? AsyncUnzipInflate : UnzipInflate);
    try {
      unzip.push(data, true);
    } catch (e) {
      return fail(e);
    }
    pushed = true;
    settle();
  });
}
