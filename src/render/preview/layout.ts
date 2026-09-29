import type { ViewState } from '$core/model/types';

export interface Disc {
  cx: number;
  cy: number;
  r: number;
  /** 0 sphere, 1 flat, 2 normal-mapped */
  shape: 0 | 1 | 2;
}

export interface PreviewLayout {
  layout: 0 | 1 | 2;
  discs: Disc[];
  swipeX: number;
}

/** Screen layout of the preview in CSS pixels (shared by renderer and gizmos). */
export function computeLayout(w: number, h: number, view: ViewState): PreviewLayout {
  const zoom = view.zoom;
  const shape: Disc['shape'] = view.previewShape === 'flat' ? 1 : view.previewShape === 'normalMap' ? 2 : 0;
  if (view.split === 'compare') {
    const r = Math.min(w / 2, h) * 0.44 * zoom;
    return {
      layout: 1,
      discs: [
        { cx: w * 0.25, cy: h / 2, r, shape: shape === 2 ? 0 : shape },
        { cx: w * 0.75, cy: h / 2, r, shape: 2 },
      ],
      swipeX: 0,
    };
  }
  const r = Math.min(w, h) * 0.44 * zoom;
  const disc: Disc = { cx: w / 2, cy: h / 2, r, shape };
  if (view.split === 'beforeAfter') {
    return { layout: 2, discs: [disc], swipeX: disc.cx - r + 2 * r * view.swipe };
  }
  return { layout: 0, discs: [disc], swipeX: 0 };
}

/** Screen point → matcap-space point (p in -1..1, y up) for a disc. */
export function screenToDisc(d: Disc, x: number, y: number): [number, number] {
  return [(x - d.cx) / d.r, -(y - d.cy) / d.r];
}

export function discToScreen(d: Disc, px: number, py: number): [number, number] {
  return [d.cx + px * d.r, d.cy - py * d.r];
}

/** Picks the disc under a screen point (the first disc if none). */
export function hitDisc(l: PreviewLayout, x: number, y: number): Disc {
  let best = l.discs[0];
  let bestD = Infinity;
  for (const d of l.discs) {
    const dd = Math.hypot(x - d.cx, y - d.cy) / d.r;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}
