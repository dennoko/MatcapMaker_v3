// User-level operations shared by menus, shortcuts, buttons and drops.

import { app, ask, assets, platform, select, store, toast } from './state.svelte';
import { tt } from './i18n.svelte';
import { applyTemplate, mergeSettings, type AppSettings } from './settings';
import {
  addLayer as addLayerCmd,
  duplicateLayers,
  groupLayers,
  nudgeLayer,
  removeLayers,
  setLayerProp,
  setParam,
  ungroup,
} from '$core/commands/layerCommands';
import { createDefaultProject, createLayer, defaultViewState, findLayer, flattenLayers, isGroup } from '$core/model/project';
import type { LayerNode, Project, ViewState } from '$core/model/types';
import {
  assetFileName,
  deserializeProject,
  isLegacyV3,
  referencedAssets,
  serializeProject,
  type LoadResult,
} from '$core/io/serialize';
import { importLegacyV3 } from '$core/io/legacyV3';
import { ImageTooLargeError, MAX_IMAGE_PIXELS, mimeFromName } from '$core/io/assetStore';
import { encodePng } from '$platform/pngEncode';
import { basename, dirname, joinPath, stripExt, type ProjectBundle } from '$platform/types';
import type { ExportSpec } from '$render/export/Exporter';
import { registry } from '$core/layers/registry';
import { meshMime, parseMesh } from '$render/preview/mesh';

export const PROJECT_FILTER = [{ name: 'Matcap Maker Project', extensions: ['mcproj'] }];
export const OPEN_FILTER = [
  { name: 'Matcap Maker Project / v3 project', extensions: ['mcproj', 'json'] },
];
export const IMAGE_FILTER = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }];

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
export function saveSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    platform.settingsSave(JSON.stringify($stateSnapshot())).catch((e) => platform.log('warn', String(e)));
  }, 400);
}
function $stateSnapshot(): AppSettings {
  return JSON.parse(JSON.stringify(app.settings));
}

export async function loadSettings() {
  const raw = await platform.settingsLoad().catch(() => null);
  if (raw) {
    try {
      app.settings = mergeSettings(app.settings, JSON.parse(raw));
    } catch {
      /* corrupt settings: keep defaults */
    }
  }
}

export function updateSettings(mut: (s: AppSettings) => void) {
  mut(app.settings);
  saveSettingsSoon();
}

function pushRecent(path: string) {
  updateSettings((s) => {
    s.recentFiles = [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, 10);
  });
}

// ---------------------------------------------------------------------------
// title / dirty
// ---------------------------------------------------------------------------

export function updateTitle() {
  const name = app.filePath ? basename(app.filePath) : `${app.doc.meta.name}.mcproj`;
  platform.setTitle(`${app.dirty ? '• ' : ''}${name} — Matcap Maker`);
}

/** Asks to save unsaved changes. Returns false if the user cancelled. */
export async function confirmDiscard(): Promise<boolean> {
  if (!store.isDirty) return true;
  const r = await ask({
    title: tt('dialog.unsaved.title'),
    message: tt('dialog.unsaved.message'),
    buttons: [
      { label: tt('common.save'), value: 'save', primary: true },
      { label: tt('dialog.unsaved.discard'), value: 'discard', danger: true },
      { label: tt('common.cancel'), value: 'cancel' },
    ],
  });
  if (r === 'cancel') return false;
  if (r === 'save') return await saveProject();
  return true;
}

// ---------------------------------------------------------------------------
// project files
// ---------------------------------------------------------------------------

function setDocument(project: Project, view: ViewState, path: string | null) {
  // keep only assets the new document references
  assets.retain(referencedAssets(project, view));
  store.load(project);
  app.view = view;
  app.filePath = path;
  app.solo = [];
  app.thumbs = {};
  const first = project.layers[0];
  select(first ? [first.id] : []);
  store.markSaved();
  if (view.mesh) loadMeshAsset(view.mesh);
  else app.renderer?.setMesh(null);
  updateTitle();
}

export async function newProject(template?: Project, view?: ViewState) {
  if (!(await confirmDiscard())) return;
  const p = template ? structuredClone(template) : createDefaultProject(tt('project.untitled'));
  if (template) p.meta = { ...p.meta, name: tt('project.untitled'), modifiedAt: new Date().toISOString() };
  setDocument(p, view ? structuredClone(view) : defaultViewState(), null);
}

