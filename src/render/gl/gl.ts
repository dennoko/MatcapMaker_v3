// Thin WebGL2 wrapper: context capabilities, programs with introspected
// uniforms, render targets and a render-target pool.

import type { UniformValue } from '$core/schema/params';

export type TargetFormat = 'rgba16f' | 'rgba8' | 'rg32f' | 'rgba32f';

export interface GLCaps {
  floatTargets: boolean; // EXT_color_buffer_float
  floatLinear: boolean; // OES_texture_float_linear (32F filtering)
  maxTextureSize: number;
  renderer: string;
}

export class GLContext {
  readonly gl: WebGL2RenderingContext;
  readonly caps: GLCaps;
  private emptyVao: WebGLVertexArrayObject;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');
    let renderer = 'unknown';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    this.caps = {
      floatTargets,
      floatLinear,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      renderer,
    };
    this.emptyVao = gl.createVertexArray()!;
  }

  /** Preferred accumulation format (RGBA16F, falls back to RGBA8). */
  get accumFormat(): TargetFormat {
    return this.caps.floatTargets ? 'rgba16f' : 'rgba8';
  }

  /** Draws a full-screen triangle (vertex shader derives positions from gl_VertexID). */
  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindTarget(t: RenderTarget | null, w?: number, h?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.width : w!, t ? t.height : h!);
  }
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export class ShaderError extends Error {
  constructor(
    message: string,
    readonly log: string,
    readonly source: string,
  ) {
    super(message);
  }
}

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
  size: number;
}

export class Program {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, UniformInfo>();

  constructor(
    private ctx: GLContext,
    fsSource: string,
    vsSource = FULLSCREEN_VS,
  ) {
    const gl = ctx.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? '';
      gl.deleteProgram(prog);
      throw new ShaderError('Program link failed', log, fsSource);
    }
    this.program = prog;
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(prog, info.name);
      if (loc) this.uniforms.set(name, { loc, type: info.type, size: info.size });
    }
  }

  use() {
    this.ctx.gl.useProgram(this.program);
    this.nextUnit = 0;
  }

  has(name: string) {
    return this.uniforms.has(name);
  }

  set(name: string, value: UniformValue) {
    const u = this.uniforms.get(name);
    if (!u) return;
    const gl = this.ctx.gl;
    switch (value.t) {
      case 'f':
        gl.uniform1f(u.loc, value.v);
        break;
      case 'i':
        gl.uniform1i(u.loc, value.v);
        break;
      case 'v2':
        gl.uniform2f(u.loc, value.v[0], value.v[1]);
        break;
      case 'v3':
        gl.uniform3f(u.loc, value.v[0], value.v[1], value.v[2]);
        break;
      case 'fa':
      case 'v3a':
        if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(u.loc, value.v);
        else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, value.v);
        else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, value.v);
        else gl.uniform1fv(u.loc, value.v);
        break;
    }
  }

  f(name: string, v: number) {
    this.set(name, { t: 'f', v });
  }
  i(name: string, v: number) {
    this.set(name, { t: 'i', v });
  }
  v2(name: string, x: number, y: number) {
    this.set(name, { t: 'v2', v: [x, y] });
  }
  v3(name: string, v: number[]) {
    this.set(name, { t: 'v3', v });
  }

  private nextUnit = 0;
  /** Binds a texture to the next free unit and points the sampler at it. */
  tex(name: string, tex: WebGLTexture | null) {
    const u = this.uniforms.get(name);
    if (!u) return;
    const gl = this.ctx.gl;
    const unit = this.nextUnit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.loc, unit);
  }

  dispose() {
    this.ctx.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new ShaderError('Shader compile failed', log, src);
  }
  return sh;
}

// ---------------------------------------------------------------------------
// Render targets
// ---------------------------------------------------------------------------

export class RenderTarget {
  readonly texture: WebGLTexture;
  readonly fbo: WebGLFramebuffer;

  constructor(
    private ctx: GLContext,
    readonly width: number,
    readonly height: number,
    readonly format: TargetFormat,
    filter: 'linear' | 'nearest' = 'linear',
  ) {
    const gl = ctx.gl;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const [internal, fmt, type] = formatInfo(gl, format);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
    void fmt;
    void type;
    const canLinear = format !== 'rg32f' && format !== 'rgba32f' ? true : ctx.caps.floatLinear;
    const f = filter === 'linear' && canLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.texture);
      throw new Error(`Framebuffer incomplete (${format} ${width}x${height}): 0x${status.toString(16)}`);
    }
  }

  get bytes(): number {
    const bpp = { rgba16f: 8, rgba8: 4, rg32f: 8, rgba32f: 16 }[this.format];
    return this.width * this.height * bpp;
  }

  clear(r = 0, g = 0, b = 0, a = 0) {
    const gl = this.ctx.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose() {
    const gl = this.ctx.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
  }
}

function formatInfo(gl: WebGL2RenderingContext, f: TargetFormat): [number, number, number] {
  switch (f) {
    case 'rgba16f':
      return [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
    case 'rgba8':
      return [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    case 'rg32f':
      return [gl.RG32F, gl.RG, gl.FLOAT];
    case 'rgba32f':
      return [gl.RGBA32F, gl.RGBA, gl.FLOAT];
  }
}

/** Reuses render targets of the same size/format to avoid GPU allocation churn. */
export class TargetPool {
  private free: RenderTarget[] = [];

  constructor(
    private ctx: GLContext,
    private maxFree = 8,
  ) {}

  acquire(w: number, h: number, format: TargetFormat): RenderTarget {
    const i = this.free.findIndex((t) => t.width === w && t.height === h && t.format === format);
    if (i >= 0) return this.free.splice(i, 1)[0];
    return new RenderTarget(this.ctx, w, h, format);
  }

  release(t: RenderTarget) {
    this.free.push(t);
    while (this.free.length > this.maxFree) this.free.shift()!.dispose();
  }

  dispose() {
    this.free.forEach((t) => t.dispose());
    this.free = [];
  }
}

/** 53-bit string hash (cyrb53). */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
