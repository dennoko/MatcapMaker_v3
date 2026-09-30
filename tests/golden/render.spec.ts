import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '__output__');
const REF = join(here, 'reference');
mkdirSync(OUT, { recursive: true });

interface RenderResult {
  png: string;
  rgba: number[];
  errors: string[];
  warnings: unknown[];
  ms: number;
  timings: Record<string, number>;
  glError: number;
}

const gray = { type: 'solidColor', params: { color: [0.5, 0.5, 0.5] } };
const black = { type: 'solidColor', params: { color: [0, 0, 0] } };
const project = (...layers: unknown[]) => JSON.stringify({ schemaVersion: 1, layers });

async function open(page: Page) {
  await page.goto('/tests/golden/harness.html');
  await page.waitForFunction(() => (window as unknown as { mmReady?: boolean }).mmReady === true);
}

async function render(page: Page, json: string, size = 128, padding = 0, outer = 'transparent'): Promise<RenderResult> {
  return page.evaluate(([j, s, p, o]) => (window as any).mm.render(j, s, p, 'png8', o), [json, size, padding, outer] as const);
}

function px(r: RenderResult, size: number, x: number, y: number) {
  const i = (y * size + x) * 4;
  return r.rgba.slice(i, i + 4);
}

/** Decodes an 8-bit RGBA PNG without filters (our encoder writes filter 0). */
function decodePng(buf: Buffer): { w: number; h: number; data: Uint8Array } {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { w, h, data };
}

function compareGolden(name: string, r: RenderResult) {
  const png = Buffer.from(r.png, 'base64');
  writeFileSync(join(OUT, `${name}.png`), png);
  const refPath = join(REF, `${name}.png`);
  if (!existsSync(refPath)) {
    mkdirSync(REF, { recursive: true });
    writeFileSync(refPath, png);
    test.info().annotations.push({ type: 'golden', description: `created reference ${name}.png` });
    return;
  }
  const a = decodePng(png);
  const b = decodePng(readFileSync(refPath));
  expect(a.w).toBe(b.w);
  let bad = 0;
  let maxErr = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    maxErr = Math.max(maxErr, d);
    if (d > 3) bad++;
  }
  expect(bad / a.data.length, `${name}: ${bad} channels differ (max ${maxErr})`).toBeLessThan(0.005);
}

const LAYERS: Record<string, unknown[]> = {
  solidColor: [{ type: 'solidColor', params: { color: [0.8, 0.3, 0.1] } }],
  spotLight: [{ type: 'spotLight' }, black],
  spotLightShaped: [
    { type: 'spotLight', params: { direction: [-0.4, 0.4, 0.82], scale: [2, 0.6], rotation: 30, range: 0.3, blur: 0.2 } },
    black,
  ],
  fresnel: [{ type: 'fresnel' }, black],
  fresnelMultiply: [{ type: 'fresnel', blendMode: 'multiply', params: { intensity: 0.7 } }, gray],
  noise: [{ type: 'noise', params: { intensity: 0.8, scale: 2 } }, gray],
  noiseSimplex: [{ type: 'noise', params: { noiseType: 'simplex', intensity: 0.8, scale: 2 } }, gray],
  gradient: [
    {
      type: 'gradient',
      params: {
        stops: { stops: [{ pos: 0, color: [0, 0, 1] }, { pos: 0.5, color: [1, 1, 1] }, { pos: 1, color: [1, 0, 0] }], interp: 'oklab' },
        angle: 45,
      },
    },
  ],
  gradientRadial: [{ type: 'gradient', params: { gradientType: 'radial' } }],
  colorAdjust: [{ type: 'colorAdjust', params: { hue: 0.2, saturation: 1.5, contrast: 1.3 } }, { type: 'fresnel' }, gray],
  blur: [{ type: 'blurSharpen', params: { radius: 0.6 } }, { type: 'spotLight', params: { range: 0.1, blur: 0 } }, black],
  sharpen: [{ type: 'blurSharpen', params: { mode: 'sharpen', radius: 0.3, amount: 2 } }, { type: 'noise' }, gray],
  imageMissing: [{ type: 'image' }, gray],
  curves: [{ type: 'curves', params: { curve: [{ x: 0, y: 0 }, { x: 0.3, y: 0.6 }, { x: 1, y: 1 }] } }, { type: 'spotLight' }, gray],
  colorRamp: [{ type: 'gradientMap' }, { type: 'spotLight', params: { range: 0.5, blur: 0.8 } }, black],
  chromaticAberration: [{ type: 'chromaticAberration', params: { amount: 0.05 } }, { type: 'spotLight', params: { range: 0.05, blur: 0 } }, black],
  grain: [{ type: 'grain', params: { amount: 0.3 } }, gray],
  spotFalloff: [{ type: 'spotLight', params: { range: 0.5, blur: 0.5, falloff: [{ x: 0, y: 0 }, { x: 0.5, y: 0.1 }, { x: 1, y: 1 }] } }, black],
  groupAndMask: [
    {
      type: 'group',
      blendMode: 'screen',
      children: [{ type: 'spotLight', params: { direction: [0.5, 0.5, 0.7] } }, { type: 'fresnel' }],
      mask: { enabled: true, source: 'fresnel', amount: 1, invert: true },
    },
    gray,
  ],
};