export async function buildBundle(project: Project, view: ViewState, withThumb = true): Promise<ProjectBundle> {
  const ids = referencedAssets(project, view);
  const bundleAssets = [];
  const metas: Project['assets'] = {};
  for (const id of ids) {
    const e = assets.get(id);
    if (!e) continue;
    metas[id] = e.meta;
    bundleAssets.push({ file: assetFileName(id, e.meta), bytes: e.bytes });
  }
  const doc: Project = { ...project, assets: metas };
  let thumbnail: Uint8Array | undefined;
  if (withThumb && app.renderer) {
    try {
      const px = app.renderer.export(doc, {
        size: 256,
        padding: 0,
        format: 'png8',
        background: [0, 0, 0],
        alphaThreshold: 0,
        smoothPadding: false,
        jpgQuality: 90,
      });
      thumbnail = encodePng(px.data, px.width, px.height, 8);
    } catch {
      /* thumbnail is optional */
    }
  }
  return { projectJson: serializeProject(doc, view), assets: bundleAssets, thumbnail };
}

export async function saveProject(forceDialog = false): Promise<boolean> {
  let path = app.filePath;
  if (!path || forceDialog || !platform.caps.overwriteSave) {
    const name = path ? basename(path) : `${app.doc.meta.name || 'matcap'}.mcproj`;
    path = await platform.pickSavePath(name, PROJECT_FILTER, tt('dialog.saveProject'));
    if (!path) return false;
    if (!path.toLowerCase().endsWith('.mcproj')) path += '.mcproj';
  }
  try {
    app.busy = tt('status.saving');
    const bundle = await buildBundle(app.doc, app.view);
    await platform.saveProject(path, bundle);
    if (platform.caps.overwriteSave) app.filePath = path;
    if (platform.caps.persistentFilePaths) pushRecent(path);
    store.markSaved();
    await platform.recoveryClear().catch(() => undefined);
    updateTitle();
    toast(tt('toast.saved', { name: basename(path) }), 'success');
    return true;
  } catch (e) {
    reportError(tt('error.save'), e);
    return false;
  } finally {
    app.busy = null;
  }
}

async function readBundleProject(bundle: ProjectBundle): Promise<LoadResult> {
  const r = deserializeProject(bundle.projectJson);
  const byFile = new Map(bundle.assets.map((a) => [a.file, a.bytes]));
  for (const [id, meta] of Object.entries(r.project.assets)) {
    const bytes = byFile.get(assetFileName(id, meta));
    if (bytes) await assets.restore(id, meta, bytes);
    else r.warnings.push({ key: 'warn.missingAsset', args: { name: meta.name } });
  }
  return r;
}

/** Opens a .mcproj or a v3 .json from a path (desktop) or bytes (web / drop). */
export async function openFile(
  src: { path?: string; name: string; bytes?: Uint8Array },
  skipConfirm = false,
  remember = true,
) {
  if (!skipConfirm && !(await confirmDiscard())) return;
  const lower = src.name.toLowerCase();
  try {
    app.busy = tt('status.loading');
    let result: LoadResult;
    let path: string | null = null;
    if (lower.endsWith('.json')) {
      const bytes = src.bytes ?? (await platform.readFile(src.path!));
      const text = new TextDecoder().decode(bytes);
      const doc = JSON.parse(text);
      if (isLegacyV3(doc)) {
        result = await importLegacyV3(text, {
          projectDir: src.path ? dirname(src.path) : '',
          name: src.path ? basename(dirname(src.path)) || stripExt(src.name) : stripExt(src.name),
          assets,
          resolve: async (p) => ({ name: basename(p), bytes: await platform.readFile(p) }),
        });
        toast(tt('toast.imported'), 'info');
      } else {
        result = deserializeProject(text);
      }
    } else {
      const bundle = await platform.loadProject({ path: src.path, bytes: src.bytes });
      result = await readBundleProject(bundle);
      path = src.path ?? null;
      if (!result.project.meta.name || result.project.meta.name === 'Untitled') result.project.meta.name = stripExt(src.name);
    }
    setDocument(result.project, result.view, platform.caps.overwriteSave ? path : null);
    if (path && remember && platform.caps.persistentFilePaths) pushRecent(path);
    if (result.warnings.length) {
      app.warnings = result.warnings;
      app.dialog = 'warnings';
    }
  } catch (e) {
    reportError(tt('error.open', { name: src.name }), e);
  } finally {
    app.busy = null;
  }
}

export async function openDialog() {
  if (!(await confirmDiscard())) return;
  const f = await platform.pickOpenFile(OPEN_FILTER, tt('dialog.openProject'));
  if (f) await openFile(f, true);
}

