import type { AssetId, AssetMeta } from '../model/types';

export interface AssetEntry {
  id: AssetId;
  meta: AssetMeta;
  bytes: Uint8Array;
  /** Decoded image (y flipped for GL upload), created lazily. */
  bitmap?: ImageBitmap;
  /** Bumped when the bitmap changes so GPU caches can refresh. */
  version: number;
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

type Listener = (id: AssetId) => void;

export class AssetStore {
  private entries = new Map<AssetId, AssetEntry>();
  private listeners = new Set<Listener>();

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
    };
    if (mime.startsWith('image/')) await this.decode(entry);
    this.entries.set(id, entry);
    this.listeners.forEach((l) => l(id));
    return entry;
  }

  /** Restores an entry loaded from a project file (id and meta are trusted). */
  async restore(id: AssetId, meta: AssetMeta, bytes: Uint8Array) {
    const entry: AssetEntry = { id, bytes, meta: { ...meta }, version: 1 };
    if (meta.mime.startsWith('image/')) await this.decode(entry).catch(() => undefined);
    this.entries.set(id, entry);
    this.listeners.forEach((l) => l(id));
  }

  private async decode(entry: AssetEntry) {
    if (typeof createImageBitmap === 'undefined') return;
    const blob = new Blob([entry.bytes as unknown as ArrayBuffer], { type: entry.meta.mime });
    const bmp = await createImageBitmap(blob, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    entry.bitmap?.close();
    entry.bitmap = bmp;
    entry.meta.width = bmp.width;
    entry.meta.height = bmp.height;
    entry.version++;
  }

  /** Drops entries not referenced by the given ids. */
  retain(ids: Set<AssetId>) {
    for (const [id, e] of this.entries) {
      if (!ids.has(id)) {
        e.bitmap?.close();
        this.entries.delete(id);
      }
    }
  }

  clear() {
    this.retain(new Set());
  }
}
