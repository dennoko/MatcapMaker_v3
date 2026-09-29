// Importer for v3 (Python) projects: project.json with snake_case params,
// array head = back-most layer, image paths relative to the json file.

import { registry } from '../layers/registry';
import { APP_VERSION, createLayer, defaultViewState, newId } from '../model/project';
import { BLEND_MODES, CURRENT_SCHEMA_VERSION, type BlendMode, type LayerNode, type Project } from '../model/types';
import { coerceParam, type ParamValue } from '../schema/params';
import type { AssetStore } from './assetStore';
import type { LoadResult, LoadWarning } from './serialize';

export const LEGACY_BLEND: Record<string, BlendMode> = {
  Normal: 'normal',
  Add: 'add',
  Multiply: 'multiply',
  Screen: 'screen',
  Subtract: 'subtract',
  Lighten: 'lighten',
  Darken: 'darken',
  Overlay: 'overlay',
  'Soft Light': 'softLight',
  'Hard Light': 'hardLight',
  'Color Dodge': 'colorDodge',
  Difference: 'difference',
};

/** Every parameter name v3 wrote (anything else is reported as unknown). */
const V3_PARAMS = new Set([
  'base_color', 'preview_mode', 'normal_map_path', 'normal_strength', 'normal_scale', 'normal_offset',
  'direction', 'color', 'intensity', 'range', 'blur', 'scale_x', 'scale_y', 'rotation',
  'power', 'bias', 'scale', 'seed', 'image_path', 'mapping_mode', 'offset', 'aspect_ratio',
  'gradient_stops', 'angle', 'gradient_type', 'hue', 'saturation', 'brightness', 'contrast',
  'mode', 'radius', 'amount',
]);

export type ResolveFile = (path: string) => Promise<{ name: string; bytes: Uint8Array } | null>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Resolves a v3 image path (absolute, or "./assets/x.png" relative to the project json). */
export function resolveLegacyPath(p: string, projectDir: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')) return p;
  const rel = p.replace(/^\.[\\/]/, '');
  const sep = projectDir.includes('\\') ? '\\' : '/';
  return projectDir ? `${projectDir.replace(/[\\/]+$/, '')}${sep}${rel.replace(/[\\/]/g, sep)}` : rel;
}

export async function importLegacyV3(
  json: string,
  opts: { projectDir: string; name: string; resolve: ResolveFile; assets: AssetStore },
): Promise<LoadResult> {
  const doc = JSON.parse(json) as Record<string, unknown>;
  const warnings: LoadWarning[] = [];
  const view = defaultViewState();
  const project: Project = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { name: opts.name, createdWith: `v3 import (${APP_VERSION})`, modifiedAt: new Date().toISOString() },
    settings: { blendSpace: 'srgb', hdr: false },
    layers: [],
    assets: {},
  };

  const importAsset = async (path: unknown): Promise<string | null> => {
    if (typeof path !== 'string' || !path) return null;
    const full = resolveLegacyPath(path, opts.projectDir);
    const file = await opts.resolve(full).catch(() => null);
    if (!file) {
      warnings.push({ key: 'warn.missingImage', args: { path } });
      return null;
    }
    const entry = await opts.assets.add(file.bytes, file.name);
    project.assets[entry.id] = { ...entry.meta };
    return entry.id;
  };

  const rawLayers = Array.isArray(doc.layers) ? doc.layers : [];
  const converted: LayerNode[] = [];
  for (const raw of rawLayers) {
    if (!isObj(raw)) continue;
    const legacyType = String(raw.type ?? '');
    const def = registry.byLegacyType(legacyType);
    if (!def || !def.legacy) {
      warnings.push({ key: 'warn.unknownLayer', args: { type: legacyType || '?' } });
      continue;
    }
    const old = isObj(raw.params) ? raw.params : {};
    const mapped = def.legacy.params(old);
    const node = createLayer(def.type);
    node.id = newId();
    for (const [k, v] of Object.entries(mapped)) {
      const spec = def.params[k];
      if (spec && v !== undefined) node.params[k] = coerceParam(spec, v) as ParamValue;
    }
    for (const k of Object.keys(old)) {
      if (!V3_PARAMS.has(k)) warnings.push({ key: 'warn.unknownParam', args: { type: legacyType, param: k } });
    }

    node.name = typeof raw.name === 'string' ? raw.name : def.title;
    node.enabled = raw.enabled !== false;
    node.opacity = typeof raw.opacity === 'number' ? Math.min(1, Math.max(0, raw.opacity)) : 1;
    const bm = LEGACY_BLEND[String(raw.blend_mode)] ?? def.defaults.blendMode;
    node.blendMode = (BLEND_MODES as readonly string[]).includes(bm) ? bm : def.defaults.blendMode;

    if (legacyType === 'ImageLayer') {
      node.params.image = await importAsset(old.image_path);
    }
    if (legacyType === 'BaseLayer') {
      // preview settings move to the view state
      if (old.preview_mode === 'With Normal Map') {
        view.split = 'compare';
      }
      const nm = await importAsset(old.normal_map_path);
      view.normalMap = {
        asset: nm,
        strength: typeof old.normal_strength === 'number' ? old.normal_strength : 1,
        scale: typeof old.normal_scale === 'number' ? old.normal_scale : 1,
        offset: Array.isArray(old.normal_offset)
          ? [Number(old.normal_offset[0]) || 0, Number(old.normal_offset[1]) || 0]
          : [0, 0],
      };
      if (!nm) {
        // the bundled v3 sample normal map is not shipped; fall back quietly
        const idx = warnings.findIndex((w) => w.key === 'warn.missingImage' && w.args?.path === old.normal_map_path);
        if (idx >= 0 && String(old.normal_map_path).includes('test_leather')) warnings.splice(idx, 1);
      }
      if (node.name === 'Base Layer') node.name = 'Base';
    }
    converted.push(node);
  }
  // v3: array head = back-most; v4: head = front-most
  project.layers = converted.reverse();
  return { project, view, warnings };
}
