// Declarative layer plugins: a folder with layer.json (+ layer.glsl, or
// pass0.glsl, pass1.glsl… for filters). Only data and GLSL are loaded —
// no JavaScript is executed — so plugins are safe to drop in.

import { defineLayer, type LayerCategory, type LayerDef, type LayerKind } from './defineLayer';
import { BLEND_MODES, type BlendMode } from '../model/types';
import { hexToRgb, p, type ParamSpec } from '../schema/params';

export interface PluginManifest {
  type: string;
  title?: string;
  version?: number;
  kind?: LayerKind;
  category?: LayerCategory;
  icon?: string;
  blendMode?: BlendMode;
  params?: Record<string, Record<string, unknown>>;
  i18n?: Record<string, { title?: string; params?: Record<string, string>; options?: Record<string, string> }>;
}

export interface PluginResult {
  def: LayerDef;
  strings: Record<string, Record<string, string>>;
}

const KINDS: LayerKind[] = ['generator', 'filter', 'adjustment'];
const CATEGORIES: LayerCategory[] = ['base', 'light', 'shading', 'texture', 'color', 'filter'];

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function paramFromJson(name: string, raw: Record<string, unknown>): ParamSpec {
  const kind = String(raw.kind ?? 'float');
  switch (kind) {
    case 'float':
      return p.float({
        default: num(raw.default, 0),
        min: num(raw.min, 0),
        max: num(raw.max, 1),
        softMin: typeof raw.softMin === 'number' ? raw.softMin : undefined,
        softMax: typeof raw.softMax === 'number' ? raw.softMax : undefined,
        step: typeof raw.step === 'number' ? raw.step : undefined,
      });
    case 'int':
      return p.int({ default: Math.round(num(raw.default, 0)), min: num(raw.min, 0), max: num(raw.max, 100) });
    case 'bool':
      return p.bool({ default: raw.default === true });
    case 'angle':
      return p.angle({ default: num(raw.default, 0) });
    case 'color':
      return p.color({
        default: typeof raw.default === 'string' ? hexToRgb(raw.default) : Array.isArray(raw.default) ? (raw.default as [number, number, number]) : [1, 1, 1],
      });
    case 'direction':
      return p.direction({ default: (Array.isArray(raw.default) ? raw.default : [0, 0, 1]) as [number, number, number] });
    case 'vec2':
      return p.vec2({ default: (Array.isArray(raw.default) ? raw.default : [0, 0]) as [number, number], min: num(raw.min, -1), max: num(raw.max, 1) });
    case 'enum': {
      const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
      if (!options.length) throw new Error(`param ${name}: enum needs options`);
      return p.enum({ default: options.includes(String(raw.default)) ? String(raw.default) : options[0], options });
    }
    case 'gradient':
      return p.gradient({
        default: {
          stops: [
            { pos: 0, color: [0, 0, 0] },
            { pos: 1, color: [1, 1, 1] },
          ],
          interp: 'rgb',
        },
      });
    case 'curve':
      return p.curve({ default: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    case 'image':
    case 'asset':
      return p.asset({});
    default:
      throw new Error(`param ${name}: unknown kind "${kind}"`);
  }
}

export function loadPlugin(json: string, glsl: string[], builtinTypes: Set<string>): PluginResult {
  const m = JSON.parse(json) as PluginManifest;
  if (typeof m.type !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(m.type)) throw new Error('invalid "type"');
  if (builtinTypes.has(m.type)) throw new Error(`"${m.type}" clashes with a built-in layer`);
  const kind = KINDS.includes(m.kind as LayerKind) ? (m.kind as LayerKind) : 'generator';
  if (!glsl.length) throw new Error('missing layer.glsl');
  const params: Record<string, ParamSpec> = {};
  for (const [k, raw] of Object.entries(m.params ?? {})) {
    if (!/^[a-zA-Z]\w*$/.test(k)) throw new Error(`invalid param name "${k}"`);
    params[k] = paramFromJson(k, raw ?? {});
  }
  const def = defineLayer({
    type: m.type,
    title: m.title ?? m.type,
    version: Math.max(1, Math.round(num(m.version, 1))),
    kind,
    category: CATEGORIES.includes(m.category as LayerCategory) ? (m.category as LayerCategory) : kind === 'generator' ? 'texture' : 'filter',
    icon: typeof m.icon === 'string' ? m.icon.slice(0, 2) : '✦',
    defaults: { blendMode: (BLEND_MODES as readonly string[]).includes(m.blendMode as string) ? (m.blendMode as BlendMode) : 'normal' },
    params,
    shader: kind === 'generator' ? glsl[0] : undefined,
    passes: kind === 'generator' ? undefined : glsl.map((shader) => ({ shader })),
    plugin: true,
  });
  const strings: Record<string, Record<string, string>> = {};
  for (const [locale, s] of Object.entries(m.i18n ?? {})) {
    const out: Record<string, string> = {};
    if (s.title) out[`layer.${m.type}.title`] = s.title;
    for (const [k, v] of Object.entries(s.params ?? {})) out[`layer.${m.type}.param.${k}`] = v;
    for (const [k, v] of Object.entries(s.options ?? {})) out[`option.${k}`] = v;
    strings[locale] = out;
  }
  strings.en = { [`layer.${m.type}.title`]: m.title ?? m.type, ...(strings.en ?? {}) };
  return { def, strings };
}
