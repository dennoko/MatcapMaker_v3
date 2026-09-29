import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../../src/core/commands/store';
import {
  addLayer,
  duplicateLayers,
  groupLayers,
  moveLayer,
  nudgeLayer,
  removeLayers,
  setLayerProp,
  setParam,
  ungroup,
} from '../../src/core/commands/layerCommands';
import { createDefaultProject, createLayer, findLayer } from '../../src/core/model/project';

describe('DocumentStore', () => {
  it('undoes and redoes commands', () => {
    const s = new DocumentStore(createDefaultProject());
    const n = s.state.layers.length;
    s.dispatch(addLayer(createLayer('fresnel')));
    expect(s.state.layers.length).toBe(n + 1);
    s.undo();
    expect(s.state.layers.length).toBe(n);
    s.redo();
    expect(s.state.layers.length).toBe(n + 1);
    expect(s.state.layers[0].type).toBe('fresnel');
  });

  it('records a transaction as one history step', () => {
    const s = new DocumentStore(createDefaultProject());
    const id = s.state.layers[0].id;
    s.begin('drag');
    for (let i = 0; i < 20; i++) s.dispatch(setParam(id, 'intensity', i / 10, false));
    s.commit();
    expect(s.entries().past.length).toBe(1);
    expect(s.state.layers[0].params.intensity).toBe(1.9);
    s.undo();
    expect(s.state.layers[0].params.intensity).toBe(1);
  });

  it('merges consecutive commands with the same mergeKey', () => {
    const s = new DocumentStore(createDefaultProject());
    const id = s.state.layers[0].id;
    s.dispatch(setParam(id, 'range', 0.3));
    s.dispatch(setParam(id, 'range', 0.4));
    expect(s.entries().past.length).toBe(1);
  });

  it('reports changed layer ids', () => {
    const s = new DocumentStore(createDefaultProject());
    const id = s.state.layers[1].id;
    let got: Set<string> | null = null;
    let structural = true;
    s.subscribe((_, e) => {
      got = e.changedLayerIds;
      structural = e.structural;
    });
    s.dispatch(setLayerProp([id], 'opacity', 0.5));
    expect(got!.has(id)).toBe(true);
    expect(structural).toBe(false);
  });

  it('tracks dirty state against the saved point', () => {
    const s = new DocumentStore(createDefaultProject());
    expect(s.isDirty).toBe(false);
    s.dispatch(setLayerProp([s.state.layers[0].id], 'name', 'x', false));
    expect(s.isDirty).toBe(true);
    s.markSaved();
    expect(s.isDirty).toBe(false);
    s.undo();
    expect(s.isDirty).toBe(true);
  });

  it('duplicates, moves, groups and ungroups', () => {
    const s = new DocumentStore(createDefaultProject());
    const [a, b] = s.state.layers.map((l) => l.id);
    const out: string[] = [];
    s.dispatch(duplicateLayers([a], out));
    expect(s.state.layers.length).toBe(3);
    expect(s.state.layers[0].id).toBe(out[0]);
    s.dispatch(nudgeLayer(out[0], 1));
    expect(s.state.layers[1].id).toBe(out[0]);
    s.dispatch(moveLayer(b, null, 0));
    expect(s.state.layers[0].id).toBe(b);
    const g: { id?: string } = {};
    s.dispatch(groupLayers([a, out[0]], 'G', g));
    const loc = findLayer(s.state.layers, g.id!);
    expect(loc!.node.children!.map((c) => c.id).sort()).toEqual([a, out[0]].sort());
    s.dispatch(ungroup(g.id!));
    expect(findLayer(s.state.layers, g.id!)).toBeNull();
    s.dispatch(removeLayers([a]));
    expect(findLayer(s.state.layers, a)).toBeNull();
  });
});