test.describe('pipeline', () => {
  test('every layer type compiles and renders (golden)', async ({ page }) => {
    await open(page);
    for (const [name, layers] of Object.entries(LAYERS)) {
      const r = await render(page, project(...layers));
      expect(r.errors, name).toEqual([]);
      expect(r.glError, name).toBe(0);
      compareGolden(name, r);
    }
  });

  test('example plugins compile and render', async ({ page }) => {
    await open(page);
    for (const [dir, files] of [['hexGrid', ['layer.glsl']], ['vignette', ['pass0.glsl']]] as const) {
      const root = join(here, '..', '..', 'examples', 'plugins', dir);
      const json = readFileSync(join(root, 'layer.json'), 'utf8');
      const glsl = files.map((f) => readFileSync(join(root, f), 'utf8'));
      await page.evaluate(([j, g]) => (window as any).mm.registerPlugin(j, g), [json, glsl] as const);
    }
    const r = await render(page, project({ type: 'vignette' }, { type: 'hexGrid' }, { type: 'spotLight' }, gray));
    expect(r.errors).toEqual([]);
    compareGolden('plugins', r);
  });

  test('differential cache matches a full re-render', async ({ page }) => {
    await open(page);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const base = [
      { id: 'a', type: 'fresnel', params: { power: 3 } },
      { id: 'b', type: 'blurSharpen', params: { radius: 0.3 } },
      { id: 'c', type: 'spotLight', params: { range: 0.3 } },
      { id: 'd', type: 'noise', params: { intensity: 0.4 } },
      { id: 'e', type: 'solidColor', params: { color: [0.3, 0.2, 0.1] } },
    ];
    void ids;
    const edits: ((l: any[]) => void)[] = [
      (l) => (l[0].params.power = 6), // front layer
      (l) => (l[3].params.seed = 5), // behind a filter
      (l) => (l[2].opacity = 0.4), // opacity only
      (l) => l.splice(1, 0, l.splice(2, 1)[0]), // reorder
      (l) => (l[4].enabled = false), // hide the base
      (l) => (l[0].blendMode = 'screen'),
    ];
    let layers = structuredClone(base);
    const first = await page.evaluate((j) => (window as any).mm.cachedRender(j), project(...layers));
    expect(first.stats.passes).toBeGreaterThan(0);
    for (const edit of edits) {
      layers = structuredClone(layers);
      edit(layers);
      const json = project(...layers);
      const c = await page.evaluate((j) => (window as any).mm.cachedRender(j), json);
      const f = await page.evaluate((j) => (window as any).mm.freshRender(j), json);
      let maxErr = 0;
      for (let i = 0; i < f.length; i++) maxErr = Math.max(maxErr, Math.abs(c.px[i] - f[i]));
      expect(maxErr, edit.toString()).toBeLessThan(1e-3);
      expect(c.stats.reused, 'something was reused').toBeGreaterThan(0);
    }
    // unchanged document: nothing is re-rendered
    const again = await page.evaluate((j) => (window as any).mm.cachedRender(j), project(...layers));
    expect(again.stats.passes).toBe(0);
  });

  test('one-shot export render matches the cached render (groups, masks, filters)', async ({ page }) => {
    await open(page);
    const json = project(
      { id: 'm', type: 'spotLight', params: { range: 0.4 }, mask: { enabled: true, source: 'layer', layerId: 'e', invert: true, amount: 0.8 } },
      { id: 'f', type: 'blurSharpen', params: { radius: 0.3 } },
      {
        id: 'g',
        type: 'group',
        blendMode: 'screen',
        opacity: 0.7,
        children: [
          { id: 'g2', type: 'group', children: [{ id: 'c', type: 'colorAdjust', params: {} }, { id: 'n', type: 'noise', params: { intensity: 0.4 } }] },
          { id: 'r', type: 'fresnel', params: { power: 3 }, mask: { enabled: true, source: 'fresnel', invert: false, amount: 1 } },
        ],
      },
      { id: 'e', type: 'solidColor', params: { color: [0.3, 0.2, 0.1] } },
    );
    const f = await page.evaluate((j) => (window as any).mm.freshRender(j), json);
    const o = await page.evaluate((j) => (window as any).mm.onceRender(j), json);
    let maxErr = 0;
    for (let i = 0; i < f.length; i++) maxErr = Math.max(maxErr, Math.abs(o[i] - f[i]));
    expect(maxErr).toBeLessThan(1e-3);
    // empty stack: transparent
    const empty = await page.evaluate((j) => (window as any).mm.onceRender(j), project());
    expect(Math.max(...empty.map(Math.abs))).toBe(0);
  });

  test('matcap space: disc mask, solid color and orientation', async ({ page }) => {
    await open(page);
    const S = 128;
    const solid = await render(page, project({ type: 'solidColor', params: { color: [1, 0, 0] } }), S);
    expect(px(solid, S, 64, 64)).toEqual([255, 0, 0, 255]);
    expect(px(solid, S, 0, 0)[3]).toBe(0);
    expect(px(solid, S, 2, 64)[3]).toBe(255);

    // light toward upper-left: brighter in the upper-left quadrant (image rows are top-down)
    const spot = await render(
      page,
      project({ type: 'spotLight', params: { direction: [-0.6, 0.6, 0.53], range: 0.3, blur: 0.1 } }, black),
      S,
    );
    const ul = px(spot, S, 40, 40)[0];
    const lr = px(spot, S, 88, 88)[0];
    expect(ul).toBeGreaterThan(200);
    expect(lr).toBeLessThan(20);

    // fresnel: rim brighter than center
    // (v3 composites rim*color with alpha=rim again, so the edge value is rim^2)
    const rim = await render(page, project({ type: 'fresnel', params: { color: [1, 1, 1], power: 1 } }, black), S);
    expect(px(rim, S, 64, 64)[0]).toBeLessThan(10);
    expect(px(rim, S, 3, 64)[0]).toBeGreaterThan(100);

    // gradient 90° = bottom (black) → top (white)
    const g = await render(page, project({ type: 'gradient' }), S);
    expect(px(g, S, 64, 8)[0]).toBeGreaterThan(200);
    expect(px(g, S, 64, 120)[0]).toBeLessThan(50);
  });

  test('blend modes follow the v3 formulas', async ({ page }) => {
    await open(page);
    const S = 32;
    const c = (v: number) => ({ type: 'solidColor', params: { color: [v, v, v] } });
    const cases: [string, number, number, number][] = [
      ['normal', 0.25, 0.75, 0.25],
      ['add', 0.25, 0.5, 0.75],
      ['add', 0.75, 0.75, 1.0],
      ['multiply', 0.5, 0.5, 0.25],
      ['screen', 0.5, 0.5, 0.75],
      ['subtract', 0.25, 0.75, 0.5],
      ['lighten', 0.25, 0.75, 0.75],
      ['darken', 0.25, 0.75, 0.25],
      ['overlay', 0.5, 0.25, 0.25],
      ['difference', 0.25, 0.75, 0.5],
      ['hardLight', 0.25, 0.5, 0.25],
      ['colorDodge', 0.5, 0.25, 0.5],
    ];
    for (const [mode, src, dst, want] of cases) {
      const r = await render(page, project({ ...c(src), blendMode: mode }, c(dst)), S);
      expect(Math.abs(px(r, S, 16, 16)[0] / 255 - want), `${mode}(${src} over ${dst})`).toBeLessThan(0.01);
    }
    // opacity
    const r = await render(page, project({ ...c(1), opacity: 0.5 }, c(0)), S);
    expect(Math.abs(px(r, S, 16, 16)[0] - 128)).toBeLessThanOrEqual(1);
  });

  test('GPU JFA padding extends edge colors', async ({ page }) => {
    await open(page);
    const S = 64;
    const r = await render(page, project({ type: 'solidColor', params: { color: [0, 1, 0] } }), S, 4);
    // ~2.6px outside the disc on the diagonal is filled
    expect(px(r, S, 7, 7)).toEqual([0, 255, 0, 255]);
    // ~8px outside stays transparent
    expect(px(r, S, 3, 3)[3]).toBe(0);
    compareGolden('padding', r);
  });

  test('outer background fills pixels beyond the padding', async ({ page }) => {
    await open(page);
    const S = 64;
    const json = project({ type: 'solidColor', params: { color: [0, 1, 0] } });
    for (const [outer, want] of [['black', [0, 0, 0, 255]], ['white', [255, 255, 255, 255]]] as const) {
      const r = await render(page, json, S, 4, outer);
      expect(px(r, S, 7, 7), outer).toEqual([0, 255, 0, 255]);
      expect(px(r, S, 3, 3), outer).toEqual(want);
      expect(px(r, S, 32, 32), outer).toEqual([0, 255, 0, 255]);
    }
  });

  test('4K export performance (informational)', async ({ page }) => {
    await open(page);
    const r = await render(page, project({ type: 'fresnel' }, { type: 'spotLight' }, gray), 4096, 16);
    expect(r.errors).toEqual([]);
    test.info().annotations.push({ type: 'perf', description: JSON.stringify(r.timings) });
    console.log('4K export timings (swiftshader):', r.timings);
  });
});
