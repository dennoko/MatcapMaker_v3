// Parameter type system. A layer declares its params once; UI widgets,
// serialization (defaults / validation / clamping), GLSL uniform declarations
// and uniform upload are all derived from these specs.

export type RGB = [number, number, number];
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface GradientStop {
  pos: number;
  color: RGB;
}
export type GradientInterp = 'rgb' | 'oklab';
export interface GradientValue {
  stops: GradientStop[];
  interp: GradientInterp;
}

export interface CurvePoint {
  x: number;
  y: number;
}
export type CurveValue = CurvePoint[];

export type ParamValue =
  | number
  | boolean
  | string
  | null
  | RGB
  | Vec2
  | GradientValue
  | CurveValue;

export type GizmoKind =
  | 'sphereHandle'
  | 'rotateRing'
  | 'gradientAxis'
  | 'imageBox'
  | 'rimDrag';

/** Uniform value as uploaded to GL. */
export type UniformValue =
  | { t: 'f'; v: number }
  | { t: 'i'; v: number }
  | { t: 'v2'; v: number[] }
  | { t: 'v3'; v: number[] }
  | { t: 'fa'; v: Float32Array }
  | { t: 'v3a'; v: Float32Array };

interface BaseSpec<K extends string, V> {
  kind: K;
  default: V;
  /** Optional i18n key override (defaults to layer.<type>.param.<name>). */
  label?: string;
  /** When set, the param is only shown if predicate(params) is true. */
  visibleIf?: (params: Record<string, ParamValue>) => boolean;
  gizmo?: GizmoKind;
  /** Hidden params are serialized but not shown in the inspector. */
  hidden?: boolean;
}

export interface FloatSpec extends BaseSpec<'float', number> {
  min: number;
  max: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  unit?: string;
}
export interface IntSpec extends BaseSpec<'int', number> {
  min: number;
  max: number;
  softMax?: number;
}
export interface BoolSpec extends BaseSpec<'bool', boolean> {}
export interface ColorSpec extends BaseSpec<'color', RGB> {}
export interface DirectionSpec extends BaseSpec<'direction', Vec3> {}
export interface Vec2Spec extends BaseSpec<'vec2', Vec2> {
  min: number;
  max: number;
  softMin?: number;
  softMax?: number;
  linked?: boolean;
}
export interface AngleSpec extends BaseSpec<'angle', number> {}
export interface EnumSpec extends BaseSpec<'enum', string> {
  options: readonly string[];
}
export interface GradientSpec extends BaseSpec<'gradient', GradientValue> {
  maxStops: number;
}
export interface CurveSpec extends BaseSpec<'curve', CurveValue> {}
export interface AssetSpec extends BaseSpec<'asset', string | null> {
  accept: 'image';
}

export type ParamSpec =
  | FloatSpec
  | IntSpec
  | BoolSpec
  | ColorSpec
  | DirectionSpec
  | Vec2Spec
  | AngleSpec
  | EnumSpec
  | GradientSpec
  | CurveSpec
  | AssetSpec;

export const MAX_GRADIENT_STOPS = 8;
export const MAX_CURVE_POINTS = 8;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type Opt<S> = Omit<S, 'kind'>;

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: RGB): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}

export const p = {
  float: (o: Opt<FloatSpec>): FloatSpec => ({ kind: 'float', ...o }),
  int: (o: Opt<IntSpec>): IntSpec => ({ kind: 'int', ...o }),
  bool: (o: Opt<BoolSpec>): BoolSpec => ({ kind: 'bool', ...o }),
  color: (o: Omit<Opt<ColorSpec>, 'default'> & { default: string | RGB }): ColorSpec => ({
    ...o,
    kind: 'color',
    default: typeof o.default === 'string' ? hexToRgb(o.default) : o.default,
  }),
  direction: (o: Opt<DirectionSpec>): DirectionSpec => ({ kind: 'direction', ...o }),
  vec2: (o: Opt<Vec2Spec>): Vec2Spec => ({ kind: 'vec2', ...o }),
  angle: (o: Opt<AngleSpec>): AngleSpec => ({ kind: 'angle', ...o }),
  enum: (o: Opt<EnumSpec>): EnumSpec => ({ kind: 'enum', ...o }),
  gradient: (o: Omit<Opt<GradientSpec>, 'maxStops'> & { maxStops?: number }): GradientSpec => ({
    kind: 'gradient',
    maxStops: MAX_GRADIENT_STOPS,
    ...o,
  }),
  curve: (o: Opt<CurveSpec>): CurveSpec => ({ kind: 'curve', ...o }),
  asset: (o: Omit<Opt<AssetSpec>, 'default' | 'accept'>): AssetSpec => ({
    kind: 'asset',
    accept: 'image',
    default: null,
    ...o,
  }),
};

// ---------------------------------------------------------------------------
// Validation / clamping (tolerant load)
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cloneDefault<V>(v: V): V {
  return structuredClone(v);
}

export function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-8) return [0, 0, 1];
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Coerce an arbitrary (possibly foreign) value into a valid value for the spec.
 * Returns the default when the value is unusable.
 */
