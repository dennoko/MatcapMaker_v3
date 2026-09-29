import { GLContext, Program, ShaderError } from '../gl/gl';
import type { LayerDef } from '$core/layers/defineLayer';
import type { AssetEntry, AssetStore } from '$core/io/assetStore';
import { buildBlendSource, buildGeneratorSource, buildPassSource } from './shaderBuilder';

export interface AssetTexture {
  tex: WebGLTexture;
  width: number;
  height: number;
  version: number;
}

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * GPU resources shared by every pipeline on one GL context: compiled
 * programs, procedural textures and uploaded assets. Heavy resources are
 * created lazily and only when their inputs change.
 */
export class ResourceCache {
  private programs = new Map<string, { def: LayerDef | null; prog: Program }>();
  private noise = new Map<string, WebGLTexture>();
  private assets = new Map<string, AssetTexture>();
  /** Shader compile errors by layer type (surfaced as badges in the UI). */
  readonly errors = new Map<string, string>();
  private failed = new Map<string, LayerDef>();
  onError?: (type: string, message: string) => void;
  private offRemove: () => void;

  constructor(
    readonly ctx: GLContext,
    readonly assetStore: AssetStore,
  ) {
    // CPU and GPU copies share one lifetime: dropping the asset frees its texture
    this.offRemove = assetStore.onRemove((id) => this.dropAsset(id));
  }

  private getProgram(key: string, def: LayerDef | null, build: () => string): Program | null {
    const hit = this.programs.get(key);
    if (hit && hit.def === def) return hit.prog;
    if (hit) {
      hit.prog.dispose();
      this.programs.delete(key);
    }
    if (def && this.failed.get(key) === def) return null;
    try {
      const prog = new Program(this.ctx, build());
      this.programs.set(key, { def, prog });
      if (def) {
        this.errors.delete(def.type);
        this.failed.delete(key);
      }
      return prog;
    } catch (e) {
      const msg = e instanceof ShaderError ? e.log : String(e);
      console.error(`[shader] ${key}`, msg);
      if (!def) throw e;
      this.failed.set(key, def);
      this.errors.set(def.type, msg);
      this.onError?.(def.type, msg);
      return null;
    }
  }

  generator(def: LayerDef): Program | null {
    return this.getProgram(`gen:${def.type}`, def, () => buildGeneratorSource(def));
  }

  pass(def: LayerDef, i: number): Program | null {
    return this.getProgram(`pass:${def.type}:${i}`, def, () => buildPassSource(def, i));
  }

  blend(): Program {
    return this.getProgram('blend', null, buildBlendSource)!;
  }

  custom(key: string, build: () => string): Program {
    return this.getProgram(`custom:${key}`, null, build)!;
  }

  noiseTexture(seed: number, size: number): WebGLTexture {
    const key = `${seed}:${size}`;
    let tex = this.noise.get(key);
    if (tex) return tex;
    const gl = this.ctx.gl;
    const rnd = mulberry32(seed * 7919 + 1);
    const data = new Uint8Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
    tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.noise.set(key, tex);
    if (this.noise.size > 32) {
      const [k, t] = this.noise.entries().next().value!;
      gl.deleteTexture(t);
      this.noise.delete(k);
    }
    return tex;
  }

  /** Uploads (or reuses) the GPU texture for an image asset. */
  assetTexture(id: string | null | undefined): AssetTexture | null {
    if (!id) return null;
    const entry = this.assetStore.get(id);
    if (!entry?.bitmap) {
      this.dropAsset(id);
      return null;
    }
    const hit = this.assets.get(id);
    if (hit && hit.version === entry.version) return hit;
    if (hit) this.ctx.gl.deleteTexture(hit.tex);
    const t = this.upload(entry);
    this.assets.set(id, t);
    return t;
  }

  private upload(entry: AssetEntry): AssetTexture {
    const gl = this.ctx.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.fitTextureSize(entry.bitmap!));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, width: entry.meta.width, height: entry.meta.height, version: entry.version };
  }

  /** Scales images larger than MAX_TEXTURE_SIZE down (keeping the aspect) so the upload succeeds. */
  private fitTextureSize(bmp: ImageBitmap): TexImageSource {
    const max = this.ctx.caps.maxTextureSize;
    if (bmp.width <= max && bmp.height <= max) return bmp;
    const k = max / Math.max(bmp.width, bmp.height);
    const c = new OffscreenCanvas(Math.max(1, Math.floor(bmp.width * k)), Math.max(1, Math.floor(bmp.height * k)));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  /** Estimated GPU memory of uploaded images and noise textures (with mips). */
  get memoryBytes(): number {
    let b = 0;
    for (const t of this.assets.values()) {
      const max = this.ctx.caps.maxTextureSize;
      const k = Math.min(1, max / Math.max(t.width, t.height, 1));
      b += Math.floor(t.width * k) * Math.floor(t.height * k) * 4;
    }
    for (const key of this.noise.keys()) {
      const size = Number(key.split(':')[1]);
      b += size * size;
    }
    return Math.round((b * 4) / 3);
  }

  /** Assets version fingerprint (part of cache keys). */
  assetVersion(id: string | null | undefined): number {
    return id ? (this.assetStore.get(id)?.version ?? 0) : 0;
  }

  dropAsset(id: string) {
    const hit = this.assets.get(id);
    if (hit) {
      this.ctx.gl.deleteTexture(hit.tex);
      this.assets.delete(id);
    }
  }

  /** Stops following the asset store (the context is gone; nothing to delete). */
  detach() {
    this.offRemove();
  }

  dispose() {
    this.offRemove();
    const gl = this.ctx.gl;
    this.programs.forEach((p) => p.prog.dispose());
    this.programs.clear();
    this.noise.forEach((t) => gl.deleteTexture(t));
    this.noise.clear();
    this.assets.forEach((t) => gl.deleteTexture(t.tex));
    this.assets.clear();
  }
}
