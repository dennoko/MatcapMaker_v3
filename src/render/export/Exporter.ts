import { RenderTarget, type GLContext, type TargetFormat } from '../gl/gl';
import { MatcapPipeline } from '../pipeline/MatcapPipeline';
import type { ResourceCache } from '../pipeline/resources';
import { withCommon } from '../pipeline/shaderBuilder';
import type { Project } from '$core/model/types';
import { dilateRGBA8 } from '$core/io/padding';

export type ExportFormat = 'png8' | 'png16' | 'jpg' | 'exr';
/** fill for pixels left outside the padded disc (PNG/EXR; JPG uses `background`) */
export type OuterBackground = 'transparent' | 'black' | 'white';

const OUTER_RGB: Record<Exclude<OuterBackground, 'transparent'>, [number, number, number]> = {
  black: [0, 0, 0],
  white: [1, 1, 1],
};

export interface ExportSpec {
  size: number;
  padding: number;
  format: ExportFormat;
  /** JPG background (also used for the flat backdrop), sRGB 0..1 */
  background: [number, number, number];
  /** alpha threshold for what counts as "inside" when padding */
  alphaThreshold: number;
  /** extra 3x3 averaging pass over padded pixels (closer to v3's look) */
  smoothPadding: boolean;
  jpgQuality: number;
  /** PNG/EXR only; defaults to transparent */
  outerBackground?: OuterBackground;
  /** read back only this region (top-down pixel coords) — used by the padding preview */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface EncodedPixels {
  width: number;
  height: number;
  /** png8: RGBA8, png16: RGBA16BE, jpg: RGB8, exr: RGBA f16 LE — rows top-down */
  data: Uint8Array;
  channels: number;
  bitDepth: 8 | 16;
  timings: Record<string, number>;
}

const JFA_SEED = withCommon(`
uniform sampler2D u_src;
uniform float u_threshold;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  o_color = c.a > u_threshold ? vec4(gl_FragCoord.xy, 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}`);

const JFA_STEP = withCommon(`
uniform sampler2D u_seeds;
uniform int u_step;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_seeds, 0);
  vec2 best = vec2(-1.0);
  float bestD = 1e20;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = px + ivec2(x, y) * u_step;
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec2 s = texelFetch(u_seeds, q, 0).xy;
      if (s.x < 0.0) continue;
      vec2 d = s - gl_FragCoord.xy;
      float dd = dot(d, d);
      if (dd < bestD) { bestD = dd; best = s; }
    }
  }
  o_color = vec4(best, 0.0, 1.0);
}`);

// The disc's anti-aliased rim is a poor colour source: every layer's alpha is
// scaled by the coverage there, so blend modes only partly apply and its colour
// is off (darker or washed out). Copied outward it streaks in fans, so a rim
// seed takes its colour from the fully covered pixel radially inward instead,
// and pixels that are not seeds, the rim included, are laid over the fill by
// their alpha.
const JFA_RESOLVE = withCommon(`
uniform sampler2D u_src;
uniform sampler2D u_seeds;
uniform float u_padding;
uniform float u_threshold;
vec2 fillSource(vec2 s) {
  float radius = u_resolution.x * 0.5;
  vec2 d = s - vec2(radius);
  float r = length(d);
  // the rim is at most ~1.4px wide (makeCtx: aa <= 2*sqrt(2)/size in r)
  float inner = radius - 1.5;
  return r > radius - 1.0 && r > 0.0 ? vec2(radius) + d * (inner / r) : s;
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 own = texelFetch(u_src, px, 0);
  vec2 s = texelFetch(u_seeds, px, 0).xy;
  if (s.x < 0.0 || distance(s, gl_FragCoord.xy) > u_padding + 0.5) { o_color = own; return; }
  vec3 fill = texelFetch(u_src, ivec2(fillSource(s)), 0).rgb;
  // interior seeds keep their colour as before
  float keep = own.a > u_threshold && fillSource(s) == s ? 1.0 : clamp(own.a, 0.0, 1.0);
  o_color = vec4(mix(fill, own.rgb, keep), 1.0);
}`);

const PAD_SMOOTH = withCommon(`
uniform sampler2D u_padded;
uniform sampler2D u_src;
uniform float u_threshold;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(u_padded, px, 0);
  if (texelFetch(u_src, px, 0).a > u_threshold || c.a <= 0.0) { o_color = c; return; }
  ivec2 size = textureSize(u_padded, 0);
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 q = clamp(px + ivec2(x, y), ivec2(0), size - 1);
    vec4 v = texelFetch(u_padded, q, 0);
    if (v.a > 0.0) { sum += v.rgb; n += 1.0; }
  }
  o_color = vec4(sum / max(n, 1.0), c.a);
}`);

// Packs the final image into RGBA8 so it can be read back portably.
// mode 0: 8-bit straight, 2/3: 16-bit hi/lo bytes, 4/5: half-float hi/lo bytes.
// With u_matte the image is first flattened onto u_matteColor (JPG background
// or the PNG/EXR outer background).
const ENCODE = withCommon(`
uniform sampler2D u_src;
uniform int u_encMode;
uniform int u_hdr;
uniform int u_matte;
uniform vec3 u_matteColor;
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  if (u_encMode < 4) c = clamp(c, 0.0, 1.0);
  if (u_matte == 1) c = vec4(mix(u_matteColor, c.rgb, clamp(c.a, 0.0, 1.0)), 1.0);
  if (u_encMode >= 4) {
    uvec4 h = uvec4(packHalf2x16(vec2(c.r, 0.0)), packHalf2x16(vec2(c.g, 0.0)),
                    packHalf2x16(vec2(c.b, 0.0)), packHalf2x16(vec2(c.a, 0.0))) & 0xffffu;
    uvec4 b = u_encMode == 4 ? (h >> 8u) : (h & 0xffu);
    o_color = vec4(b) / 255.0;
    return;
  }
  if (u_encMode == 0) { o_color = c; return; }
  uvec4 v = uvec4(round(c * 65535.0));
  uvec4 b = u_encMode == 2 ? (v >> 8u) : (v & 0xffu);
  o_color = vec4(b) / 255.0;
}`);

/**
 * Upper bound for the GPU memory one export may request. Exports whose
 * estimate exceeds it fail up front instead of running the driver out of memory.
 */
export const EXPORT_MEMORY_LIMIT = 3 * 1024 * 1024 * 1024;

const BYTES_PER_PIXEL: Record<TargetFormat, number> = { rgba16f: 8, rgba8: 4, rg32f: 8, rgba32f: 16 };

/** Peak GPU memory (bytes) an export of `project` at `spec` requests. */
export function estimateExportBytes(project: Project, spec: Pick<ExportSpec, 'size' | 'padding'>, format: TargetFormat, floatTargets = true): number {
  const px = spec.size * spec.size;
  const img = px * BYTES_PER_PIXEL[format];
  const render = MatcapPipeline.onceTargets(project.layers) * img;
  // padding: image + two RG32F seed buffers + padded result, then the RGBA8 encode target
  const pad = spec.padding > 0 && floatTargets ? img * 2 + px * 16 : img;
  return Math.max(render, pad + px * 4);
}

export class Exporter {
  constructor(
    private ctx: GLContext,
    private res: ResourceCache,
  ) {}

