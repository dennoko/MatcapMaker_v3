import { zipSync, strFromU8, strToU8 } from 'fflate';
import { encodePng } from './pngEncode';
import { unzipBundle } from './unzip';
import type { Platform, PickedFile } from './types';

import { browserStorage } from './browserStorage';
import type { FileFilter, PlatformCaps, PlatformNotice } from './types';

// The File System Access API is optional; handles never leave this session.
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
interface FilePickers {
  showOpenFilePicker?: (options: object) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<FileHandle>;
}
const pickerTypes = (filters: FileFilter[]) => filters.map((f) => ({
  description: f.name, accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
}));
const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const pickerUnavailable = (error: unknown) => error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name);

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
  const pickers = window as Window & FilePickers;
  const caps: PlatformCaps = {
    exr: false, overwriteSave: !!(pickers.showOpenFilePicker && pickers.showSaveFilePicker),
    revealInFolder: false, plugins: false, fileAssociation: false, persistentStorage: true,
    persistentFilePaths: false, closeWindow: false,
  };
  let notify: (notice: PlatformNotice) => void = () => {};
  const storage = browserStorage(() => { caps.persistentStorage = false; notify('storageUnavailable'); });
  const kvGet = storage.get;
  const kvSet = (key: string, value: unknown) => storage.setMany([[key, value]]);
  const handles = new Map<string, FileHandle>();
  const remember = (handle: FileHandle) => {
    const token = `handle:${crypto.randomUUID()}/${handle.name}`;
    handles.set(token, handle);
    return token;
  };
  let ownsRecovery = false;
  let initialized: Promise<void> | undefined;
  let settingsMemory: string | null = null;
  return {
    kind: 'web',
    caps,
    initialize(onNotice) {
      notify = onNotice;
      return initialized ??= (async () => {
        await kvSet('storage:probe', true);
        try {
          localStorage.setItem('matcap-maker:probe', '1');
          localStorage.removeItem('matcap-maker:probe');
        } catch {
          if (caps.persistentStorage) notify('storageUnavailable');
          caps.persistentStorage = false;
        }
        if (!navigator.locks) { notify('recoveryBusy'); return; }
        await new Promise<void>((resolve) => {
          void navigator.locks.request('matcap-maker:recovery', { ifAvailable: true }, async (lock) => {
            ownsRecovery = !!lock;
            if (!lock) notify('recoveryBusy');
            resolve();
            // The browser releases this lock when the document is destroyed.
            if (lock) await new Promise<void>(() => {});
          }).catch(() => { notify('recoveryBusy'); resolve(); });
        });
      })();
    },
    async paths() {
      return { localData: '', logs: '', documents: '', presets: 'presets', plugins: '', output: '' };
    },
    async pickOpenFile(filters) {
      if (caps.overwriteSave) {
        try {
          const [handle] = await pickers.showOpenFilePicker!({ multiple: false, types: pickerTypes(filters) });
          const file = await handle.getFile();
          return { name: file.name, path: remember(handle), bytes: new Uint8Array(await file.arrayBuffer()) };
        } catch (error) {
          if (cancelled(error)) return null;
          if (!pickerUnavailable(error)) throw error;
          // Some embedded/file contexts expose the API but forbid its use.
          caps.overwriteSave = false;
        }
      }
      const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      return pickFile(accept);
    },
    async pickSavePath(defaultName, filters) {
      const name = defaultName.split(/[\\/]/).pop() ?? defaultName;
      if (caps.overwriteSave) {
        try {
          return remember(await pickers.showSaveFilePicker!({ suggestedName: name, types: pickerTypes(filters) }));
        } catch (error) {
          if (cancelled(error)) return null;
          if (!pickerUnavailable(error)) throw error;
          caps.overwriteSave = false;
        }
      }
      return name;
    },
    async readFile(path) {
      const handle = handles.get(path);
      if (handle) return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const b = await kvGet<Uint8Array>(`file:${path}`);
      if (!b) throw new Error(`File not available in the browser: ${path}`);
      return b;
    },
    async writeFile(path, bytes) {
      if (path.startsWith('presets/')) await kvSet(`file:${path}`, bytes);
      else if (handles.has(path)) {
        const writer = await handles.get(path)!.createWritable();
        try { await writer.write(bytes); await writer.close(); }
        catch (error) { await writer.abort().catch(() => {}); throw error; }
      } else if (path.startsWith('handle:')) throw new Error('File handle expired. Use Save As.');
      else download(bytes, path);
    },
    async fileExists(path) {
      return handles.has(path) || (await kvGet(`file:${path}`)) !== undefined;
    },
    async loadProject(src) {
      const data = src.bytes ?? (src.path ? await this.readFile(src.path) : null);
      if (!data) throw new Error('no data');
      const files = await unzipBundle(data);
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
      if (path === RECOVERY) {
        if (ownsRecovery) await storage.setMany([[`file:${path}`, zip], ['recovery:time', Math.floor(Date.now() / 1000)]]);
      } else if (path.startsWith('presets/')) {
        const name = path.slice('presets/'.length).replace(/\.mcproj$/, '');
        const names = (await kvGet<string[]>('presets:index')) ?? [];
        await storage.setMany([[`file:${path}`, zip], ['presets:index', [...new Set([...names, name])]]]);
      } else await this.writeFile(path, zip);
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
      void mime;
      await this.writeFile(spec.path, out);
    },
    async settingsLoad() {
      try {
        return localStorage.getItem('matcap-maker:settings') ?? settingsMemory;
      } catch {
        return settingsMemory;
      }
    },
    async settingsSave(json) {
      settingsMemory = json;
      try {
        localStorage.setItem('matcap-maker:settings', json);
      } catch {
        if (caps.persistentStorage) notify('storageUnavailable');
        caps.persistentStorage = false;
      }
    },
    async recoveryPath() {
      return RECOVERY;
    },
    async recoveryCheck() {
      if (!ownsRecovery) return null;
      const b = await kvGet<Uint8Array>(`file:${RECOVERY}`).catch(() => undefined);
      return b ? { path: RECOVERY, modified: (await kvGet<number>('recovery:time')) ?? 0 } : null;
    },
    async recoveryClear() {
      if (ownsRecovery) await storage.setMany([[`file:${RECOVERY}`, undefined], ['recovery:time', undefined]]);
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
