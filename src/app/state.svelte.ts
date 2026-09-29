// Reactive app state for the Svelte UI. The document itself lives in the
// UI-independent DocumentStore; this module mirrors it into runes and holds
// UI-only state (selection, view, dialogs, settings).

import { DocumentStore, type ChangeEvent } from '$core/commands/store';
import { AssetStore } from '$core/io/assetStore';
import { createDefaultProject, defaultViewState, findLayer, flattenLayers } from '$core/model/project';
import type { LayerNode, Project, ViewState } from '$core/model/types';
import type { LoadWarning } from '$core/io/serialize';
import { detectLocale } from '$core/i18n';
import { createPlatform } from '$platform/index';
import type { Renderer, FrameInfo } from '$render/Renderer';
import type { RenderOptions } from '$render/pipeline/MatcapPipeline';
import { defaultSettings, type AppSettings } from './settings';

export type DialogKind =
  | 'export'
  | 'settings'
  | 'about'
  | 'shortcuts'
  | 'presets'
  | 'palette'
  | 'recovery'
  | 'warnings'
  | 'benchmark'
  | 'tour'
  | 'confirm'
  | 'savePreset'
  | null;

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: { label: string; value: string; primary?: boolean; danger?: boolean }[];
  resolve: (v: string) => void;
}

export const platform = createPlatform();
export const assets = new AssetStore();
export const store = new DocumentStore(createDefaultProject());

class AppState {
  doc = $state.raw<Project>(store.state);
  view = $state<ViewState>(defaultViewState());
  selection = $state<string[]>(store.state.layers[0] ? [store.state.layers[0].id] : []);
  solo = $state<string[]>([]);
  filePath = $state<string | null>(null);
  dirty = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);
  historyVersion = $state(0);
  settings = $state<AppSettings>(defaultSettings(detectLocale()));
  dialog = $state<DialogKind>(null);
  confirm = $state<ConfirmRequest | null>(null);
  toasts = $state<Toast[]>([]);
  warnings = $state<LoadWarning[]>([]);
  frame = $state<FrameInfo | null>(null);
  blendHover = $state<RenderOptions['blendOverride']>(null);
  thumbs = $state<Record<string, string>>({});
  shaderErrors = $state<Record<string, string>>({});
  eyedropper = $state<((rgb: [number, number, number]) => void) | null>(null);
  dropHover = $state<{ x: number; y: number } | null>(null);
  busy = $state<string | null>(null);
  renderer: Renderer | null = null;
  /** incremented to force a redraw without a document change */
  redraw = $state(0);
  pluginsLoaded = $state(0);
  updateAvailable = $state<{ version: string; url: string } | null>(null);
  lastExportPath = $state<string | null>(null);

  get primary(): LayerNode | null {
    const id = this.selection[this.selection.length - 1];
    if (!id) return null;
    return findLayer(this.doc.layers, id)?.node ?? null;
  }

  get soloSet(): ReadonlySet<string> | null {
    return this.solo.length ? new Set(this.solo) : null;
  }
}

export const app = new AppState();

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 4000) {
  const t: Toast = { id: toastId++, kind, text, action };
  app.toasts = [...app.toasts, t];
  setTimeout(() => (app.toasts = app.toasts.filter((x) => x.id !== t.id)), action ? ms * 2 : ms);
}

export function ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<string> {
  return new Promise((resolve) => {
    app.confirm = { ...req, resolve };
  });
}

const changeListeners = new Set<(e: ChangeEvent) => void>();
export function onDocChange(f: (e: ChangeEvent) => void) {
  changeListeners.add(f);
  return () => changeListeners.delete(f);
}

store.subscribe((state, e) => {
  app.doc = state;
  // drop selection of layers that no longer exist
  if (e.structural) {
    const ids = new Set(flattenLayers(state.layers).map((l) => l.id));
    const sel = app.selection.filter((id) => ids.has(id));
    if (sel.length !== app.selection.length) app.selection = sel;
    const solo = app.solo.filter((id) => ids.has(id));
    if (solo.length !== app.solo.length) app.solo = solo;
    // undo/redo of an add/remove: select what came back
    if (!app.selection.length && (e.source === 'undo' || e.source === 'redo')) {
      const back = [...e.changedLayerIds].filter((id) => ids.has(id));
      if (back.length) app.selection = back.slice(0, 1);
      else if (state.layers[0]) app.selection = [state.layers[0].id];
    }
  }
  changeListeners.forEach((f) => f(e));
});

store.onHistory(() => {
  app.canUndo = store.canUndo;
  app.canRedo = store.canRedo;
  app.dirty = store.isDirty;
  app.historyVersion++;
  if (typeof window !== 'undefined') (window as unknown as { __mmDirty?: boolean }).__mmDirty = store.isDirty;
});

export function select(ids: string[]) {
  app.selection = ids;
}
