// Test-only page: renders projects through the real pipeline and exposes
// the result to Playwright. Not part of the app bundle.
import { Renderer } from '../../src/render/Renderer';
import { AssetStore } from '../../src/core/io/assetStore';
import { deserializeProject } from '../../src/core/io/serialize';
import { encodePng } from '../../src/platform/pngEncode';
import { defaultViewState } from '../../src/core/model/project';
import type { ExportFormat, OuterBackground } from '../../src/render/export/Exporter';
import { loadPlugin } from '../../src/core/layers/pluginLoader';
import { BUILTIN_LAYERS, registry } from '../../src/core/layers/registry';
import { MatcapPipeline } from '../../src/render/pipeline/MatcapPipeline';

let cached: MatcapPipeline | null = null;
function readRt(rt: { fbo: WebGLFramebuffer; width: number; height: number }) {
  const gl = renderer.ctx.gl;
  const out = new Float32Array(rt.width * rt.height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  gl.readPixels(0, 0, rt.width, rt.height, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const assets = new AssetStore();
const errors: string[] = [];
const renderer = new Renderer(canvas, assets);
renderer.onShaderError = (t, m) => errors.push(`${t}: ${m}`);

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as any).mm = {
  /** Renders through one long-lived pipeline (exercises the differential cache). */
  cachedRender(json: string) {
    cached ??= new MatcapPipeline(renderer.ctx, renderer.res, 64);
    const rt = cached.render(deserializeProject(json).project);
    return { px: Array.from(readRt(rt)), stats: cached.stats };
  },
  freshRender(json: string) {
    const p = new MatcapPipeline(renderer.ctx, renderer.res, 64);
    const px = Array.from(readRt(p.render(deserializeProject(json).project)));
    p.dispose();
    return px;
  },
  /** One-shot (export) path: no cache, targets released step by step. */
  onceRender(json: string) {
    const p = new MatcapPipeline(renderer.ctx, renderer.res, 64);
    const px = Array.from(readRt(p.renderOnce(deserializeProject(json).project)));
    p.dispose();
    return px;
  },
  registerPlugin(json: string, glsl: string[]) {
    const { def } = loadPlugin(json, glsl, new Set(BUILTIN_LAYERS.map((d) => d.type)));
    registry.register(def);
  },
  caps: () => renderer.caps,
  async addAsset(name: string, base64: string) {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const e = await assets.add(bin, name);
    return { id: e.id, meta: e.meta };
  },
  render(json: string, size: number, padding = 0, format: ExportFormat = 'png8', outerBackground: OuterBackground = 'transparent') {
    errors.length = 0;
    const { project, warnings } = deserializeProject(json);
    // exercise the preview path as well (shader compile of preview program)
    renderer.frame({
      project, view: defaultViewState(), interactive: false, selectedId: null, solo: null, blendOverride: null,
      cssWidth: 256, cssHeight: 256, dpr: 1, theme: { bg: [0.1, 0.1, 0.1], bg2: [0.2, 0.2, 0.2] },
    });
    const t0 = performance.now();
    const out = renderer.export(project, {
      size, padding, format, background: [0, 0, 0], alphaThreshold: 0, smoothPadding: false, jpgQuality: 90, outerBackground,
    });
    const ms = performance.now() - t0;
    const png = format === 'png8' ? b64(encodePng(out.data, out.width, out.height, 8)) : '';
    // raw RGBA for numeric checks (only for small sizes)
    const rgba = size <= 256 && format === 'png8' ? Array.from(out.data) : [];
    return { png, rgba, errors: [...errors], warnings, ms, timings: out.timings, glError: renderer.ctx.gl.getError() };
  },
};
(window as any).mmReady = true;
