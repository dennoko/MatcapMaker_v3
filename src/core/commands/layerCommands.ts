import type { Draft } from 'immer';
import type { Command } from './store';
import type { BlendMode, BlendSpace, LayerNode, MaskRef, Project } from '../model/types';
import { cloneLayer, createGroup, findLayer, flattenLayers, isGroup } from '../model/project';
import type { ParamValue } from '../schema/params';

type D = Draft<Project>;

function locate(d: D, id: string) {
  return findLayer(d.layers as LayerNode[], id) as
    | { parent: LayerNode[]; index: number; node: Draft<LayerNode>; parentId: string | null }
    | null;
}

function listOf(d: D, parentId: string | null): LayerNode[] {
  if (!parentId) return d.layers as LayerNode[];
  const loc = locate(d, parentId);
  if (!loc || !loc.node.children) throw new Error('parent is not a group');
  return loc.node.children as LayerNode[];
}

/** Inserts a layer. index 0 = front-most of the parent list. */
export function addLayer(node: LayerNode, parentId: string | null = null, index = 0): Command {
  return {
    type: 'addLayer',
    label: 'history.addLayer',
    labelArgs: { name: node.name },
    apply(d) {
      const list = listOf(d, parentId);
      list.splice(Math.max(0, Math.min(index, list.length)), 0, node);
    },
  };
}

export function removeLayers(ids: string[]): Command {
  return {
    type: 'removeLayers',
    label: 'history.removeLayer',
    labelArgs: { count: ids.length },
    apply(d) {
      for (const id of ids) {
        const loc = locate(d, id);
        if (loc) loc.parent.splice(loc.index, 1);
      }
    },
  };
}

/** Duplicates each layer directly above (in front of) itself. Returns new ids via `out`. */
export function duplicateLayers(ids: string[], out: string[] = [], suffix = ' copy'): Command {
  return {
    type: 'duplicateLayers',
    label: 'history.duplicateLayer',
    labelArgs: { count: ids.length },
    apply(d) {
      out.length = 0;
      for (const id of ids) {
        const loc = locate(d, id);
        if (!loc) continue;
        const copy = cloneLayer(JSON.parse(JSON.stringify(loc.node)) as LayerNode, suffix);
        loc.parent.splice(loc.index, 0, copy);
        out.push(copy.id);
      }
    },
  };
}

/** Moves a layer to parent/index (index in the destination list after removal). */
export function moveLayer(id: string, parentId: string | null, index: number): Command {
  return {
    type: 'moveLayer',
    label: 'history.moveLayer',
    apply(d) {
      const loc = locate(d, id);
      if (!loc) return;
      // refuse to move a group into itself / its descendants
      if (parentId) {
        if (parentId === id) return;
        const inner = flattenLayers(loc.node.children as LayerNode[] ?? []);
        if (inner.some((n) => n.id === parentId)) return;
      }
      const [node] = loc.parent.splice(loc.index, 1);
      const list = listOf(d, parentId);
      list.splice(Math.max(0, Math.min(index, list.length)), 0, node);
    },
  };
}

/** Moves one step toward the front (-1) or back (+1) within its list. */
export function nudgeLayer(id: string, delta: -1 | 1): Command {
  return {
    type: 'nudgeLayer',
    label: 'history.moveLayer',
    apply(d) {
      const loc = locate(d, id);
      if (!loc) return;
      const to = loc.index + delta;
      if (to < 0 || to >= loc.parent.length) return;
      const [node] = loc.parent.splice(loc.index, 1);
      loc.parent.splice(to, 0, node);
    },
  };
}

type NodeProp = 'name' | 'enabled' | 'opacity' | 'blendMode' | 'collapsed';

export function setLayerProp<K extends NodeProp>(ids: string[], key: K, value: LayerNode[K], merge = true): Command {
  return {
    type: 'setLayerProp',
    label: `history.set.${key}`,
    mergeKey: merge ? `prop:${key}:${ids.join(',')}` : undefined,
    apply(d) {
      for (const id of ids) {
        const loc = locate(d, id);
        if (loc) (loc.node as LayerNode)[key] = value;
      }
    },
  };
}

export function setParam(id: string, key: string, value: ParamValue, merge = true): Command {
  return {
    type: 'setParam',
    label: 'history.setParam',
    labelArgs: { param: key },
    mergeKey: merge ? `param:${id}:${key}` : undefined,
    apply(d) {
      const loc = locate(d, id);
      if (loc) loc.node.params[key] = value as never;
    },
  };
}

export function setParams(id: string, values: Record<string, ParamValue>, label = 'history.setParam'): Command {
  return {
    type: 'setParams',
    label,
    labelArgs: { param: Object.keys(values).join(', ') },
    mergeKey: `params:${id}:${Object.keys(values).join(',')}`,
    apply(d) {
      const loc = locate(d, id);
      if (!loc) return;
      for (const [k, v] of Object.entries(values)) loc.node.params[k] = v as never;
    },
  };
}

export function setMask(id: string, mask: MaskRef | undefined): Command {
  return {
    type: 'setMask',
    label: 'history.setMask',
    mergeKey: `mask:${id}`,
    apply(d) {
      const loc = locate(d, id);
      if (!loc) return;
      if (mask) loc.node.mask = mask;
      else delete loc.node.mask;
    },
  };
}

/** Wraps the given layers (same parent) into a new group at the front-most position. */
export function groupLayers(ids: string[], name: string, outId: { id?: string } = {}): Command {
  return {
    type: 'groupLayers',
    label: 'history.group',
    apply(d) {
      const locs = ids.map((id) => locate(d, id)).filter((l) => l !== null);
      if (!locs.length) return;
      const parent = locs[0]!.parent;
      const same = locs.filter((l) => l!.parent === parent).sort((a, b) => a!.index - b!.index);
      const at = same[0]!.index;
      const nodes = same.map((l) => JSON.parse(JSON.stringify(l!.node)) as LayerNode);
      for (const l of [...same].reverse()) parent.splice(l!.index, 1);
      const g = createGroup(name, nodes);
      outId.id = g.id;
      parent.splice(at, 0, g);
    },
  };
}

export function ungroup(id: string): Command {
  return {
    type: 'ungroup',
    label: 'history.ungroup',
    apply(d) {
      const loc = locate(d, id);
      if (!loc || !isGroup(loc.node as LayerNode)) return;
      const kids = (loc.node.children ?? []) as LayerNode[];
      loc.parent.splice(loc.index, 1, ...JSON.parse(JSON.stringify(kids)));
    },
  };
}

export function setBlendSpace(v: BlendSpace): Command {
  return {
    type: 'setBlendSpace',
    label: 'history.setBlendSpace',
    apply(d) {
      d.settings.blendSpace = v;
    },
  };
}

export function setHdr(v: boolean): Command {
  return {
    type: 'setHdr',
    label: 'history.setHdr',
    apply(d) {
      d.settings.hdr = v;
    },
  };
}

export function renameProject(name: string): Command {
  return {
    type: 'renameProject',
    label: 'history.renameProject',
    apply(d) {
      d.meta.name = name;
    },
  };
}

/** Replaces a layer entirely (used by "reset layer" and preset application). */
export function replaceLayer(id: string, node: LayerNode): Command {
  return {
    type: 'replaceLayer',
    label: 'history.replaceLayer',
    labelArgs: { name: node.name },
    apply(d) {
      const loc = locate(d, id);
      if (loc) loc.parent.splice(loc.index, 1, node);
    },
  };
}

export const BLEND_LABEL_KEY = (m: BlendMode) => `blend.${m}`;