export function coerceParam(spec: ParamSpec, raw: unknown): ParamValue {
  switch (spec.kind) {
    case 'float':
      return isNum(raw) ? clamp(raw, spec.min, spec.max) : spec.default;
    case 'int':
      return isNum(raw) ? clamp(Math.round(raw), spec.min, spec.max) : spec.default;
    case 'angle':
      return isNum(raw) ? ((raw % 360) + 360) % 360 : spec.default;
    case 'bool':
      return typeof raw === 'boolean' ? raw : spec.default;
    case 'color': {
      if (typeof raw === 'string' && /^#?[0-9a-f]{3,6}$/i.test(raw)) return hexToRgb(raw);
      if (Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every(isNum))
        return [clamp(raw[0], 0, 1), clamp(raw[1], 0, 1), clamp(raw[2], 0, 1)];
      return cloneDefault(spec.default);
    }
    case 'direction': {
      if (Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every(isNum))
        return normalize3([raw[0], raw[1], raw[2]]);
      return cloneDefault(spec.default);
    }
    case 'vec2': {
      if (Array.isArray(raw) && raw.length >= 2 && raw.slice(0, 2).every(isNum))
        return [clamp(raw[0], spec.min, spec.max), clamp(raw[1], spec.min, spec.max)];
      return cloneDefault(spec.default);
    }
    case 'enum':
      return typeof raw === 'string' && spec.options.includes(raw) ? raw : spec.default;
    case 'asset':
      return typeof raw === 'string' && raw.length > 0 ? raw : null;
    case 'gradient': {
      const g = raw as Partial<GradientValue> | undefined;
      if (!g || !Array.isArray(g.stops)) return cloneDefault(spec.default);
      const stops: GradientStop[] = [];
      for (const s of g.stops) {
        if (!s || !isNum((s as GradientStop).pos)) continue;
        const color = coerceParam(p.color({ default: '#000000' }), (s as GradientStop).color) as RGB;
        stops.push({ pos: clamp((s as GradientStop).pos, 0, 1), color });
      }
      if (stops.length < 2) return cloneDefault(spec.default);
      stops.sort((a, b) => a.pos - b.pos);
      return {
        stops: stops.slice(0, spec.maxStops),
        interp: g.interp === 'oklab' ? 'oklab' : 'rgb',
      };
    }
    case 'curve': {
      if (!Array.isArray(raw)) return cloneDefault(spec.default);
      const pts = raw
        .filter((q) => q && isNum(q.x) && isNum(q.y))
        .map((q) => ({ x: clamp(q.x, 0, 1), y: clamp(q.y, 0, 1) }))
        .sort((a, b) => a.x - b.x)
        .slice(0, MAX_CURVE_POINTS);
      return pts.length >= 2 ? pts : cloneDefault(spec.default);
    }
  }
}

export function paramEquals(a: ParamValue, b: ParamValue): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function defaultParams(specs: Record<string, ParamSpec>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [k, s] of Object.entries(specs)) out[k] = cloneDefault(s.default);
  return out;
}

// ---------------------------------------------------------------------------
// GLSL derivation
// ---------------------------------------------------------------------------

export function uniformName(param: string): string {
  return `u_${param}`;
}

/** GLSL uniform declarations for a param. */
export function glslDecl(name: string, spec: ParamSpec): string {
  const u = uniformName(name);
  switch (spec.kind) {
    case 'float':
    case 'angle':
      return `uniform float ${u};`;
    case 'int':
    case 'enum':
    case 'bool':
      return `uniform int ${u};`;
    case 'color':
    case 'direction':
      return `uniform vec3 ${u};`;
    case 'vec2':
      return `uniform vec2 ${u};`;
    case 'gradient':
      return [
        `uniform int ${u}_count;`,
        `uniform int ${u}_interp;`,
        `uniform float ${u}_pos[${MAX_GRADIENT_STOPS}];`,
        `uniform vec3 ${u}_col[${MAX_GRADIENT_STOPS}];`,
      ].join('\n');
    case 'curve':
      return [
        `uniform int ${u}_count;`,
        `uniform vec2 ${u}_pts[${MAX_CURVE_POINTS}];`,
      ].join('\n');
    case 'asset':
      return [
        `uniform sampler2D ${u};`,
        `uniform vec2 ${u}_size;`,
        `uniform int ${u}_valid;`,
      ].join('\n');
  }
}

/** Uniform values for a param (asset textures are bound separately). */
export function toUniforms(name: string, spec: ParamSpec, value: ParamValue): Record<string, UniformValue> {
  const u = uniformName(name);
  switch (spec.kind) {
    case 'float':
    case 'angle':
      return { [u]: { t: 'f', v: value as number } };
    case 'int':
      return { [u]: { t: 'i', v: value as number } };
    case 'bool':
      return { [u]: { t: 'i', v: value ? 1 : 0 } };
    case 'enum':
      return { [u]: { t: 'i', v: Math.max(0, spec.options.indexOf(value as string)) } };
    case 'color':
    case 'direction':
      return { [u]: { t: 'v3', v: value as number[] } };
    case 'vec2':
      return { [u]: { t: 'v2', v: value as number[] } };
    case 'gradient': {
      const g = value as GradientValue;
      const stops = [...g.stops].sort((a, b) => a.pos - b.pos).slice(0, MAX_GRADIENT_STOPS);
      const pos = new Float32Array(MAX_GRADIENT_STOPS);
      const col = new Float32Array(MAX_GRADIENT_STOPS * 3);
      stops.forEach((s, i) => {
        pos[i] = s.pos;
        col.set(s.color, i * 3);
      });
      return {
        [`${u}_count`]: { t: 'i', v: stops.length },
        [`${u}_interp`]: { t: 'i', v: g.interp === 'oklab' ? 1 : 0 },
        [`${u}_pos`]: { t: 'fa', v: pos },
        [`${u}_col`]: { t: 'v3a', v: col },
      };
    }
    case 'curve': {
      const pts = value as CurveValue;
      const arr = new Float32Array(MAX_CURVE_POINTS * 2);
      pts.slice(0, MAX_CURVE_POINTS).forEach((q, i) => arr.set([q.x, q.y], i * 2));
      return {
        [`${u}_count`]: { t: 'i', v: Math.min(pts.length, MAX_CURVE_POINTS) },
        [`${u}_pts`]: { t: 'fa', v: arr },
      };
    }
    case 'asset':
      return {};
  }
}
