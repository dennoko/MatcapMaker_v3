import { GLContext, RenderTarget, type Program } from './gl/gl';
import { MatcapPipeline, type RenderOptions } from './pipeline/MatcapPipeline';
import { ResourceCache } from './pipeline/resources';
import { withCommon } from './pipeline/shaderBuilder';
import { Exporter, type EncodedPixels, type ExportSpec } from './export/Exporter';
import previewGlsl from './shaders/preview.glsl?raw';
import { computeLayout } from './preview/layout';
import { generateNormalMap } from './preview/proceduralNormal';
import { MeshPreview } from './preview/MeshPreview';
import type { MeshData } from './preview/mesh';
import type { AssetStore } from '$core/io/assetStore';
import type { LayerNode, Project, ViewState } from '$core/model/types';

export const PREVIEW_RES = 1024;
export const INTERACTIVE_RES = 512;

export interface FrameRequest {
  project: Project;
  view: ViewState;
  /** use the low-resolution pipeline (dragging) */
  interactive: boolean;
  selectedId: string | null;
  solo: ReadonlySet<string> | null;
  blendOverride: RenderOptions['blendOverride'];
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  theme: { bg: [number, number, number]; bg2: [number, number, number] };
}

export interface FrameInfo {
  resolution: number;
  ms: number;
  passes: number;
  reused: number;
}

const THUMB_GLSL = withCommon(`
uniform sampler2D u_src;
uniform float u_ratio;
void main() {
  // box-filter downsample (u_ratio x u_ratio source texels per pixel)
  vec2 base = floor(gl_FragCoord.xy) * u_ratio;
  vec2 texel = 1.0 / vec2(textureSize(u_src, 0));
  vec4 sum = vec4(0.0);
  float n = 0.0;
  for (float y = 0.25; y < 1.0; y += 0.5) for (float x = 0.25; x < 1.0; x += 0.5) {
    vec4 c = texture(u_src, (base + vec2(x, y) * u_ratio) * texel);
    sum += vec4(c.rgb * c.a, c.a);
    n += 1.0;
  }
  sum /= n;
  o_color = vec4(sum.a > 0.0 ? clamp(sum.rgb / sum.a, 0.0, 1.0) : vec3(0.0), clamp(sum.a, 0.0, 1.0));
}`);

