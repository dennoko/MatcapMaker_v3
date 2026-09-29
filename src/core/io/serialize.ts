import { registry } from '../layers/registry';
import { APP_VERSION, defaultViewState, GROUP_TYPE, newId, walkLayers } from '../model/project';
import {
  BLEND_MODES,
  CURRENT_SCHEMA_VERSION,
  type AssetMeta,
  type BlendMode,
  type LayerNode,
  type MaskRef,
  type Project,
  type ViewState,
} from '../model/types';
import { coerceParam, paramEquals, type ParamValue } from '../schema/params';

export interface LoadWarning {
  key: string;
  args?: Record<string, string | number>;
}

export interface LoadResult {
  project: Project;
  view: ViewState;
  warnings: LoadWarning[];
}

// ---------------------------------------------------------------------------
// Save: strict, minimal (only values that differ from defaults)
// ---------------------------------------------------------------------------

function serializeNode(n: LayerNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    typeVersion: n.typeVersion,
    name: n.name,
    enabled: n.enabled,
    opacity: n.opacity,
    blendMode: n.blendMode,
  };
  const def = registry.get(n.type);
  if (def) {
    const params: Record<string, ParamValue> = {};
    for (const [k, spec] of Object.entries(def.params)) {
      const v = n.params[k];
      if (v !== undefined && !paramEquals(v, spec.default)) params[k] = v;
    }
    if (Object.keys(params).length) out.params = params;
  } else if (Object.keys(n.params).length) {
    out.params = n.params;
  }
  if (n.mask) out.mask = n.mask;
  if (n.children) {
    out.children = n.children.map(serializeNode);
    if (n.collapsed) out.collapsed = true;
  }
  return out;
}

/** Asset ids referenced by layers, masks and the view. */
export function referencedAssets(project: Project, view?: ViewState): Set<string> {
  const ids = new Set<string>();
  walkLayers(project.layers, ({ node }) => {
    const def = registry.get(node.type);
    if (def) {
      for (const [k, spec] of Object.entries(def.params)) {
        if (spec.kind === 'asset' && typeof node.params[k] === 'string') ids.add(node.params[k] as string);
      }
    }
    if (node.mask?.asset) ids.add(node.mask.asset);
  });
  if (view?.normalMap.asset) ids.add(view.normalMap.asset);
  if (view?.mesh) ids.add(view.mesh);
  return ids;
}

export function serializeProject(project: Project, view: ViewState): string {
  const used = referencedAssets(project, view);
  const assets: Record<string, AssetMeta> = {};
  for (const [id, meta] of Object.entries(project.assets)) if (used.has(id)) assets[id] = meta;
  const doc = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...project.meta, createdWith: project.meta.createdWith || APP_VERSION, modifiedAt: new Date().toISOString() },
    settings: project.settings,
    layers: project.layers.map(serializeNode),
    assets,
    view,
  };
  return JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// Load: tolerant (defaults for missing, drop unknown, skip unknown layers)
// ---------------------------------------------------------------------------

/** schemaVersion migrations: MIGRATIONS[n] converts version n → n+1. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/**
 * A version number from a file: a positive safe integer, else `fallback`.
 * Keeps migration loops (`while (v < current) v++`) finite and short.
 */
export const versionNum = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : fallback;

export function coerceBlendMode(v: unknown, fallback: BlendMode): BlendMode {
  return typeof v === 'string' && (BLEND_MODES as readonly string[]).includes(v) ? (v as BlendMode) : fallback;
}

function coerceMask(v: unknown): MaskRef | undefined {
  if (!isObj(v)) return undefined;
  const sources = ['fresnel', 'noise', 'image', 'layer'];
  return {
    enabled: v.enabled !== false,
    source: sources.includes(v.source as string) ? (v.source as MaskRef['source']) : 'fresnel',
    invert: v.invert === true,
    amount: num(v.amount, 2, 0, 100),
    asset: typeof v.asset === 'string' ? v.asset : null,
    layerId: typeof v.layerId === 'string' ? v.layerId : null,
  };
}

