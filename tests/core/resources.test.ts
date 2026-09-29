// GPU/CPU resource lifetimes against a counting fake WebGL2 context (no real
// GPU work): peak allocation of exports, cache cleanup, failure paths.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { GLContext, Program } from '../../src/render/gl/gl';
import { ResourceCache } from '../../src/render/pipeline/resources';
import { CACHE_BUDGET_BYTES, MatcapPipeline } from '../../src/render/pipeline/MatcapPipeline';
import { Exporter, estimateExportBytes, type ExportSpec } from '../../src/render/export/Exporter';
import { AssetStore, imageSize } from '../../src/core/io/assetStore';
import { DocumentStore } from '../../src/core/commands/store';
import { removeLayers } from '../../src/core/commands/layerCommands';
import { deserializeProject } from '../../src/core/io/serialize';
import { createEmptyProject, createLayer } from '../../src/core/model/project';
import { unzipBundle } from '../../src/platform/unzip';

function fakeContext(options: { failFramebuffer?: number; failFragment?: boolean } = {}) {
  const textures = new Map<object, number>();
  const shaders = new Set<object>();
  const constants = new Map<string, number>();
  let bound: object;
  let checks = 0;
  let peak = 0;
  const bytes = () => [...textures.values()].reduce((a, b) => a + b, 0);
  const methods: Record<string, (...args: any[]) => any> = {
    createTexture: () => {
      const t = {};
      textures.set(t, 0);
      return t;
    },
    bindTexture: (_: number, t: object) => {
      bound = t;
    },
    deleteTexture: (t: object) => textures.delete(t),
    texStorage2D: (_: number, __: number, fmt: number, w: number, h: number) => {
      textures.set(bound, w * h * (fmt === gl.RGBA8 ? 4 : 8));
      peak = Math.max(peak, bytes());
    },
    createShader: (type: number) => {
      const s = { type };
      shaders.add(s);
      return s;
    },
    deleteShader: (s: object) => shaders.delete(s),
    getShaderParameter: (s: { type: number }) => !(options.failFragment && s.type === gl.FRAGMENT_SHADER),
    getShaderInfoLog: () => 'injected compile failure',
    getProgramParameter: (_: object, key: number) => (key === gl.LINK_STATUS ? true : 0),
    checkFramebufferStatus: () => (++checks === options.failFramebuffer ? 0 : gl.FRAMEBUFFER_COMPLETE),
  };
  const gl = new Proxy(
    {},
    {
      get: (_, key: string) => {
        if (methods[key]) return methods[key];
        if (/^[A-Z_0-9]+$/.test(key)) {
          if (!constants.has(key)) constants.set(key, constants.size + 1);
          return constants.get(key);
        }
        return key.startsWith('create') ? () => ({}) : () => undefined;
      },
    },
  ) as WebGL2RenderingContext;
  const ctx = {
    gl,
    accumFormat: 'rgba16f',
    caps: { floatTargets: true, floatLinear: true, maxTextureSize: 16384 },
    bindTarget() {},
    drawFullscreen() {},
  } as unknown as GLContext;
  return { ctx, textures, shaders, bytes, peak: () => peak, resetPeak: () => (peak = bytes()) };
}

const SPEC: ExportSpec = {
  size: 256,
  padding: 4,
  format: 'png8',
  background: [0, 0, 0],
  alphaThreshold: 0,
  smoothPadding: true,
  jpgQuality: 90,
};

function tenLayers() {
  const doc = createEmptyProject();
  doc.layers = Array.from({ length: 10 }, () => createLayer('solidColor'));
  return doc;
}

afterEach(() => vi.unstubAllGlobals());

describe('export memory (R1)', () => {
  it('one-shot render peaks at a few targets regardless of the layer count', () => {
    const f = fakeContext();
    const res = new ResourceCache(f.ctx, new AssetStore());
    const p = new MatcapPipeline(f.ctx, res, 4096);
    const unit = 4096 * 4096 * 8;
    const doc = tenLayers();
    p.renderOnce(doc);
    expect(f.peak()).toBeLessThanOrEqual(MatcapPipeline.onceTargets(doc.layers) * unit + 8);
    expect(f.peak()).toBeLessThanOrEqual(3 * unit + 8);
    // only the result stays
    expect(p.memoryBytes).toBe(unit + 8);
    p.dispose();
    res.dispose();
    expect(f.textures.size).toBe(0);
  });

  it('nested groups, filters and layer masks stay within the estimate', () => {
    const f = fakeContext();
    const res = new ResourceCache(f.ctx, new AssetStore());
    const p = new MatcapPipeline(f.ctx, res, 512);
    const unit = 512 * 512 * 8;
    const doc = createEmptyProject();
    const base = createLayer('solidColor');
    const inner = createLayer('group');
    inner.children = [createLayer('colorAdjust'), createLayer('solidColor'), createLayer('solidColor')];
    const outer = createLayer('group');
    outer.children = [inner, createLayer('solidColor')];
    const masked = createLayer('solidColor');
    masked.mask = { enabled: true, source: 'layer', layerId: base.id, invert: false, amount: 1 };
    doc.layers = [masked, createLayer('blurSharpen'), outer, base];
    p.renderOnce(doc);
    expect(f.peak()).toBeLessThanOrEqual(MatcapPipeline.onceTargets(doc.layers) * unit + 8);
    p.dispose();
    res.dispose();
    expect(f.textures.size).toBe(0);
  });

  it('export with padding stays within estimateExportBytes and releases everything', () => {
    const f = fakeContext();
    const res = new ResourceCache(f.ctx, new AssetStore());
    const doc = tenLayers();
    new Exporter(f.ctx, res).run(doc, SPEC);
    expect(f.peak()).toBeLessThanOrEqual(estimateExportBytes(doc, SPEC, 'rgba16f'));
    expect(f.textures.size).toBe(0);
    res.dispose();
  });

  it('refuses exports whose estimate exceeds the limit before allocating', () => {
    const f = fakeContext();
    const res = new ResourceCache(f.ctx, new AssetStore());
    expect(() => new Exporter(f.ctx, res).run(tenLayers(), { ...SPEC, size: 16384 })).toThrow(/GPU memory/);
    expect(f.peak()).toBe(0);
  });
});

