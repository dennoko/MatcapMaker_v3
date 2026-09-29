// Binds widget edit phases to the document store: a drag becomes one
// transaction (one undo step), discrete edits are single (mergeable) steps.

import { store } from './state.svelte';
import { setLayerProp, setMask, setParam } from '$core/commands/layerCommands';
import type { LayerNode, MaskRef } from '$core/model/types';
import type { ParamValue } from '$core/schema/params';
import type { OnEdit, Phase } from './widgets/edit';

function wrap(label: string, labelArgs: Record<string, string | number> | undefined, apply: (merge: boolean) => void) {
  return (phase: Phase) => {
    if (phase === 'begin') {
      store.begin(label, labelArgs);
      return;
    }
    apply(phase === 'set');
    if (phase === 'end') store.commit();
  };
}

export function paramEdit(nodeId: string, key: string, label: string): OnEdit<ParamValue> {
  return (value, phase) =>
    wrap('history.setParam', { param: label }, (merge) => store.dispatch(setParam(nodeId, key, value, merge)))(phase);
}

export function propEdit<K extends 'opacity' | 'blendMode' | 'name' | 'enabled'>(
  ids: string[],
  key: K,
): OnEdit<LayerNode[K]> {
  return (value, phase) => wrap(`history.set.${key}`, undefined, (merge) => store.dispatch(setLayerProp(ids, key, value, merge)))(phase);
}

export function maskEdit(nodeId: string, base: MaskRef | undefined): <K extends keyof MaskRef>(key: K) => OnEdit<MaskRef[K]> {
  return (key) => (value, phase) =>
    wrap('history.setMask', undefined, () => {
      const m: MaskRef = { enabled: true, source: 'fresnel', invert: false, amount: 2, ...(base ?? {}) };
      (m as unknown as Record<string, unknown>)[key] = value;
      store.dispatch(setMask(nodeId, m));
    })(phase);
}
