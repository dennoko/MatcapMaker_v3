import { registry } from '../layers/registry';
import { coerceParam, defaultParams, normalize3, type ParamValue } from '../schema/params';
import {
  CURRENT_SCHEMA_VERSION,
  type LayerNode,
  type Project,
  type ViewState,
} from './types';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const GROUP_TYPE = 'group';

export function createLayer(type: string, params: Record<string, unknown> = {}, name?: string): LayerNode {
  if (type === GROUP_TYPE) return createGroup(name);
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown layer type: ${type}`);
  const base = defaultParams(def.params);
  for (const [k, v] of Object.entries(params)) {
    const spec = def.params[k];
    if (spec && v !== undefined) base[k] = coerceParam(spec, v);
  }
  return {
    id: newId(),
    type,
    typeVersion: def.version,
    name: name ?? def.title,
    enabled: true,
    opacity: def.defaults.opacity ?? 1,
    blendMode: def.defaults.blendMode,
    params: base,
  };
}

export function createGroup(name = 'Group', children: LayerNode[] = []): LayerNode {
  return {
    id: newId(),
    type: GROUP_TYPE,
    typeVersion: 1,
    name,
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    params: {},
    children,
    collapsed: false,
  };
}

/** Default document for "New project": black base + soft key light (v3 defaults). */
export function createDefaultProject(name = 'Untitled'): Project {
  const spot = createLayer('spotLight', {
    range: 0.13,
    blur: 1.0,
    direction: normalize3([-0.35, 0.22, 1.0]),
  });
  const base = createLayer('solidColor', { color: [0, 0, 0] }, 'Base');
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { name, createdWith: APP_VERSION, modifiedAt: new Date().toISOString() },
    settings: { blendSpace: 'srgb', hdr: false },
    layers: [spot, base],
    assets: {},
  };
}

export function createEmptyProject(name = 'Untitled'): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { name, createdWith: APP_VERSION, modifiedAt: new Date().toISOString() },
    settings: { blendSpace: 'srgb', hdr: false },
    layers: [],
    assets: {},
  };
}

export function defaultViewState(): ViewState {
  return {
    previewShape: 'sphere',
    split: 'single',
    normalMap: { asset: null, strength: 1, scale: 1, offset: [0, 0] },
    mesh: null,
    zoom: 1,
    showGizmos: true,
    swipe: 0.5,
    orbit: [0, 0],
    exposure: 0,
    toneMap: true,
  };
}

/** Deep-copies a layer (and children) with fresh ids. */
export function cloneLayer(node: LayerNode, suffix = ''): LayerNode {
  const copy: LayerNode = structuredClone(node);
  const reid = (n: LayerNode) => {
    n.id = newId();
    n.children?.forEach(reid);
  };
  reid(copy);
  copy.name = node.name + suffix;
  return copy;
}

// ---------------------------------------------------------------------------
// Tree helpers (layers can nest inside groups)
// ---------------------------------------------------------------------------

export interface LayerLocation {
  parent: LayerNode[];
  index: number;
  node: LayerNode;
  depth: number;
  parentId: string | null;
}

export function walkLayers(
  layers: LayerNode[],
  fn: (loc: LayerLocation) => void | boolean,
  depth = 0,
  parentId: string | null = null,
): boolean {
  for (let i = 0; i < layers.length; i++) {
    const node = layers[i];
    if (fn({ parent: layers, index: i, node, depth, parentId }) === false) return false;
    if (node.children && !walkLayers(node.children, fn, depth + 1, node.id)) return false;
  }
  return true;
}

export function findLayer(layers: LayerNode[], id: string): LayerLocation | null {
  let found: LayerLocation | null = null;
  walkLayers(layers, (loc) => {
    if (loc.node.id === id) {
      found = loc;
      return false;
    }
  });
  return found;
}

export function flattenLayers(layers: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  walkLayers(layers, ({ node }) => {
    out.push(node);
  });
  return out;
}

export function isGroup(node: LayerNode): boolean {
  return node.type === GROUP_TYPE;
}

export function paramValue<T extends ParamValue>(node: LayerNode, key: string): T {
  return node.params[key] as T;
}