export async function openPath(path: string) {
  await openFile({ path, name: basename(path) });
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export function exportSpec(): ExportSpec {
  const e = app.settings.export;
  return {
    size: e.size,
    padding: e.padding,
    format: e.format,
    background: e.background,
    alphaThreshold: e.alphaThreshold,
    smoothPadding: e.smoothPadding,
    jpgQuality: e.jpgQuality,
  };
}

const EXT: Record<string, string> = { png8: 'png', png16: 'png', jpg: 'jpg', exr: 'exr' };

export function exportFileName(): string {
  const e = app.settings.export;
  return `${applyTemplate(e.template, {
    project: app.doc.meta.name || 'matcap',
    size: e.size,
    padding: e.padding,
    date: new Date().toISOString().slice(0, 10),
  })}.${EXT[e.format]}`;
}

export async function exportTo(path: string, spec: ExportSpec = exportSpec()) {
  const r = app.renderer;
  if (!r) return;
  app.busy = tt('status.exporting');
  // let the busy indicator paint before the GPU work blocks the thread
  await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
  try {
    const t0 = performance.now();
    const px = r.export(app.doc, spec);
    await platform.writeImage(px.data, { path, width: px.width, height: px.height, format: spec.format, quality: spec.jpgQuality });
    const ms = Math.round(performance.now() - t0);
    app.lastExportPath = path;
    platform.log('info', `export ${spec.size}px ${spec.format} ${ms}ms ${JSON.stringify(px.timings)}`);
    toast(
      tt('toast.exported', { name: basename(path), ms }),
      'success',
      platform.caps.revealInFolder ? { label: tt('toast.openFolder'), run: () => platform.reveal(path) } : undefined,
    );
  } catch (e) {
    reportError(tt('error.export'), e);
  } finally {
    app.busy = null;
  }
}

/** Asks for a destination (remembering the folder) and exports. */
export async function exportWithDialog(spec: ExportSpec = exportSpec()): Promise<boolean> {
  const e = app.settings.export;
  const dir = platform.caps.persistentFilePaths ? e.lastDir || (await platform.paths()).output : '';
  const f = spec.format;
  const filters = [{ name: f === 'exr' ? 'OpenEXR' : f === 'jpg' ? 'JPEG' : 'PNG', extensions: [EXT[f]] }];
  let path = await platform.pickSavePath(joinPath(dir, exportFileName()), filters, tt('dialog.exportImage'));
  if (!path) return false;
  if (!path.toLowerCase().endsWith(`.${EXT[f]}`)) path += `.${EXT[f]}`;
  if (platform.caps.persistentFilePaths) updateSettings((s) => (s.export.lastDir = dirname(path!)));
  await exportTo(path, spec);
  return true;
}

/** Ctrl+E: export with the last settings to the last folder (dialog the first time). */
export async function quickExport() {
  const e = app.settings.export;
  if (!e.lastDir || !platform.caps.persistentFilePaths) {
    app.dialog = 'export';
    return;
  }
  await exportTo(joinPath(e.lastDir, exportFileName()));
}

// ---------------------------------------------------------------------------
// layers
// ---------------------------------------------------------------------------

function insertionPoint(): { parentId: string | null; index: number } {
  const sel = app.primary;
  if (!sel) return { parentId: null, index: 0 };
  const loc = findLayer(app.doc.layers, sel.id);
  if (!loc) return { parentId: null, index: 0 };
  if (isGroup(sel) && !sel.collapsed) return { parentId: sel.id, index: 0 };
  return { parentId: loc.parentId, index: loc.index };
}

/** Adds a layer above (in front of) the selection. */
export function addLayer(type: string, params: Record<string, unknown> = {}, name?: string): LayerNode {
  const node = createLayer(type, params, name ?? (type === 'group' ? tt('layer.group.title') : undefined));
  if (type !== 'group') node.name = name ?? tt(`layer.${type}.title`, undefined, node.name);
  const { parentId, index } = insertionPoint();
  store.dispatch(addLayerCmd(node, parentId, index));
  select([node.id]);
  return node;
}

export function insertNode(node: LayerNode) {
  const { parentId, index } = insertionPoint();
  store.dispatch(addLayerCmd(node, parentId, index));
  select([node.id]);
}

export function deleteSelected() {
  if (!app.selection.length) return;
  const all = flattenLayers(app.doc.layers);
  const idx = all.findIndex((l) => l.id === app.selection[0]);
  store.dispatch(removeLayers([...app.selection]));
  const remaining = flattenLayers(app.doc.layers);
  const next = remaining[Math.min(idx, remaining.length - 1)];
  select(next ? [next.id] : []);
}

export function duplicateSelected() {
  if (!app.selection.length) return;
  const out: string[] = [];
  store.dispatch(duplicateLayers([...app.selection], out, tt('layer.copySuffix')));
  select(out);
}

export function moveSelected(delta: -1 | 1) {
  const ids = delta < 0 ? [...app.selection] : [...app.selection].reverse();
  for (const id of ids) store.dispatch(nudgeLayer(id, delta));
}

export function toggleVisibility(ids = app.selection) {
  const nodes = ids.map((id) => findLayer(app.doc.layers, id)?.node).filter(Boolean) as LayerNode[];
  if (!nodes.length) return;
  const to = !nodes[0].enabled;
  store.dispatch(setLayerProp(ids, 'enabled', to, false));
}

export function toggleSolo(id: string) {
  app.solo = app.solo.length === 1 && app.solo[0] === id ? [] : [id];
}

export function groupSelected() {
  if (!app.selection.length) return;
  const out: { id?: string } = {};
  store.dispatch(groupLayers([...app.selection], tt('layer.group.title'), out));
  if (out.id) select([out.id]);
}

export function ungroupSelected() {
  const g = app.primary;
  if (g && isGroup(g)) {
    const kids = g.children?.map((c) => c.id) ?? [];
    store.dispatch(ungroup(g.id));
    select(kids);
  }
}

export function resetParam(node: LayerNode, key: string) {
  const def = registry.get(node.type);
  const spec = def?.params[key];
  if (spec) store.dispatch(setParam(node.id, key, structuredClone(spec.default), false));
}

export function undo() {
  store.undo();
}
export function redo() {
  store.redo();
}

// ---------------------------------------------------------------------------
// images (drop / paste / pick)
// ---------------------------------------------------------------------------

export async function importImageBytes(bytes: Uint8Array, name: string) {
  const e = await assets.add(bytes, name, mimeFromName(name)).catch((err) => {
    if (!(err instanceof ImageTooLargeError)) throw err;
    throw new Error(
      tt('error.imageTooLarge', { width: err.width, height: err.height, limit: Math.round(MAX_IMAGE_PIXELS / 1e6) }),
    );
  });
  if (!e.bitmap) throw new Error(tt('error.notImage', { name }));
  store.silent((d) => {
    d.assets[e.id] = { ...e.meta };
  });
  return e;
}

export async function addImageLayer(bytes: Uint8Array, name: string) {
  try {
    const e = await importImageBytes(bytes, name);
    addLayer('image', { image: e.id, mapping: 'planar' }, stripExt(name));
  } catch (err) {
    reportError(tt('error.image'), err);
  }
}

export async function pickImage(): Promise<string | null> {
  const f = await platform.pickOpenFile(IMAGE_FILTER, tt('dialog.selectImage'));
  if (!f) return null;
  try {
    return (await importImageBytes(f.bytes, f.name)).id;
  } catch (err) {
    reportError(tt('error.image'), err);
    return null;
  }
}

export async function setNormalMapFrom(bytes: Uint8Array, name: string) {
  try {
    const e = await importImageBytes(bytes, name);
    app.view.normalMap.asset = e.id;
    if (app.view.previewShape !== 'normalMap' && app.view.split !== 'compare') app.view.split = 'compare';
  } catch (err) {
    reportError(tt('error.image'), err);
  }
}

export async function loadMeshAsset(id: string) {
  const e = assets.get(id);
  if (!e) return;
  app.renderer?.setMesh(await parseMesh(e.bytes, e.meta.name));
}

export async function setMeshFrom(bytes: Uint8Array, name: string) {
  const mesh = await parseMesh(bytes, name);
  if (!mesh) throw new Error(tt('error.mesh'));
  const e = await assets.add(bytes, name, meshMime(name));
  store.silent((d) => {
    d.assets[e.id] = { ...e.meta };
  });
  app.view.mesh = e.id;
  app.view.previewShape = 'mesh';
  app.view.split = 'single';
  app.renderer?.setMesh(mesh);
}

/** paste event (Ctrl+V): image files on the clipboard become Image layers. */
export async function handlePaste(e: ClipboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    toast(tt('toast.noClipboardImage'));
    return;
  }
  e.preventDefault();
  for (const f of files) await addImageLayer(new Uint8Array(await f.arrayBuffer()), f.name || 'clipboard.png');
}

export async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await it.getType(type);
      await addImageLayer(new Uint8Array(await blob.arrayBuffer()), `clipboard.${type.split('/')[1]}`);
      return;
    }
    toast(tt('toast.noClipboardImage'));
  } catch {
    toast(tt('toast.noClipboardImage'));
  }
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export function reportError(title: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  platform.log('error', `${title}: ${msg}${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`);
  toast(`${title}: ${msg}`, 'error', undefined, 8000);
}
