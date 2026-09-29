import type { BlendMode, LayerNode } from '../model/types';
import type { ParamSpec, ParamValue, UniformValue } from '../schema/params';

export type LayerKind = 'generator' | 'filter' | 'adjustment';
export type LayerCategory = 'base' | 'light' | 'shading' | 'texture' | 'color' | 'filter' | 'group';

/** A procedural texture resource the renderer creates and caches per key. */
export interface ResourceSpec {
  kind: 'noise';
  size: number;
  /** param providing the seed */
  seedParam: string;
}

export interface FilterPass {
  /**
   * GLSL fragment body implementing `vec4 runPass(vec2 uv)`.
   * Available: u_input (previous pass or accumulated result), u_original
   * (accumulated result below this layer), u_texel, u_pass, u_resolution,
   * plus param uniforms and the MatcapCtx helpers.
   */
  shader: string;
}

export interface LegacyMapping {
  /** Class name in v3 projects (e.g. "SpotLightLayer"). */
  type: string;
  /** Convert v3 params (snake_case) into new params. */
  params: (old: Record<string, unknown>) => Record<string, unknown>;
}

export interface LayerDef {
  type: string;
  version: number;
  kind: LayerKind;
  category: LayerCategory;
  /** Short symbol used as a fallback icon. */
  icon: string;
  defaults: { blendMode: BlendMode; opacity?: number };
  params: Record<string, ParamSpec>;
  /** generator: GLSL implementing `vec4 evalLayer(MatcapCtx ctx)` (straight alpha). */
  shader?: string;
  /** filter / adjustment: one or more full-screen passes. */
  passes?: FilterPass[];
  /** Extra uniforms derived from params and the node (e.g. blend-mode dependent). */
  uniforms?: (params: Record<string, ParamValue>, node: LayerNode) => Record<string, UniformValue>;
  resources?: Record<string, ResourceSpec>;
  migrations?: Record<number, (params: Record<string, unknown>) => Record<string, unknown>>;
  legacy?: LegacyMapping;
  /** English display name fallback. */
  title: string;
  /** Loaded from a user plugin folder. */
  plugin?: boolean;
}

export function defineLayer(def: LayerDef): LayerDef {
  if (def.kind === 'generator' && !def.shader) throw new Error(`${def.type}: generator needs shader`);
  if (def.kind !== 'generator' && !def.passes?.length) throw new Error(`${def.type}: filter needs passes`);
  return def;
}
