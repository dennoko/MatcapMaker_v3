// Screen ↔ parameter mappings for the viewport gizmos. They mirror the
// shader math so handles sit exactly on what is rendered.

import { discToScreen, screenToDisc, type Disc } from '$render/preview/layout';
import type { Vec2, Vec3 } from '$core/schema/params';

export const DEG = 180 / Math.PI;

/** Point on the disc → front-hemisphere normal (clamped to the rim). */
export function discToNormal(p: [number, number]): Vec3 {
  let [x, y] = p;
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
}

/** Angular radius (as sin) of the spot footprint for a given range. */
export function spotRadius(range: number): number {
  const c = 1 - range;
  return Math.sqrt(Math.max(0, 1 - c * c));
}

// --- image (planar mapping) -------------------------------------------------

export interface ImageXform {
  aspect: number; // w / h
  rotation: number; // degrees
  scale: number;
  scaleXY: Vec2;
  offset: Vec2;
}

const safe = (v: number) => (Math.abs(v) > 1e-4 ? v : 1e-4);

/** matcap uv (0..1, y up) → image space q (tile = [-0.5, 0.5]²); same as image.glsl. */
export function uvToImage(t: ImageXform, u: number, v: number): [number, number] {
  let x = u - 0.5;
  let y = v - 0.5;
  if (t.aspect > 1) y *= t.aspect;
  else x /= t.aspect;
  const a = t.rotation / DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // GLSL mat2(c,-s,s,c) * v
  const rx = c * x + s * y;
  const ry = -s * x + c * y;
  const sx = safe(t.scale) * safe(t.scaleXY[0]);
  const sy = safe(t.scale) * safe(t.scaleXY[1]);
  return [rx / sx - t.offset[0], ry / sy - t.offset[1]];
}

export function imageToUv(t: ImageXform, qx: number, qy: number): [number, number] {
  const sx = safe(t.scale) * safe(t.scaleXY[0]);
  const sy = safe(t.scale) * safe(t.scaleXY[1]);
  const rx = (qx + t.offset[0]) * sx;
  const ry = (qy + t.offset[1]) * sy;
  const a = t.rotation / DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let x = c * rx - s * ry;
  let y = s * rx + c * ry;
  if (t.aspect > 1) y /= t.aspect;
  else x *= t.aspect;
  return [x + 0.5, y + 0.5];
}

export function uvToScreen(d: Disc, u: number, v: number): [number, number] {
  return discToScreen(d, u * 2 - 1, v * 2 - 1);
}

export function screenToUv(d: Disc, x: number, y: number): [number, number] {
  const [px, py] = screenToDisc(d, x, y);
  return [px * 0.5 + 0.5, py * 0.5 + 0.5];
}

/** Fresnel: disc radius where the rim reaches 50% for a given power. */
export function rimHalfRadius(power: number): number {
  const nz = 1 - Math.pow(0.5, 1 / Math.max(power, 1e-3));
  return Math.sqrt(Math.max(0, 1 - nz * nz));
}

export function powerForHalfRadius(r: number): number {
  const rr = Math.min(0.999, Math.max(0.05, r));
  const nz = Math.sqrt(1 - rr * rr);
  return Math.log(0.5) / Math.log(Math.max(1e-4, 1 - nz));
}
