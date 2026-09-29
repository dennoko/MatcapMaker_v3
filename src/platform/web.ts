import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { encodePng } from './pngEncode';
import type { Platform, PickedFile } from './types';

// Browser implementation (GitHub Pages demo / trial). Files are picked with
// <input type=file> and saved as downloads; state lives in IndexedDB.

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('matcap-maker', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    if (value === undefined) tx.objectStore('kv').delete(key);
    else tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function download(bytes: Uint8Array, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickFile(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function jpegFromRgb(rgb: Uint8Array, w: number, h: number, quality: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h * 3; i += 3, j += 4) {
    img.data[j] = rgb[i];
    img.data[j + 1] = rgb[i + 1];
    img.data[j + 2] = rgb[i + 2];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
  return new Uint8Array(await blob.arrayBuffer());
}

const RECOVERY = 'recovery';

export function createWebPlatform(): Platform {
  const pending = new Map<string, Uint8Array>();
  return {
    kind: 'web',
    async paths() {
      return { localData: '', logs: '', documents: '', presets: 'presets', plugins: '', output: '' };
    },
    async pickOpenFile(filters) {
      const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      return pickFile(accept);
    },
    async pickSavePath(defaultName) {
      return defaultName.split(/[\\/]/).pop() ?? defaultName;
    },
    async readFile(path) {
      const b = pending.get(path) ?? (await kvGet<Uint8Array>(`file:${path}`));
      if (!b) throw new Error(`File not available in the browser: ${path}`);
      return b;
    },
    async writeFile(path, bytes) {
      if (path.startsWith('presets/')) await kvSet(`file:${path}`, bytes);
      else download(bytes, path);
    },
    async fileExists(path) {
      return pending.has(path) || (await kvGet(`file:${path}`)) !== undefined;
    },
    async loadProject(src) {
      const data = src.bytes ?? (src.path ? await this.readFile(src.path) : null);
      if (!data) throw new Error('no data');
      const files = unzipSync(data);
      const projectJson = files['project.json'];
      if (!projectJson) throw new Error('project.json not found in archive');
      return {
        projectJson: strFromU8(projectJson),
        assets: Object.entries(files)
          .filter(([k]) => k.startsWith('assets/'))
          .map(([file, bytes]) => ({ file, bytes })),
      };
    },
    async saveProject(path, bundle) {
      const files: Record<string, Uint8Array> = { 'project.json': strToU8(bundle.projectJson) };
      for (const a of bundle.assets) files[a.file] = a.bytes;
      if (bundle.thumbnail) files['thumbnail.png'] = bundle.thumbnail;
      const zip = zipSync(files, { level: 6 });
      if (path === RECOVERY || path.startsWith('presets/')) await kvSet(`file:${path}`, zip);
      else download(zip, path.endsWith('.mcproj') ? path : `${path}.mcproj`);
    },
    async writeImage(pixels, spec) {
      let out: Uint8Array;
      let mime = 'image/png';
      if (spec.format === 'png8') out = encodePng(pixels, spec.width, spec.height, 8);
      else if (spec.format === 'png16') out = encodePng(pixels, spec.width, spec.height, 16);
      else if (spec.format === 'jpg') {
        out = await jpegFromRgb(pixels, spec.width, spec.height, spec.quality ?? 92);
        mime = 'image/jpeg';
      } else throw new Error('EXR export is only available in the desktop app');
      download(out, spec.path, mime);
    },
    async settingsLoad() {
      try {
        return localStorage.getItem('matcap-maker:settings');
      } catch {
        return null;
      }
    },
    async settingsSave(json) {
      try {
        localStorage.setItem('matcap-maker:settings', json);
      } catch {
        /* storage unavailable */
      }
    },
    async recoveryPath() {
      return RECOVERY;
    },
    async recoveryCheck() {
      const b = await kvGet<Uint8Array>(`file:${RECOVERY}`).catch(() => undefined);
      return b ? { path: RECOVERY, modified: (await kvGet<number>('recovery:time')) ?? 0 } : null;
    },
    async recoveryClear() {
      await kvSet(`file:${RECOVERY}`, undefined).catch(() => undefined);
    },
    async presetsList() {
      const names = (await kvGet<string[]>('presets:index')) ?? [];
      return names.map((n) => ({ name: n, path: `presets/${n}.mcproj`, modified: 0 }));
    },
    async pluginsList() {
      return [];
    },
    log(level, message) {
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(message);
    },
    async reveal() {},
    async openUrl(url) {
      window.open(url, '_blank', 'noopener');
    },
    setTitle(title) {
      document.title = title;
    },
    async launchFile() {
      return null;
    },
    onOpenFile() {},
    onFileDrop(cb, hover) {
      window.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        hover?.(e.clientX, e.clientY, true);
      });
      window.addEventListener('dragleave', () => hover?.(0, 0, false));
      window.addEventListener('drop', async (e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        hover?.(0, 0, false);
        const files = await Promise.all(
          [...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
        );
        cb({ paths: [], files, x: e.clientX, y: e.clientY });
      });
    },
    onCloseRequested(cb) {
      window.addEventListener('beforeunload', (e) => {
        // synchronous only: rely on the app's dirty flag via the callback promise shortcut
        void cb;
        if ((window as unknown as { __mmDirty?: boolean }).__mmDirty) e.preventDefault();
      });
    },
    async closeWindow() {
      window.close();
    },
  };
}

export async function webSavePresetIndex(name: string) {
  const names = (await kvGet<string[]>('presets:index')) ?? [];
  if (!names.includes(name)) await kvSet('presets:index', [...names, name]);
}

export async function webMarkRecoveryTime() {
  await kvSet('recovery:time', Math.floor(Date.now() / 1000));
}
