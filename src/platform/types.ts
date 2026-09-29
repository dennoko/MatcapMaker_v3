export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PickedFile {
  name: string;
  /** Absolute path or an opaque session-scoped browser file token. */
  path?: string;
  bytes: Uint8Array;
}

export interface BundleEntry {
  /** path inside the archive, e.g. assets/<id>.png */
  file: string;
  bytes: Uint8Array;
}

export interface ProjectBundle {
  projectJson: string;
  assets: BundleEntry[];
  thumbnail?: Uint8Array;
}

export type ImageFileFormat = 'png8' | 'png16' | 'jpg' | 'exr';

export interface ImageWriteSpec {
  path: string;
  width: number;
  height: number;
  format: ImageFileFormat;
  quality?: number;
}

export interface StoredFile {
  name: string;
  path: string;
  modified: number;
}

export interface PluginSource {
  id: string;
  json: string;
  glsl: string[];
}

export interface AppPaths {
  localData: string;
  logs: string;
  documents: string;
  presets: string;
  plugins: string;
  output: string;
}

export interface DropEvent {
  /** desktop: dropped file paths */
  paths: string[];
  /** web: dropped files */
  files: PickedFile[];
  /** CSS pixel position in the window */
  x: number;
  y: number;
}

export interface PlatformCaps {
  exr: boolean;
  overwriteSave: boolean;
  revealInFolder: boolean;
  plugins: boolean;
  fileAssociation: boolean;
  persistentStorage: boolean;
  /** Paths remain valid after restarting the application. */
  persistentFilePaths: boolean;
  closeWindow: boolean;
}

export type PlatformNotice = 'storageUnavailable' | 'recoveryBusy';

export interface Platform {
  kind: 'tauri' | 'web';
  caps: PlatformCaps;
  initialize(notify: (notice: PlatformNotice) => void): Promise<void>;
  paths(): Promise<AppPaths>;
  pickOpenFile(filters: FileFilter[], title?: string): Promise<PickedFile | null>;
  /** Desktop: absolute path chosen by the user. Web: a file name for download. */
  pickSavePath(defaultName: string, filters: FileFilter[], title?: string): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  loadProject(src: { path?: string; bytes?: Uint8Array }): Promise<ProjectBundle>;
  saveProject(path: string, bundle: ProjectBundle): Promise<void>;
  writeImage(pixels: Uint8Array, spec: ImageWriteSpec): Promise<void>;
  settingsLoad(): Promise<string | null>;
  settingsSave(json: string): Promise<void>;
  recoveryPath(): Promise<string>;
  recoveryCheck(): Promise<{ path: string; modified: number } | null>;
  recoveryClear(): Promise<void>;
  presetsList(): Promise<StoredFile[]>;
  pluginsList(): Promise<PluginSource[]>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  reveal(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  setTitle(title: string): void;
  launchFile(): Promise<string | null>;
  onOpenFile(cb: (path: string) => void): void;
  onFileDrop(cb: (e: DropEvent) => void, hover?: (x: number, y: number, active: boolean) => void): void;
  /** Return false from the callback to cancel closing. */
  onCloseRequested(cb: () => Promise<boolean>): void;
  closeWindow(): Promise<void>;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '';
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '');
}
