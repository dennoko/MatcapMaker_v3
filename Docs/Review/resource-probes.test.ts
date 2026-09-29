// Characterization probes, updated after the fixes: PASS means the reviewed
// problem no longer occurs (the original assertions reproduced it).
// Full regression tests: tests/core/resources.test.ts.
// No actual GPU allocation or image decoding occurs.
import { afterEach, expect, it, vi } from 'vitest';
import { GLContext, Program } from '../../src/render/gl/gl';
import { ResourceCache } from '../../src/render/pipeline/resources';
import { MatcapPipeline } from '../../src/render/pipeline/MatcapPipeline';
import { Exporter } from '../../src/render/export/Exporter';
import { AssetStore } from '../../src/core/io/assetStore';
import { createEmptyProject, createLayer } from '../../src/core/model/project';

function fakeContext(options: { failFramebuffer?: number; failFragment?: boolean } = {}) {
  const textures = new Map<object, number>();
  const shaders = new Set<object>();
  const constants = new Map<string, number>();
  let bound: object;
  let checks = 0;
  let peak = 0;
  const bytes = () => [...textures.values()].reduce((a, b) => a + b, 0);
  const methods: Record<string, (...args: any[]) => any> = {
    createTexture: () => { const t = {}; textures.set(t, 0); return t; },
    bindTexture: (_: number, t: object) => { bound = t; },
    deleteTexture: (t: object) => textures.delete(t),
    texStorage2D: (_: number, __: number, fmt: number, w: number, h: number) => {
      textures.set(bound, w * h * (fmt === gl.RGBA8 ? 4 : 8));
      peak = Math.max(peak, bytes());
    },
    createShader: (type: number) => { const s = { type }; shaders.add(s); return s; },
    deleteShader: (s: object) => shaders.delete(s),
    getShaderParameter: (s: { type: number }) => !(options.failFragment && s.type === gl.FRAGMENT_SHADER),
    getShaderInfoLog: () => 'injected compile failure',
    getProgramParameter: (_: object, key: number) => key === gl.LINK_STATUS ? true : 0,
    checkFramebufferStatus: () => ++checks === options.failFramebuffer ? 0 : gl.FRAMEBUFFER_COMPLETE,
  };
  const gl = new Proxy({}, {
    get: (_, key: string) => {
      if (methods[key]) return methods[key];
      if (/^[A-Z_0-9]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return key.startsWith('create') ? () => ({}) : () => undefined;
    },
  }) as WebGL2RenderingContext;
  const ctx = {
    gl, accumFormat: 'rgba16f', caps: { floatTargets: true, floatLinear: true, maxTextureSize: 16384 },
    bindTarget() {}, drawFullscreen() {},
  } as unknown as GLContext;
  return { ctx, textures, shaders, bytes, peak: () => peak };
}

afterEach(() => vi.unstubAllGlobals());

it('4K ten-generator export render peaks at 3 targets (384 MiB) and keeps only the result', () => {
  // was: 2688 MiB peak, 1408 MiB retained (render() with the differential cache)
  const f = fakeContext();
  const res = new ResourceCache(f.ctx, new AssetStore());
  const p = new MatcapPipeline(f.ctx, res, 4096);
  const doc = createEmptyProject();
  doc.layers = Array.from({ length: 10 }, () => createLayer('solidColor'));
  p.renderOnce(doc);
  expect(Math.round(f.peak() / 1048576)).toBe(384);
  expect(Math.round(p.memoryBytes / 1048576)).toBe(128);
  p.dispose(); res.dispose();
  expect(f.textures.size).toBe(0);
});

it('retaining no CPU assets also frees the uploaded GPU assets', async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 16, height: 16, close() {} }));
  const f = fakeContext();
  const assets = new AssetStore();
  const res = new ResourceCache(f.ctx, assets);
  for (let i = 0; i < 5; i++) {
    const e = await assets.add(new Uint8Array([i]), `${i}.png`);
    res.assetTexture(e.id);
    assets.clear();
  }
  expect(assets.ids()).toHaveLength(0);
  expect(f.textures.size).toBe(0);
  res.dispose();
});

it('thumbnail-only pipeline stays within the cache budget', () => {
  const f = fakeContext();
  const res = new ResourceCache(f.ctx, new AssetStore());
  const p = new MatcapPipeline(f.ctx, res, 512);
  for (let i = 0; i < 200; i++) p.layerOutput(createLayer('solidColor'));
  expect(p.memoryBytes / 1048576).toBeLessThanOrEqual(384);
  p.dispose(); res.dispose();
});

it('restoring the same image ID reuses the entry; every bitmap is closed', async () => {
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('createImageBitmap', async () => {
    const bmp = { width: 16, height: 16, close: vi.fn() };
    bitmaps.push(bmp); return bmp;
  });
  const assets = new AssetStore();
  const meta = { name: 'a.png', mime: 'image/png', ext: 'png', width: 16, height: 16 };
  await assets.restore('same', meta, new Uint8Array([1]));
  await assets.restore('same', meta, new Uint8Array([1]));
  assets.clear();
  expect(bitmaps).toHaveLength(1);
  expect(bitmaps[0].close).toHaveBeenCalledOnce();
});

it('failure of second padding target releases the first one', () => {
  // Empty 1x1 = #1; full-size backdrop = #2; padding a = #3; padding b = #4 (fails).
  const f = fakeContext({ failFramebuffer: 4 });
  const res = new ResourceCache(f.ctx, new AssetStore());
  expect(() => new Exporter(f.ctx, res).run(createEmptyProject(), {
    size: 64, padding: 4, format: 'png8', background: [0, 0, 0],
    alphaThreshold: 0, smoothPadding: false, jpgQuality: 90,
  })).toThrow('Framebuffer incomplete');
  expect(f.textures.size).toBe(0);
  res.dispose();
});

it('fragment compilation failure also deletes the compiled vertex shader', () => {
  const f = fakeContext({ failFragment: true });
  expect(() => new Program(f.ctx, 'invalid')).toThrow('Shader compile failed');
  expect(f.shaders.size).toBe(0);
});
