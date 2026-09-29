import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { LayerNode, Project } from '../model/types';

enablePatches();

export interface Command {
  type: string;
  /** i18n key for the history label */
  label: string;
  labelArgs?: Record<string, string | number>;
  /** Consecutive commands with the same key (within MERGE_WINDOW) become one undo step. */
  mergeKey?: string;
  apply(draft: Draft<Project>): void;
}

export interface HistoryEntry {
  id: number;
  label: string;
  labelArgs?: Record<string, string | number>;
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  time: number;
}

export type ChangeSource = 'dispatch' | 'transaction' | 'undo' | 'redo' | 'load';

export interface ChangeEvent {
  source: ChangeSource;
  /** Layers whose own data changed (params, blend, name...). */
  changedLayerIds: Set<string>;
  /** Layer list structure changed (add/remove/reorder). */
  structural: boolean;
}

type Listener = (state: Project, e: ChangeEvent) => void;

const MERGE_WINDOW = 1200;
const MAX_HISTORY = 300;

/** Resolves which layers a patch path touches (layers can nest in groups). */
function layersFromPath(state: Project, path: (string | number)[], out: Set<string>): boolean {
  if (path[0] !== 'layers') return false;
  let list: LayerNode[] | undefined = state.layers;
  let i = 1;
  for (;;) {
    if (i >= path.length) return true; // whole list replaced
    const idx = Number(path[i]);
    if (Number.isNaN(idx)) return true; // e.g. 'length'
    const node: LayerNode | undefined = list?.[idx];
    if (i + 1 >= path.length) {
      // node inserted / removed / replaced
      if (node) out.add(node.id);
      return true;
    }
    if (!node) return true;
    out.add(node.id);
    if (path[i + 1] !== 'children') return false;
    list = node.children;
    i += 2;
  }
}

export class DocumentStore {
  private _state: Project;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  private tx: { label: string; labelArgs?: Record<string, string | number>; patches: Patch[]; inverse: Patch[] } | null =
    null;
  private nextId = 1;
  private savedAt: number | null = 0;
  private historyListeners = new Set<() => void>();

  constructor(initial: Project) {
    this._state = initial;
  }

  get state(): Project {
    return this._state;
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onHistory(l: () => void): () => void {
    this.historyListeners.add(l);
    return () => this.historyListeners.delete(l);
  }

  private emit(source: ChangeSource, patches: Patch[]) {
    const ids = new Set<string>();
    let structural = false;
    for (const p of patches) {
      if (layersFromPath(this._state, p.path, ids)) structural = true;
      if (p.path[0] === 'layers' && p.path.length <= 2) structural = true;
    }
    const e: ChangeEvent = { source, changedLayerIds: ids, structural };
    this.listeners.forEach((l) => l(this._state, e));
  }

  private emitHistory() {
    this.historyListeners.forEach((l) => l());
  }

  /** Applies a command. Inside a transaction it is folded into one step. */
  dispatch(cmd: Command): void {
    const [next, patches, inverse] = produceWithPatches(this._state, (d) => {
      cmd.apply(d);
    });
    if (!patches.length) return;
    this._state = next;
    if (this.tx) {
      this.tx.patches.push(...patches);
      this.tx.inverse = [...inverse, ...this.tx.inverse];
      this.emit('transaction', patches);
      return;
    }
    const top = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (top && cmd.mergeKey && top.mergeKey === cmd.mergeKey && now - top.time < MERGE_WINDOW && top.id !== this.savedAt) {
      top.patches.push(...patches);
      top.inverse = [...inverse, ...top.inverse];
      top.time = now;
    } else {
      this.push({
        id: this.nextId++,
        label: cmd.label,
        labelArgs: cmd.labelArgs,
        patches,
        inverse,
        mergeKey: cmd.mergeKey,
        time: now,
      });
    }
    this.emit('dispatch', patches);
    this.emitHistory();
  }

  private push(e: HistoryEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Starts grouping (e.g. slider drag): intermediate updates render but record one step. */
  begin(label: string, labelArgs?: Record<string, string | number>) {
    if (this.tx) this.commit();
    this.tx = { label, labelArgs, patches: [], inverse: [] };
  }

  commit() {
    const tx = this.tx;
    this.tx = null;
    if (!tx || !tx.patches.length) return;
    this.push({ id: this.nextId++, label: tx.label, labelArgs: tx.labelArgs, patches: tx.patches, inverse: tx.inverse, time: Date.now() });
    this.emit('dispatch', []);
    this.emitHistory();
  }

  /** Reverts everything done since begin(). */
  cancel() {
    const tx = this.tx;
    this.tx = null;
    if (!tx || !tx.patches.length) return;
    this._state = applyPatches(this._state, tx.inverse);
    this.emit('undo', tx.inverse);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (this.tx) this.commit();
    const e = this.undoStack.pop();
    if (!e) return;
    this._state = applyPatches(this._state, e.inverse);
    this.redoStack.push(e);
    this.emit('undo', e.inverse);
    this.emitHistory();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this._state = applyPatches(this._state, e.patches);
    this.undoStack.push(e);
    this.emit('redo', e.patches);
    this.emitHistory();
  }

  /** Jumps to a history position (index into entries(); -1 = initial state). */
  jumpTo(index: number) {
    while (this.undoStack.length - 1 > index && this.canUndo) this.undo();
    while (this.undoStack.length - 1 < index && this.canRedo) this.redo();
  }

  /**
   * Every string value held by the undo/redo history and an open transaction
   * (e.g. asset ids that undoing a removal would bring back).
   */
  historyStrings(): Set<string> {
    const out = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === 'string') out.add(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    const scan = (e: { patches: Patch[]; inverse: Patch[] }) => {
      for (const p of e.patches) walk(p.value);
      for (const p of e.inverse) walk(p.value);
    };
    this.undoStack.forEach(scan);
    this.redoStack.forEach(scan);
    if (this.tx) scan(this.tx);
    return out;
  }

  /** Undo entries (oldest first) followed by redo entries (next first). */
  entries(): { past: HistoryEntry[]; future: HistoryEntry[] } {
    return { past: [...this.undoStack], future: [...this.redoStack].reverse() };
  }

  /** Replaces the document (new/open). Clears history. */
  load(project: Project) {
    this.tx = null;
    this._state = project;
    this.undoStack = [];
    this.redoStack = [];
    this.savedAt = 0;
    this.listeners.forEach((l) =>
      l(this._state, { source: 'load', changedLayerIds: new Set(), structural: true }),
    );
    this.emitHistory();
  }

  /** Updates without recording history (metadata such as modifiedAt). */
  silent(mutate: (d: Draft<Project>) => void) {
    const [next] = produceWithPatches(this._state, mutate);
    this._state = next;
  }

  markSaved() {
    this.savedAt = this.undoStack.length ? this.undoStack[this.undoStack.length - 1].id : 0;
    this.emitHistory();
  }

  /** Forces the dirty state (e.g. a restored autosave that was never saved). */
  markUnsaved() {
    this.savedAt = null;
    this.emitHistory();
  }

  get isDirty(): boolean {
    const top = this.undoStack.length ? this.undoStack[this.undoStack.length - 1].id : 0;
    return top !== this.savedAt;
  }
}