  /** Renders the project at the target size, pads it and returns encoded pixels. */
  run(project: Project, spec: ExportSpec): EncodedPixels {
    const timings: Record<string, number> = {};
    const size = Math.min(spec.size, this.ctx.caps.maxTextureSize);
    let t = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      timings[name] = now - t;
      t = now;
    };

    const need = estimateExportBytes(project, { size, padding: spec.padding }, this.ctx.accumFormat, this.ctx.caps.floatTargets);
    if (need > EXPORT_MEMORY_LIMIT) {
      throw new Error(`Export needs about ${Math.ceil(need / 1048576)} MiB of GPU memory (limit ${EXPORT_MEMORY_LIMIT / 1048576} MiB)`);
    }

    const pipeline = new MatcapPipeline(this.ctx, this.res, size);
    const own: RenderTarget[] = [];
    try {
      let img = pipeline.renderOnce(project);
      if (img.width !== size) {
        // empty stack: the pipeline returns a 1x1 transparent target
        const full = new RenderTarget(this.ctx, size, size, img.format, 'nearest');
        own.push(full);
        full.clear();
        img = full;
      }
      lap('render');

      const gpuPadding = spec.padding > 0 && this.ctx.caps.floatTargets;
      if (gpuPadding) {
        img = this.padGPU(img, spec, own);
        lap('padding');
      }

      const outer = spec.outerBackground ?? 'transparent';
      const matte = spec.format === 'jpg' ? spec.background : outer === 'transparent' ? null : OUTER_RGB[outer];
      // the CPU padding fallback needs the alpha, so it flattens after dilating
      const cpuPadding = spec.padding > 0 && !gpuPadding && (spec.format === 'png8' || spec.format === 'jpg');
      const readMode = (m: number) => this.encodeAndRead(img, m, spec, project.settings.hdr, cpuPadding ? null : matte);
      let out: EncodedPixels;
      const outW = spec.crop ? spec.crop.w : size;
      const outH = spec.crop ? spec.crop.h : size;
      const px = outW * outH;
      if (spec.format === 'png8' || spec.format === 'jpg') {
        const rgba = readMode(0);
        lap('readback');
        if (cpuPadding) {
          dilateRGBA8(rgba, outW, outH, spec.padding);
          if (matte) flattenRGBA8(rgba, matte);
          lap('padding');
        }
        if (spec.format === 'jpg') {
          const rgb = new Uint8Array(px * 3);
          for (let i = 0, j = 0; i < px * 4; i += 4, j += 3) {
            rgb[j] = rgba[i];
            rgb[j + 1] = rgba[i + 1];
            rgb[j + 2] = rgba[i + 2];
          }
          out = { width: outW, height: outH, data: rgb, channels: 3, bitDepth: 8, timings };
        } else {
          out = { width: outW, height: outH, data: rgba, channels: 4, bitDepth: 8, timings };
        }
      } else {
        const isHalf = spec.format === 'exr';
        const hi = readMode(isHalf ? 4 : 2);
        const lo = readMode(isHalf ? 5 : 3);
        lap('readback');
        const data = new Uint8Array(px * 8);
        for (let i = 0; i < px * 4; i++) {
          if (isHalf) {
            data[i * 2] = lo[i]; // little-endian f16
            data[i * 2 + 1] = hi[i];
          } else {
            data[i * 2] = hi[i]; // PNG is big-endian
            data[i * 2 + 1] = lo[i];
          }
        }
        out = { width: outW, height: outH, data, channels: 4, bitDepth: 16, timings };
      }
      return out;
    } finally {
      own.forEach((r) => r.dispose());
      pipeline.dispose();
    }
  }