/** Facade over the GL context: preview, thumbnails, picking and export. */
export class Renderer {
  ctx!: GLContext;
  res!: ResourceCache;
  private hi!: MatcapPipeline;
  private lo!: MatcapPipeline;
  private before: MatcapPipeline | null = null;
  private preview!: Program;
  private defaultNormal!: WebGLTexture;
  private mesh!: MeshPreview;
  private lastFinal: RenderTarget | null = null;
  private lost = false;
  private disposed = false;
  onShaderError?: (type: string, msg: string) => void;
  onRestored?: () => void;

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private onRestore = () => {
    if (this.disposed) return;
    this.init();
    this.lost = false;
    this.onRestored?.();
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly assets: AssetStore,
  ) {
    this.init();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestore);
  }

  private init() {
    // after a context loss the old objects are already gone; only stop
    // the old cache from following the asset store
    this.res?.detach();
    this.lastFinal = null;
    this.ctx = new GLContext(this.canvas);
    this.res = new ResourceCache(this.ctx, this.assets);
    this.res.onError = (t, m) => this.onShaderError?.(t, m);
    this.hi = new MatcapPipeline(this.ctx, this.res, PREVIEW_RES);
    this.lo = new MatcapPipeline(this.ctx, this.res, INTERACTIVE_RES);
    this.before = null;
    this.preview = this.res.custom('preview', () => withCommon(previewGlsl));
    this.mesh = new MeshPreview(this.ctx);
    if (this.meshData !== undefined) this.mesh.load(this.meshData);
    const gl = this.ctx.gl;
    const size = 512;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, generateNormalMap(size));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.defaultNormal = tex;
  }

  get isLost() {
    return this.lost || this.disposed;
  }

  get caps() {
    return this.ctx.caps;
  }

  /** Renders the matcap (differentially) and presents it. */
  frame(req: FrameRequest): FrameInfo | null {
    if (this.isLost) return null;
    const pipe = req.interactive ? this.lo : this.hi;
    const opts: RenderOptions = { solo: req.solo, blendOverride: req.blendOverride };
    const final = pipe.render(req.project, opts);
    this.lastFinal = final;
    let beforeRt: RenderTarget | null = null;
    if (req.view.split === 'beforeAfter' && req.selectedId) {
      if (!this.before || this.before.size !== pipe.size) {
        this.before?.dispose();
        this.before = new MatcapPipeline(this.ctx, this.res, pipe.size);
      }
      beforeRt = this.before.render(req.project, { ...opts, excludeLayerId: req.selectedId });
    } else if (this.before) {
      this.before.dispose();
      this.before = null;
    }
    this.present(final, beforeRt, req, pipe.size);
    return { resolution: pipe.size, ms: pipe.stats.ms, passes: pipe.stats.passes, reused: pipe.stats.reused };
  }

  private present(final: RenderTarget, before: RenderTarget | null, req: FrameRequest, matcapSize: number) {
    const gl = this.ctx.gl;
    const w = Math.max(1, Math.round(req.cssWidth * req.dpr));
    const h = Math.max(1, Math.round(req.cssHeight * req.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const view = req.view;
    if (view.previewShape === 'mesh' && view.split === 'single') {
      this.mesh.draw(final.texture, view, w, h, req.theme.bg, req.project.settings.hdr);
      return;
    }
    const layout = computeLayout(req.cssWidth, req.cssHeight, view);
    const s = req.dpr;
    const p = this.preview;
    this.ctx.bindTarget(null, w, h);
    p.use();
    p.v2('u_canvas', w, h);
    p.v2('u_resolution', matcapSize, matcapSize);
    const d0 = layout.discs[0];
    const d1 = layout.discs[1] ?? d0;
    p.v2('u_center0', d0.cx * s, d0.cy * s);
    p.v2('u_center1', d1.cx * s, d1.cy * s);
    p.f('u_radius', d0.r * s);
    p.i('u_layout', layout.layout);
    p.i('u_shape', d0.shape);
    p.tex('u_matcap', final.texture);
    p.tex('u_matcapB', (before ?? final).texture);
    p.f('u_swipeX', layout.swipeX * s);
    const nm = this.res.assetTexture(view.normalMap.asset);
    p.tex('u_normalMap', nm?.tex ?? this.defaultNormal);
    p.f('u_nmStrength', view.normalMap.strength);
    p.f('u_nmScale', view.normalMap.scale);
    p.v2('u_nmOffset', view.normalMap.offset[0], view.normalMap.offset[1]);
    p.i('u_hdr', req.project.settings.hdr ? 1 : 0);
    p.i('u_toneMap', view.toneMap ? 1 : 0);
    p.f('u_exposure', view.exposure);
    p.v3('u_bg', req.theme.bg);
    p.v3('u_bg2', req.theme.bg2);
    this.ctx.drawFullscreen();
  }

  /** Reads the matcap color at uv (0..1, y up) from the last frame. */
  pick(u: number, v: number): [number, number, number, number] | null {
    const rt = this.lastFinal;
    if (!rt || this.isLost) return null;
    const gl = this.ctx.gl;
    const x = Math.min(rt.width - 1, Math.max(0, Math.floor(u * rt.width)));
    const y = Math.min(rt.height - 1, Math.max(0, Math.floor(v * rt.height)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    let out: [number, number, number, number];
    if (rt.format === 'rgba8') {
      const b = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      out = [b[0] / 255, b[1] / 255, b[2] / 255, b[3] / 255];
    } else {
      const f = new Float32Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, f);
      out = [f[0], f[1], f[2], f[3]];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  /**
   * Small RGBA8 thumbnail (top-down) of a generator layer's own output.
   * `alive` = ids of the document's layers, so results of deleted layers are released.
   */
  thumbnail(node: LayerNode, size = 64, alive?: ReadonlySet<string>): Uint8ClampedArray | null {
    if (this.isLost) return null;
    const src = this.lo.layerOutput(node, alive);
    if (!src) return null;
    const ratio = src.width / size;
    const rt = new RenderTarget(this.ctx, size, size, 'rgba8', 'nearest');
    try {
      const prog = this.res.custom('thumb', () => THUMB_GLSL);
      this.ctx.bindTarget(rt);
      prog.use();
      prog.tex('u_src', src.texture);
      prog.f('u_ratio', ratio);
      this.ctx.drawFullscreen();
      const gl = this.ctx.gl;
      const buf = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const out = new Uint8ClampedArray(buf.length);
      const row = size * 4;
      for (let y = 0; y < size; y++) out.set(buf.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
      return out;
    } finally {
      rt.dispose();
    }
  }

  export(project: Project, spec: ExportSpec): EncodedPixels {
    if (this.isLost) throw new Error('GPU context lost');
    return new Exporter(this.ctx, this.res).run(project, spec);
  }

  /** Mesh for the mesh preview (null = built-in torus knot). */
  setMesh(mesh: MeshData | null) {
    this.meshData = mesh;
    if (!this.disposed) this.mesh.load(mesh);
  }
  private meshData: MeshData | null | undefined;

  /** Estimated GPU memory: pipelines, uploaded images, noise and the mesh preview. */
  get memoryBytes() {
    return (
      this.hi.memoryBytes +
      this.lo.memoryBytes +
      (this.before?.memoryBytes ?? 0) +
      this.res.memoryBytes +
      this.mesh.memoryBytes +
      Math.round((512 * 512 * 4 * 4) / 3) // default normal map with mips
    );
  }

  dropAsset(id: string) {
    this.res.dropAsset(id);
  }

  /** Releases every GPU object and listener; the renderer is unusable afterwards. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestore);
    this.lastFinal = null;
    this.hi.dispose();
    this.lo.dispose();
    this.before?.dispose();
    this.before = null;
    this.mesh.dispose();
    this.ctx.gl.deleteTexture(this.defaultNormal);
    this.res.dispose();
    this.ctx.dispose();
  }
}
