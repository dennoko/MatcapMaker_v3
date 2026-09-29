import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { pack, unpack } from './binary';
import { basename, type Platform, type ProjectBundle } from './types';

interface BlobRef {
  file: string;
  offset: number;
  len: number;
}

const bytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

export function createTauriPlatform(): Platform {
  let cachedPaths: Awaited<ReturnType<Platform['paths']>> | null = null;
  return {
    kind: 'tauri',
    caps: { exr: true, overwriteSave: true, revealInFolder: true, plugins: true, fileAssociation: true, persistentStorage: true, persistentFilePaths: true, closeWindow: true },
    async initialize() {},

    async paths() {
      cachedPaths ??= await invoke('app_paths');
      return cachedPaths!;
    },

    async pickOpenFile(filters, title) {
      const path = await openDialog({ multiple: false, directory: false, filters, title });
      if (!path || Array.isArray(path)) return null;
      return { name: basename(path), path, bytes: await this.readFile(path) };
    },

    async pickSavePath(defaultName, filters, title) {
      const dir = (await this.paths()).documents;
      return await saveDialog({ defaultPath: defaultName.includes('\\') ? defaultName : `${dir}\\${defaultName}`, filters, title });
    },

    async readFile(path) {
      return bytes(await invoke<ArrayBuffer>('read_file', { path }));
    },

    async writeFile(path, data) {
      await invoke('write_file', data, { headers: { 'x-path': encodeURIComponent(path) } });
    },

    async fileExists(path) {
      return invoke<boolean>('file_exists', { path });
    },

    async loadProject(src) {
      if (!src.path) throw new Error('path required');
      const data = bytes(await invoke<ArrayBuffer>('load_project', { path: src.path }));
      const { json, rest } = unpack(data);
      const meta = JSON.parse(json) as { project: string; assets: BlobRef[] };
      return {
        projectJson: meta.project,
        assets: meta.assets.map((a) => ({ file: a.file, bytes: rest.slice(a.offset, a.offset + a.len) })),
      };
    },

    async saveProject(path, bundle: ProjectBundle) {
      const blobs: Uint8Array[] = [];
      let offset = 0;
      const ref = (file: string, b: Uint8Array): BlobRef => {
        const r = { file, offset, len: b.length };
        blobs.push(b);
        offset += b.length;
        return r;
      };
      const assets = bundle.assets.map((a) => ref(a.file, a.bytes));
      const thumbnail = bundle.thumbnail ? ref('thumbnail.png', bundle.thumbnail) : null;
      const meta = JSON.stringify({ path, project: bundle.projectJson, assets, thumbnail });
      await invoke('save_project', pack(meta, blobs));
    },

    async writeImage(pixels, spec) {
      await invoke('write_image', pixels, {
        headers: { 'x-spec': encodeURIComponent(JSON.stringify({ quality: 92, ...spec })) },
      });
    },

    settingsLoad: () => invoke<string | null>('settings_load'),
    settingsSave: (json) => invoke('settings_save', { json }),
    recoveryPath: () => invoke<string>('recovery_path'),
    recoveryCheck: () => invoke('recovery_check'),
    recoveryClear: () => invoke('recovery_clear'),
    presetsList: () => invoke('presets_list'),
    pluginsList: () => invoke('plugins_list'),

    log(level, message) {
      invoke('log_message', { level, message }).catch(() => undefined);
    },

    async reveal(path) {
      await revealItemInDir(path);
    },

    async openUrl(url) {
      await openUrl(url);
    },

    setTitle(title) {
      getCurrentWindow().setTitle(title).catch(() => undefined);
    },

    launchFile: () => invoke<string | null>('launch_file'),

    onOpenFile(cb) {
      listen<string>('open-file', (e) => cb(e.payload));
    },

    onFileDrop(cb, hover) {
      getCurrentWebview().onDragDropEvent((e) => {
        const dpr = window.devicePixelRatio || 1;
        const p = e.payload;
        if (p.type === 'drop') {
          hover?.(0, 0, false);
          cb({ paths: p.paths, files: [], x: p.position.x / dpr, y: p.position.y / dpr });
        } else if (p.type === 'over' || p.type === 'enter') {
          hover?.(p.position.x / dpr, p.position.y / dpr, true);
        } else {
          hover?.(0, 0, false);
        }
      });
    },

    onCloseRequested(cb) {
      getCurrentWindow().onCloseRequested(async (event) => {
        if (!(await cb())) event.preventDefault();
      });
    },

    async closeWindow() {
      await getCurrentWindow().destroy();
    },
  };
}
