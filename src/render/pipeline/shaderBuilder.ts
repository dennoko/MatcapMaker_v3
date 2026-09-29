import type { LayerDef } from '$core/layers/defineLayer';
import { glslDecl } from '$core/schema/params';
import commonGlsl from '../shaders/common.glsl?raw';
import blendGlsl from '../shaders/blend.glsl?raw';

const HEADER = '#version 300 es\n';

function paramDecls(def: LayerDef): string {
  const lines = Object.entries(def.params).map(([k, s]) => glslDecl(k, s));
  for (const name of Object.keys(def.resources ?? {})) lines.push(`uniform sampler2D ${name};`);
  return lines.join('\n');
}

/** Generator: evaluates the layer on the matcap disc. */
export function buildGeneratorSource(def: LayerDef): string {
  return `${HEADER}${commonGlsl}
// ---- params (generated from schema: ${def.type}) ----
${paramDecls(def)}
// ---- layer ----
${def.shader}
// ---- entry ----
void main() {
  MatcapCtx ctx = makeCtx(v_uv);
  if (ctx.inside <= 0.0) { o_color = vec4(0.0); return; }
  vec4 c = evalLayer(ctx);
  c.a *= ctx.inside;
  o_color = c;
}
`;
}

/** Filter / adjustment pass: reads the accumulated result below the layer. */
export function buildPassSource(def: LayerDef, passIndex: number): string {
  const pass = def.passes![passIndex];
  return `${HEADER}${commonGlsl}
uniform sampler2D u_input;
uniform sampler2D u_original;
uniform int u_pass;
uniform vec2 u_texel;
// ---- params (generated from schema: ${def.type}) ----
${paramDecls(def)}
// ---- pass ${passIndex} ----
${pass.shader}
void main() {
  o_color = runPass(v_uv);
}
`;
}

export function buildBlendSource(): string {
  return `${HEADER}${commonGlsl}\n${blendGlsl}`;
}

export function withCommon(body: string): string {
  return `${HEADER}${commonGlsl}\n${body}`;
}
