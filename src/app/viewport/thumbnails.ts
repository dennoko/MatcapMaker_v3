// Layer thumbnails: each generator's own output downsampled to 64px,
// refreshed in idle time only for layers whose content changed.

import type { Renderer } from '$render/Renderer';
import { app, assets } from '../state.svelte';
import { flattenLayers } from '$core/model/project';
import { registry } from '$core/layers/registry';

const keys = new Map<string, string>();

const NEUTRAL_BG: Partial<Record<string, string>> = {
  add: '#000',
  screen: '#000',
  lighten: '#000',
  colorDodge: '#000',
  difference: '#000',
  subtract: '#fff',
  multiply: '#fff',
  darken: '#fff',
  overlay: '#808080',
  softLight: '#808080',
  hardLight: '#808080',
};
let pending: (() => void) | null = null;
const SIZE = 64;

function contentKey(n: { type: string; params: unknown; blendMode: string }, assetsVersion: string) {
  return `${n.type}|${n.blendMode}|${JSON.stringify(n.params)}|${assetsVersion}`;
}

/** Runs cb in idle time; returns a canceller. */
function idle(cb: () => void): () => void {
  if (typeof requestIdleCallback !== 'undefined') {
    const h = requestIdleCallback(cb, { timeout: 500 });
    return () => cancelIdleCallback(h);
  }
  const h = setTimeout(cb, 60);
  return () => clearTimeout(h);
}

export function scheduleThumbnails(r: Renderer) {
  if (pending) return;
  pending = idle(() => {
    pending = null;
    update(r);
  });
}

/** Drops a scheduled update (the renderer is going away). */
export function cancelThumbnails() {
  pending?.();
  pending = null;
}

function update(r: Renderer) {
  const nodes = flattenLayers(app.doc.layers);
  const alive = new Set(nodes.map((n) => n.id));
  const assetsVersion = assets
    .ids()
    .map((id) => `${id}@${assets.get(id)?.version}`)
    .join(',');
  let changed: Record<string, string> | null = null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const raw = document.createElement('canvas');
  raw.width = raw.height = SIZE;
  const rawCtx = raw.getContext('2d')!;
  let budget = 6; // keep each idle slice short
  for (const n of nodes) {
    const def = registry.get(n.type);
    if (!def || def.kind !== 'generator') continue;
    const k = contentKey(n, assetsVersion);
    if (keys.get(n.id) === k && app.thumbs[n.id]) continue;
    if (budget-- <= 0) {
      scheduleThumbnails(r);
      break;
    }
    const px = r.thumbnail(n, SIZE, alive);
    if (!px) continue;
    // show the layer over the backdrop its blend mode is neutral against, so
    // e.g. an additive light reads as a light instead of a faint alpha mask
    rawCtx.putImageData(new ImageData(new Uint8ClampedArray(px), SIZE, SIZE), 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const neutral = NEUTRAL_BG[n.blendMode];
    if (neutral) {
      ctx.fillStyle = neutral;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(raw, 0, 0);
    changed ??= { ...app.thumbs };
    changed[n.id] = canvas.toDataURL();
    keys.set(n.id, k);
  }
  for (const id of Object.keys(app.thumbs)) {
    if (!alive.has(id)) {
      changed ??= { ...app.thumbs };
      delete changed[id];
      keys.delete(id);
    }
  }
  if (changed) app.thumbs = changed;
}