describe('asset lifetimes (R2, R4, R5)', () => {
  it('dropping CPU assets frees their GPU textures', async () => {
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

  it('restoring the same bytes keeps the entry; different bytes close the old bitmap', async () => {
    const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('createImageBitmap', async () => {
      const bmp = { width: 16, height: 16, close: vi.fn() };
      bitmaps.push(bmp);
      return bmp;
    });
    const assets = new AssetStore();
    const meta = { name: 'a.png', mime: 'image/png', ext: 'png', width: 16, height: 16 };
    await assets.restore('same', meta, new Uint8Array([1]));
    await assets.restore('same', meta, new Uint8Array([1]));
    expect(bitmaps).toHaveLength(1);
    const v1 = assets.get('same')!.version;
    await assets.restore('same', meta, new Uint8Array([2]));
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(assets.get('same')!.version).toBeGreaterThan(v1);
    assets.clear();
    expect(bitmaps[1].close).toHaveBeenCalledOnce();
  });

  it('keeps fresh imports during a collection', async () => {
    const assets = new AssetStore();
    const e = await assets.add(new Uint8Array([1, 2, 3]), 'm.obj');
    assets.retain(new Set(), 10_000);
    expect(assets.has(e.id)).toBe(true);
    assets.retain(new Set());
    expect(assets.has(e.id)).toBe(false);
  });

  it('history keeps the asset ids of removed layers reachable', () => {
    const doc = createEmptyProject();
    const img = createLayer('image', { image: 'asset-in-history' });
    doc.layers = [img];
    const store = new DocumentStore(doc);
    store.dispatch(removeLayers([img.id]));
    expect(store.state.layers).toHaveLength(0);
    expect(store.historyStrings().has('asset-in-history')).toBe(true);
    store.load(createEmptyProject());
    expect(store.historyStrings().has('asset-in-history')).toBe(false);
  });

  it('reads image sizes from headers', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    png.set([0, 0, 0x20, 0, 0, 0, 0x10, 0], 16);
    expect(imageSize(png)).toEqual({ width: 8192, height: 4096 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0, 0x20, 0]);
    expect(imageSize(gif)).toEqual({ width: 16, height: 32 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('thumbnail pipeline (R3)', () => {
  it('stays within the cache budget and drops layers that no longer exist', () => {
    const f = fakeContext();
    const res = new ResourceCache(f.ctx, new AssetStore());
    const p = new MatcapPipeline(f.ctx, res, 512);
    for (let i = 0; i < 200; i++) p.layerOutput(createLayer('solidColor'));
    expect(p.memoryBytes).toBeLessThanOrEqual(CACHE_BUDGET_BYTES);
    const last = createLayer('solidColor');
    p.layerOutput(last, new Set([last.id]));
    expect(p.memoryBytes).toBe(512 * 512 * 8 + 8 + 6 * 512 * 512 * 8); // one slot, empty 1x1, pool
    p.dispose();
    res.dispose();
    expect(f.textures.size).toBe(0);
  });
});

describe('failure paths (R6, R8)', () => {
  it('a failing padding allocation releases the targets created before it', () => {
    // #1 empty 1x1, #2 full-size backdrop, #3 seed a, #4 seed b (fails)
    const f = fakeContext({ failFramebuffer: 4 });
    const res = new ResourceCache(f.ctx, new AssetStore());
    expect(() => new Exporter(f.ctx, res).run(createEmptyProject(), { ...SPEC, size: 64 })).toThrow('Framebuffer incomplete');
    expect(f.textures.size).toBe(0);
    res.dispose();
  });

  it('a fragment compile failure deletes the compiled vertex shader', () => {
    const f = fakeContext({ failFragment: true });
    expect(() => new Program(f.ctx, 'invalid')).toThrow('Shader compile failed');
    expect(f.shaders.size).toBe(0);
  });
});

describe('untrusted input (R9, R10)', () => {
  it('rejects invalid version numbers without looping', () => {
    const raw = JSON.parse(
      JSON.stringify({ schemaVersion: -1e20, layers: [{ id: 'a', type: 'solidColor', typeVersion: -1e20, params: {} }] }),
    );
    const r = deserializeProject(JSON.stringify(raw));
    expect(r.project.layers).toHaveLength(1);
    const r2 = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 1.5 }));
    expect(r2.project.layers).toHaveLength(1);
  });

  it('limits entry count and inflated size of project archives', async () => {
    const zip = zipSync({ 'project.json': new TextEncoder().encode('{}'), 'assets/a.png': new Uint8Array(64 << 10) });
    const limits = { entries: 10, projectJson: 1 << 20, entry: 1 << 20, total: 1 << 20 };
    const ok = await unzipBundle(zip, limits, false);
    expect(ok['assets/a.png'].length).toBe(64 << 10);
    await expect(unzipBundle(zip, { ...limits, entry: 32 << 10 }, false)).rejects.toThrow(/too large/);
    await expect(unzipBundle(zip, { ...limits, total: 48 << 10 }, false)).rejects.toThrow(/too large/);
    await expect(unzipBundle(zip, { ...limits, entries: 1 }, false)).rejects.toThrow(/too many/);
  });
});