  private padGPU(src: RenderTarget, spec: ExportSpec, own: RenderTarget[]): RenderTarget {
    const { ctx, res } = this;
    const w = src.width;
    const h = src.height;
    // each target joins `own` as soon as it exists, so a failure while
    // allocating the next one still releases it
    let a = new RenderTarget(ctx, w, h, 'rg32f', 'nearest');
    own.push(a);
    let b = new RenderTarget(ctx, w, h, 'rg32f', 'nearest');
    own.push(b);

    const seed = res.custom('jfa-seed', () => JFA_SEED);
    ctx.bindTarget(a);
    seed.use();
    seed.tex('u_src', src.texture);
    seed.f('u_threshold', spec.alphaThreshold);
    ctx.drawFullscreen();

    const step = res.custom('jfa-step', () => JFA_STEP);
    let k = 1 << Math.ceil(Math.log2(Math.max(1, spec.padding)));
    // one extra k=1 pass (JFA+1) reduces the rare nearest-seed errors
    const steps: number[] = [];
    for (; k >= 1; k >>= 1) steps.push(k);
    steps.push(1);
    for (const s of steps) {
      ctx.bindTarget(b);
      step.use();
      step.tex('u_seeds', a.texture);
      step.i('u_step', s);
      ctx.drawFullscreen();
      [a, b] = [b, a];
    }

    const padded = new RenderTarget(ctx, w, h, src.format, 'nearest');
    own.push(padded);
    const resolve = res.custom('jfa-resolve', () => JFA_RESOLVE);
    ctx.bindTarget(padded);
    resolve.use();
    resolve.tex('u_src', src.texture);
    resolve.tex('u_seeds', a.texture);
    resolve.f('u_padding', spec.padding);
    resolve.f('u_threshold', spec.alphaThreshold);
    resolve.v2('u_resolution', w, h);
    ctx.drawFullscreen();

    // the seed buffers are done: free them before the next allocation
    for (const t of [a, b]) {
      own.splice(own.indexOf(t), 1);
      t.dispose();
    }

    if (!spec.smoothPadding) return padded;
    const smooth = new RenderTarget(ctx, w, h, src.format, 'nearest');
    own.push(smooth);
    const sp = res.custom('pad-smooth', () => PAD_SMOOTH);
    ctx.bindTarget(smooth);
    sp.use();
    sp.tex('u_padded', padded.texture);
    sp.tex('u_src', src.texture);
    sp.f('u_threshold', spec.alphaThreshold);
    ctx.drawFullscreen();
    return smooth;
  }

  /** Runs the encode pass into RGBA8 and reads it back top-down. */
  private encodeAndRead(src: RenderTarget, mode: number, spec: ExportSpec, hdr: boolean, matte: [number, number, number] | null): Uint8Array {
    const { ctx } = this;
    const gl = ctx.gl;
    const c = spec.crop;
    const w = c ? c.w : src.width;
    const h = c ? c.h : src.height;
    // GL rows are bottom-up
    const rx = c ? c.x : 0;
    const ry = c ? src.height - c.y - c.h : 0;
    const target = new RenderTarget(ctx, src.width, src.height, 'rgba8', 'nearest');
    try {
      const enc = this.res.custom('encode', () => ENCODE);
      ctx.bindTarget(target);
      enc.use();
      enc.tex('u_src', src.texture);
      enc.i('u_encMode', mode);
      enc.i('u_hdr', hdr ? 1 : 0);
      enc.i('u_matte', matte ? 1 : 0);
      enc.v3('u_matteColor', matte ?? [0, 0, 0]);
      ctx.drawFullscreen();
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.readPixels(rx, ry, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return flipRows(buf, w, h, 4);
    } finally {
      target.dispose();
    }
  }
}

/** Composites straight-alpha RGBA8 over an opaque sRGB 0..1 color, in place. */
export function flattenRGBA8(rgba: Uint8Array, bg: [number, number, number]): void {
  const b = bg.map((v) => v * 255);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(b[k] + (rgba[i + k] - b[k]) * a);
    rgba[i + 3] = 255;
  }
}

export function flipRows(buf: Uint8Array, w: number, h: number, bpp: number): Uint8Array {
  const row = w * bpp;
  const out = new Uint8Array(buf.length);
  for (let y = 0; y < h; y++) out.set(buf.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}
