import type { AssetId, AssetMeta } from '../model/types';

export interface AssetEntry {
  id: AssetId;
  meta: AssetMeta;
  bytes: Uint8Array;
  /** Decoded image (y flipped for GL upload), created lazily. */
  bitmap?: ImageBitmap;
  /** Bumped when the bitmap changes so GPU caches can refresh. */
  version: number;
  /** Date.now() when the entry was added (fresh imports survive a collection). */
  addedAt?: number;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/tiff': 'tif',
  'text/plain': 'txt',
  'model/obj': 'obj',
  'model/gltf-binary': 'glb',
};

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp',
    gif: 'image/gif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    obj: 'model/obj',
    glb: 'model/gltf-binary',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function extFromMime(mime: string, fallbackName = ''): string {
  return MIME_EXT[mime] ?? (fallbackName.split('.').pop()?.toLowerCase() || 'bin');
}

/** Content hash used as AssetId (deduplicates identical files). */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)]
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // FNV-1a fallback
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}

/** Largest image (in pixels) that is decoded; 8192² RGBA8 is already 256 MiB. */
export const MAX_IMAGE_PIXELS = 8192 * 8192;

/** Reads width/height from the file header (PNG, JPEG, GIF, BMP, WebP) without decoding. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u32le = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && ascii(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8) };
  if (b.length >= 26 && ascii(0, 2) === 'BM') return { width: Math.abs(u32le(18) | 0), height: Math.abs(u32le(22) | 0) };
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8L') {
      const bits = u32le(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type Listener = (id: AssetId) => void;

export class AssetStore {
  private entries = new Map<AssetId, AssetEntry>();
  private listeners = new Set<Listener>();
  private removeListeners = new Set<Listener>();

  get(id: AssetId | null | undefined): AssetEntry | undefined {
    return id ? this.entries.get(id) : undefined;
  }

  has(id: AssetId) {
    return this.entries.has(id);
  }

  ids(): AssetId[] {
    return [...this.entries.keys()];
  }

  onChange(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Called after an entry was dropped (GPU caches release their copy). */
  onRemove(l: Listener) {
    this.removeListeners.add(l);
    return () => this.removeListeners.delete(l);
  }

  /** Adds raw file bytes; returns the (content-hash) id and metadata. */
  async add(bytes: Uint8Array, name: string, mime = mimeFromName(name)): Promise<AssetEntry> {
    const id = await hashBytes(bytes);
    const existing = this.entries.get(id);
    if (existing) return existing;
    const entry: AssetEntry = {
      id,
      bytes,
      version: 1,
      meta: { name, mime, ext: extFromMime(mime, name), width: 0, height: 0 },
      addedAt: Date.now(),
    };
    if (mime.startsWith('image/')) await this.decode(entry);
    this.entries.set(id, entry);
    this.listeners.forEach((l) => l(id));
    return entry;
  }

  /** Restores an entry loaded from a project file (id and meta are trusted). */
  async restore(id: AssetId, meta: AssetMeta, bytes: Uint8Array) {
    const prev = this.entries.get(id);
    // re-opening the same project / preset: keep the decoded entry as is
    if (prev && prev.meta.mime === meta.mime && sameBytes(prev.bytes, bytes)) {
      prev.addedAt = Date.now();
      return;
    }
    // versions keep increasing across replacements so GPU caches refresh
    const entry: AssetEntry = { id, bytes, meta: { ...meta }, version: prev?.version ?? 0, addedAt: Date.now() };
    if (meta.mime.startsWith('image/')) await this.decode(entry).catch(() => undefined);
    if (!entry.bitmap) entry.version++;
    const old = this.entries.get(id);
    this.entries.set(id, entry);
    // the replaced bitmap is closed only once the new entry is in place
    if (old && old !== entry && old.bitmap !== entry.bitmap) old.bitmap?.close();
    this.listeners.forEach((l) => l(id));
  }

  private async decode(entry: AssetEntry) {
    if (typeof createImageBitmap === 'undefined') return;
    const dim = imageSize(entry.bytes);
    if (dim && dim.width * dim.height > MAX_IMAGE_PIXELS) throw new ImageTooLargeError(dim.width, dim.height);
    const blob = new Blob([entry.bytes as unknown as ArrayBuffer], { type: entry.meta.mime });
    const bmp = await createImageBitmap(blob, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    if (bmp.width * bmp.height > MAX_IMAGE_PIXELS) {
      bmp.close();
      throw new ImageTooLargeError(bmp.width, bmp.height);
    }
    entry.bitmap?.close();
    entry.bitmap = bmp;
    entry.meta.width = bmp.width;
    entry.meta.height = bmp.height;
    entry.version++;
  }

  /**
   * Drops entries not referenced by the given ids. Entries added less than
   * `graceMs` ago are kept (they may be about to be referenced).
   */
  retain(ids: Set<AssetId>, graceMs = 0) {
    const removed: AssetId[] = [];
    const now = Date.now();
    for (const [id, e] of this.entries) {
      if (!ids.has(id) && !(graceMs > 0 && now - (e.addedAt ?? 0) < graceMs)) {
        e.bitmap?.close();
        this.entries.delete(id);
        removed.push(id);
      }
    }
    for (const id of removed) this.removeListeners.forEach((l) => l(id));
  }

  clear() {
    this.retain(new Set());
  }
}

export class ImageTooLargeError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(`Image too large (${width}x${height}, limit ${MAX_IMAGE_PIXELS / 1048576} MP)`);
  }
}
