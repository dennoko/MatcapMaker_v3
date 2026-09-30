import { describe, expect, it } from 'vitest';
import { dilateRGBA8, nearestPadRGBA8 } from '../../src/core/io/padding';
import { flattenRGBA8 } from '../../src/render/export/Exporter';
import { defaultSettings, mergeSettings } from '../../src/app/settings';

function disc(size: number, r: number) {
  const img = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) <= r) {
        img[i] = x * 8;
        img[i + 1] = y * 8;
        img[i + 2] = 100;
        img[i + 3] = 255;
      }
    }
  return img;
}

describe('edge padding', () => {
  it('dilate grows the valid region by N pixels (v3 behaviour)', () => {
    const img = disc(32, 8);
    const before = img.filter((_, i) => i % 4 === 3 && img[i] > 0).length;
    dilateRGBA8(img, 32, 32, 3);
    const after = img.filter((_, i) => i % 4 === 3 && img[i] > 0).length;
    expect(after).toBeGreaterThan(before);
    // last disc pixel on this row is x=23; a pixel 3px outside the disc along +x is filled, 6px is not
    const row = 16;
    expect(img[(row * 32 + 23 + 3) * 4 + 3]).toBeGreaterThan(0);
    expect(img[(row * 32 + 23 + 6) * 4 + 3]).toBe(0);
  });

  it('nearest padding copies the closest valid color', () => {
    const img = disc(32, 8);
    const out = nearestPadRGBA8(img, 32, 32, 4);
    const i = (16 * 32 + 16 + 10) * 4; // 3px right of the edge
    const src = (16 * 32 + 16 + 7) * 4; // edge pixel
    expect(out[i + 3]).toBe(255);
    expect(Math.abs(out[i] - img[src])).toBeLessThanOrEqual(16);
    const far = (0 * 32 + 0) * 4;
    expect(out[far + 3]).toBe(0);
  });
});

describe('outer background', () => {
  it('flattens straight alpha onto the matte color', () => {
    const img = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 0, 200, 0, 0, 128]);
    flattenRGBA8(img, [1, 1, 1]);
    expect(Array.from(img)).toEqual([0, 255, 0, 255, 255, 255, 255, 255, 227, 127, 127, 255]);
  });

  it('settings default to black and reject unknown values', () => {
    const base = defaultSettings('en');
    expect(base.export.outerBackground).toBe('black');
    expect(mergeSettings(base, { export: { outerBackground: 'white' } }).export.outerBackground).toBe('white');
    expect(mergeSettings(base, { export: { outerBackground: 'red' } }).export.outerBackground).toBe('black');
    expect(mergeSettings(base, { export: {} }).export.outerBackground).toBe('black');
  });
});
