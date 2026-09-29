// Test-only page: renders projects through the real pipeline and exposes
// the result to Playwright. Not part of the app bundle.
import { Renderer } from '../../src/render/Renderer';
import { AssetStore } from '../../src/core/io/assetStore';
import { deserializeProject } from '../../src/core/io/serialize';
import { encodePng } from '../../src/platform/pngEncode';
import { defaultViewState } from '../../src/core/model/project';
import type { ExportFormat } from '../../src/render/export/Exporter';

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
  caps: () => renderer.caps,
  async addAsset(name: string, base64: string) {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const e = await assets.add(bin, name);
    return { id: e.id, meta: e.meta };
  },
  render(json: string, size: number, padding = 0, format: ExportFormat = 'png8') {
    errors.length = 0;
    const { project, warnings } = deserializeProject(json);
    // exercise the preview path as well (shader compile of preview program)
    renderer.frame({
      project, view: defaultViewState(), interactive: false, selectedId: null, solo: null, blendOverride: null,
      cssWidth: 256, cssHeight: 256, dpr: 1, theme: { bg: [0.1, 0.1, 0.1], bg2: [0.2, 0.2, 0.2] },
    });
    const t0 = performance.now();
    const out = renderer.export(project, {
      size, padding, format, background: [0, 0, 0], alphaThreshold: 0, smoothPadding: false, jpgQuality: 90,
    });
    const ms = performance.now() - t0;
    const png = format === 'png8' ? b64(encodePng(out.data, out.width, out.height, 8)) : '';
    // raw RGBA for numeric checks (only for small sizes)
    const rgba = size <= 256 && format === 'png8' ? Array.from(out.data) : [];
    return { png, rgba, errors: [...errors], warnings, ms, timings: out.timings, glError: renderer.ctx.gl.getError() };
  },
};
(window as any).mmReady = true;
