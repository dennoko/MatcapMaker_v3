import { Program, type GLContext } from '../gl/gl';
import type { ViewState } from '$core/model/types';
import { parseObj, torusKnot, type MeshData } from './mesh';

const VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
uniform mat3 u_rot;
uniform float u_scale;
uniform float u_aspect;
out vec3 v_n;
void main() {
  vec3 p = u_rot * a_pos;
  v_n = u_rot * a_normal;
  float persp = 1.0 / (1.0 - p.z * 0.25);
  gl_Position = vec4(p.x * u_scale * persp / u_aspect, p.y * u_scale * persp, -p.z * 0.5, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 v_n;
uniform sampler2D u_matcap;
uniform int u_hdr;
out vec4 o_color;
void main() {
  vec3 n = normalize(v_n);
  vec4 c = texture(u_matcap, n.xy * 0.49 + 0.5);
  vec3 rgb = u_hdr == 1 ? c.rgb / (1.0 + c.rgb) * 1.6 : clamp(c.rgb, 0.0, 1.0);
  o_color = vec4(rgb * c.a, 1.0);
}`;

/** Arbitrary mesh preview (OBJ). View-space normals index the matcap. */
export class MeshPreview {
  private prog: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private fbo: WebGLFramebuffer | null = null;
  private color: WebGLRenderbuffer | null = null;
  private depth: WebGLRenderbuffer | null = null;
  private fbSize = [0, 0];

  constructor(private ctx: GLContext) {}

  load(objText: string | null) {
    const mesh: MeshData | null = objText ? parseObj(objText) : null;
    this.upload(mesh ?? torusKnot());
  }

  private upload(m: MeshData) {
    const gl = this.ctx.gl;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nrm = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.buffers = [pos, nrm, idx];
    this.count = m.indices.length;
  }

  private ensureFbo(w: number, h: number) {
    const gl = this.ctx.gl;
    if (this.fbo && this.fbSize[0] === w && this.fbSize[1] === h) return;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.color) gl.deleteRenderbuffer(this.color);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    this.color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbSize = [w, h];
  }

  draw(matcap: WebGLTexture, view: ViewState, w: number, h: number, bg: [number, number, number], hdr: boolean) {
    const gl = this.ctx.gl;
    if (!this.vao) this.load(null);
    if (!this.prog) this.prog = new Program(this.ctx, FS, VS);
    this.ensureFbo(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    const prog = this.prog;
    prog.use();
    const [yaw, pitch] = view.orbit;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // R = Rx(pitch) * Ry(yaw), column-major
    const rot = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
    gl.uniformMatrix3fv(gl.getUniformLocation(prog.program, 'u_rot'), false, rot);
    prog.f('u_scale', 0.85 * view.zoom);
    prog.f('u_aspect', w / h);
    prog.i('u_hdr', hdr ? 1 : 0);
    prog.tex('u_matcap', matcap);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
