// User presets live in Documents/MatcapMaker/presets as .mcproj files.
// "<name>.layer.mcproj" = layer preset (inserted into the current project),
// anything else = project preset (template for a new project).

import { app, assets, platform, store, toast } from '../state.svelte';
import { buildBundle, insertNode, reportError } from '../actions';
import { tt } from '../i18n.svelte';
import { assetFileName, deserializeProject, type LoadResult } from '$core/io/serialize';
import { cloneLayer, createEmptyProject, defaultViewState } from '$core/model/project';
import type { LayerNode, Project } from '$core/model/types';
import { joinPath, type StoredFile } from '$platform/types';
import { webSavePresetIndex } from '$platform/web';

export interface UserPreset {
  name: string;
  path: string;
  kind: 'layer' | 'project';
}

export async function listUserPresets(): Promise<UserPreset[]> {
  const files: StoredFile[] = await platform.presetsList().catch(() => []);
  return files.map((f) =>
    f.name.endsWith('.layer')
      ? { name: f.name.slice(0, -'.layer'.length), path: f.path, kind: 'layer' as const }
      : { name: f.name, path: f.path, kind: 'project' as const },
  );
}

export async function loadPreset(path: string): Promise<LoadResult> {
  const bundle = await platform.loadProject({ path });
  const r = deserializeProject(bundle.projectJson);
  const byFile = new Map(bundle.assets.map((a) => [a.file, a.bytes]));
  for (const [id, meta] of Object.entries(r.project.assets)) {
    const bytes = byFile.get(assetFileName(id, meta));
    if (bytes) await assets.restore(id, meta, bytes);
  }
  return r;
}

function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*.]+/g, '_').trim() || 'preset';
}

async function savePresetProject(project: Project, fileName: string) {
  const dir = (await platform.paths()).presets;
  const path = platform.kind === 'web' ? `presets/${fileName}` : joinPath(dir, fileName);
  const bundle = await buildBundle(project, defaultViewState(), true);
  await platform.saveProject(path, bundle);
  if (platform.kind === 'web') await webSavePresetIndex(fileName.replace(/\.mcproj$/, ''));
}

export async function saveLayerPreset(node: LayerNode, name: string) {
  try {
    const p = createEmptyProject(name);
    p.layers = [node];
    p.assets = { ...app.doc.assets };
    await savePresetProject(p, `${safeName(name)}.layer.mcproj`);
    toast(tt('toast.presetSaved', { name }), 'success');
  } catch (e) {
    reportError(tt('error.save'), e);
  }
}

export async function saveProjectPreset(name: string) {
  try {
    await savePresetProject({ ...store.state, meta: { ...store.state.meta, name } }, `${safeName(name)}.mcproj`);
    toast(tt('toast.presetSaved', { name }), 'success');
  } catch (e) {
    reportError(tt('error.save'), e);
  }
}

/** Inserts the layers of a layer preset above the selection. */
export async function applyLayerPreset(path: string) {
  try {
    const r = await loadPreset(path);
    store.silent((d) => Object.assign(d.assets, r.project.assets));
    for (const n of [...r.project.layers].reverse()) insertNode(cloneLayer(n));
  } catch (e) {
    reportError(tt('error.open', { name: path }), e);
  }
}