/** Validates one raw node against its definition (recursively for groups). */
export function coerceNode(raw: unknown, warnings: LoadWarning[], seen = new Set<string>()): LayerNode | null {
  if (!isObj(raw)) return null;
  const type = String(raw.type ?? '');
  let id = typeof raw.id === 'string' && raw.id ? raw.id : newId();
  if (seen.has(id)) id = newId();
  seen.add(id);
  if (type === GROUP_TYPE) {
    const children = Array.isArray(raw.children)
      ? raw.children.map((c) => coerceNode(c, warnings, seen)).filter((c): c is LayerNode => !!c)
      : [];
    return {
      id,
      type,
      typeVersion: 1,
      name: typeof raw.name === 'string' ? raw.name : 'Group',
      enabled: raw.enabled !== false,
      opacity: num(raw.opacity, 1, 0, 1),
      blendMode: coerceBlendMode(raw.blendMode, 'normal'),
      params: {},
      mask: coerceMask(raw.mask),
      children,
      collapsed: raw.collapsed === true,
    };
  }
  const def = registry.get(type);
  if (!def) {
    warnings.push({ key: 'warn.unknownLayer', args: { type: type || '?' } });
    return null;
  }
  let params: Record<string, unknown> = isObj(raw.params) ? { ...raw.params } : {};
  let tv = versionNum(raw.typeVersion, def.version);
  if (tv > def.version) warnings.push({ key: 'warn.newerLayer', args: { type } });
  while (tv < def.version) {
    const m = def.migrations?.[tv];
    if (m) params = m(params);
    tv++;
  }
  const out: Record<string, ParamValue> = {};
  for (const [k, spec] of Object.entries(def.params)) out[k] = coerceParam(spec, params[k]);
  for (const k of Object.keys(params)) {
    if (!(k in def.params)) warnings.push({ key: 'warn.unknownParam', args: { type, param: k } });
  }
  return {
    id,
    type,
    typeVersion: def.version,
    name: typeof raw.name === 'string' ? raw.name : def.title,
    enabled: raw.enabled !== false,
    opacity: num(raw.opacity, def.defaults.opacity ?? 1, 0, 1),
    blendMode: coerceBlendMode(raw.blendMode, def.defaults.blendMode),
    params: out,
    mask: coerceMask(raw.mask),
  };
}

export function coerceView(raw: unknown): ViewState {
  const v = defaultViewState();
  if (!isObj(raw)) return v;
  const shapes = ['sphere', 'flat', 'normalMap', 'mesh'];
  const splits = ['single', 'compare', 'beforeAfter'];
  if (shapes.includes(raw.previewShape as string)) v.previewShape = raw.previewShape as ViewState['previewShape'];
  if (splits.includes(raw.split as string)) v.split = raw.split as ViewState['split'];
  if (isObj(raw.normalMap)) {
    const n = raw.normalMap;
    v.normalMap = {
      asset: typeof n.asset === 'string' ? n.asset : null,
      strength: num(n.strength, 1, 0, 10),
      scale: num(n.scale, 1, 0.01, 50),
      offset: Array.isArray(n.offset) ? [num(n.offset[0], 0), num(n.offset[1], 0)] : [0, 0],
    };
  }
  v.mesh = typeof raw.mesh === 'string' ? raw.mesh : null;
  v.zoom = num(raw.zoom, 1, 0.1, 8);
  v.showGizmos = raw.showGizmos !== false;
  v.swipe = num(raw.swipe, 0.5, 0, 1);
  v.exposure = num(raw.exposure, 0, -10, 10);
  v.toneMap = raw.toneMap !== false;
  if (Array.isArray(raw.orbit)) v.orbit = [num(raw.orbit[0], 0), num(raw.orbit[1], 0)];
  return v;
}

export function isLegacyV3(doc: unknown): boolean {
  if (!isObj(doc)) return false;
  if ('schemaVersion' in doc) return false;
  return 'app_version' in doc || (Array.isArray(doc.layers) && doc.layers.some((l) => isObj(l) && 'blend_mode' in l));
}

export function deserializeProject(json: string): LoadResult {
  let doc = JSON.parse(json) as Record<string, unknown>;
  const warnings: LoadWarning[] = [];
  let ver = versionNum(doc.schemaVersion, 1);
  if (ver > CURRENT_SCHEMA_VERSION) warnings.push({ key: 'warn.newerProject' });
  while (ver < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS[ver];
    if (m) doc = m(doc);
    ver++;
  }
  const meta = isObj(doc.meta) ? doc.meta : {};
  const settings = isObj(doc.settings) ? doc.settings : {};
  const seen = new Set<string>();
  const layers = (Array.isArray(doc.layers) ? doc.layers : [])
    .map((l) => coerceNode(l, warnings, seen))
    .filter((l): l is LayerNode => !!l);
  const assets: Record<string, AssetMeta> = {};
  if (isObj(doc.assets)) {
    for (const [id, m] of Object.entries(doc.assets)) {
      if (!isObj(m)) continue;
      assets[id] = {
        name: String(m.name ?? id),
        mime: String(m.mime ?? 'application/octet-stream'),
        ext: String(m.ext ?? 'bin'),
        width: num(m.width, 0),
        height: num(m.height, 0),
      };
    }
  }
  const project: Project = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      name: typeof meta.name === 'string' ? meta.name : 'Untitled',
      createdWith: typeof meta.createdWith === 'string' ? meta.createdWith : APP_VERSION,
      modifiedAt: typeof meta.modifiedAt === 'string' ? meta.modifiedAt : new Date().toISOString(),
    },
    settings: {
      blendSpace: settings.blendSpace === 'linear' ? 'linear' : 'srgb',
      hdr: settings.hdr === true,
    },
    layers,
    assets,
  };
  return { project, view: coerceView(doc.view), warnings };
}

/** File name of an asset inside the archive. */
export function assetFileName(id: string, meta: AssetMeta): string {
  return `assets/${id}.${meta.ext}`;
}
