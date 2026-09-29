// File drops: projects open, images become Image layers (or the normal map
// when dropped on the normal-map field), .obj files load as preview mesh.

import { app, platform } from './state.svelte';
import { addImageLayer, openFile, reportError, setMeshFrom, setNormalMapFrom } from './actions';
import { tt } from './i18n.svelte';
import { basename, type DropEvent } from '$platform/types';

const IMAGE = /\.(png|jpe?g|webp|bmp|gif)$/i;

export type DropKind = 'project' | 'image' | 'normal' | 'mesh' | null;

/** What a drop at (x, y) would do (used for the hover hint too). */
export function dropTargetAt(x: number, y: number): 'normal' | 'viewport' | 'other' {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (el?.closest('[data-drop-normal]')) return 'normal';
  if (el?.closest('[data-drop-zone="viewport"]')) return 'viewport';
  return 'other';
}

export async function handleDrop(e: DropEvent) {
  const files: { name: string; path?: string; bytes?: Uint8Array }[] = [
    ...e.paths.map((p) => ({ name: basename(p), path: p })),
    ...e.files,
  ];
  if (!files.length) return;
  const target = dropTargetAt(e.x, e.y);
  const load = async (f: (typeof files)[number]) => f.bytes ?? (await platform.readFile(f.path!));

  // a project replaces the document: handle the first one only
  const proj = files.find((f) => /\.(mcproj|json)$/i.test(f.name));
  if (proj) {
    await openFile(proj.path ? { path: proj.path, name: proj.name } : { name: proj.name, bytes: proj.bytes });
    return;
  }
  for (const f of files) {
    try {
      if (/\.(obj|glb)$/i.test(f.name)) {
        await setMeshFrom(await load(f), f.name);
      } else if (IMAGE.test(f.name)) {
        if (target === 'normal') await setNormalMapFrom(await load(f), f.name);
        else await addImageLayer(await load(f), f.name);
      }
    } catch (err) {
      reportError(tt('error.image'), err);
    }
  }
}

export function dropHint(x: number, y: number): string {
  const t = dropTargetAt(x, y);
  return t === 'normal' ? tt('viewport.dropNormal') : tt('viewport.dropImage');
}

export function setDropHover(x: number, y: number, active: boolean) {
  app.dropHover = active ? { x, y } : null;
}
