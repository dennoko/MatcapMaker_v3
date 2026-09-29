// CPU edge padding (port of v3 export_padding.dilate). Used as the fallback
// when float render targets are unavailable, and as the reference for tests.

const SHIFTS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * Grows valid (alpha > 0) pixels outward `iterations` times; each hole is
 * filled with the average RGBA of its valid 8-neighbours. In place.
 */
export function dilateRGBA8(img: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  if (iterations <= 0) return img;
  const cur = new Float32Array(img.length);
  for (let i = 0; i < img.length; i++) cur[i] = img[i];
  const next = new Float32Array(cur.length);

  for (let it = 0; it < iterations; it++) {
    next.set(cur);
    let filled = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (cur[i + 3] > 0) continue;
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          n = 0;
        for (const [dy, dx] of SHIFTS) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          if (cur[j + 3] <= 0) continue;
          r += cur[j];
          g += cur[j + 1];
          b += cur[j + 2];
          a += cur[j + 3];
          n++;
        }
        if (n > 0) {
          next[i] = r / n;
          next[i + 1] = g / n;
          next[i + 2] = b / n;
          next[i + 3] = a / n;
          filled++;
        }
      }
    }
    cur.set(next);
    if (filled === 0) break;
  }
  for (let i = 0; i < img.length; i++) img[i] = Math.round(Math.min(255, Math.max(0, cur[i])));
  return img;
}

/**
 * Reference nearest-seed padding (same result the GPU JFA converges to):
 * holes within `padding` px (euclidean) of a valid pixel take its color.
 */
export function nearestPadRGBA8(img: Uint8Array, w: number, h: number, padding: number, threshold = 0): Uint8Array {
  const out = new Uint8Array(img);
  const r = Math.ceil(padding);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (img[i + 3] / 255 > threshold) {
        out[i + 3] = 255;
        continue;
      }
      let best = -1;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          if (img[j + 3] / 255 <= threshold) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
      }
      if (best >= 0 && Math.sqrt(bestD) <= padding + 0.5) {
        out[i] = img[best];
        out[i + 1] = img[best + 1];
        out[i + 2] = img[best + 2];
        out[i + 3] = 255;
      }
    }
  }
  return out;
}
