import { app } from './state.svelte';
import {
  deleteSelected,
  duplicateSelected,
  groupSelected,
  moveSelected,
  newProject,
  openDialog,
  quickExport,
  redo,
  saveProject,
  toggleVisibility,
  undo,
  ungroupSelected,
  updateSettings,
} from './actions';

export interface ShortcutDef {
  keys: string;
  label: string;
}

/** Shown in the F1 cheat sheet (label = i18n key). */
export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Ctrl+Z', label: 'menu.edit.undo' },
  { keys: 'Ctrl+Y / Ctrl+Shift+Z', label: 'menu.edit.redo' },
  { keys: 'Ctrl+N', label: 'menu.file.new' },
  { keys: 'Ctrl+O', label: 'menu.file.open' },
  { keys: 'Ctrl+S', label: 'menu.file.save' },
  { keys: 'Ctrl+Shift+S', label: 'menu.file.saveAs' },
  { keys: 'Ctrl+E', label: 'menu.file.quickExport' },
  { keys: 'Ctrl+Shift+E', label: 'menu.file.export' },
  { keys: 'Tab', label: 'layers.add' },
  { keys: 'Ctrl+D', label: 'layers.duplicate' },
  { keys: 'Delete', label: 'layers.delete' },
  { keys: 'Ctrl+↑ / Ctrl+↓', label: 'shortcuts.move' },
  { keys: 'Ctrl+G / Ctrl+Shift+G', label: 'shortcuts.group' },
  { keys: 'H', label: 'layers.toggle' },
  { keys: 'Alt+Click (●)', label: 'layers.solo' },
  { keys: 'Ctrl+Click / Shift+Click', label: 'shortcuts.multiSelect' },
  { keys: '1 / 2 / 3 / 4', label: 'shortcuts.views' },
  { keys: 'G', label: 'preview.gizmos' },
  { keys: '\\', label: 'preview.split.beforeAfter' },
  { keys: 'I', label: 'color.eyedropper' },
  { keys: 'Ctrl+V', label: 'menu.edit.pasteImage' },
  { keys: 'Ctrl+, ', label: 'menu.edit.settings' },
  { keys: 'Ctrl+= / Ctrl+-', label: 'shortcuts.uiScale' },
  { keys: 'F1', label: 'menu.help.shortcuts' },
  { keys: 'Shift / Ctrl + drag', label: 'shortcuts.scrub' },
  { keys: 'Double-click', label: 'menu.resetDefault' },
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function handleKeydown(e: KeyboardEvent) {
  if (app.confirm) return;
  const typing = isTyping(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.key === 'Escape') {
    if (app.eyedropper) app.eyedropper = null;
    else if (app.solo.length && !app.dialog) app.solo = [];
    return;
  }
  if (app.dialog && app.dialog !== 'tour') return;

  const run = (f: () => unknown) => {
    e.preventDefault();
    void f();
  };

  if (ctrl) {
    if (typing && ['z', 'y', 'v', 'a', 'c', 'x'].includes(k)) return;
    if (k === 'z' && !e.shiftKey) return run(undo);
    if ((k === 'z' && e.shiftKey) || k === 'y') return run(redo);
    if (k === 'n') return run(() => newProject());
    if (k === 'o') return run(openDialog);
    if (k === 's') return run(() => saveProject(e.shiftKey));
    if (k === 'e') return run(() => (e.shiftKey ? (app.dialog = 'export') : quickExport()));
    if (k === 'd') return run(duplicateSelected);
    if (k === 'g') return run(e.shiftKey ? ungroupSelected : groupSelected);
    // Ctrl+V is handled by the paste event (see App.svelte): no clipboard permission needed
    if (k === 'v') return;
    if (k === ',') return run(() => (app.dialog = 'settings'));
    if (k === 'ArrowUp') return run(() => moveSelected(-1));
    if (k === 'ArrowDown') return run(() => moveSelected(1));
    if (k === '=' || k === '+' || k === ';') return run(() => updateSettings((s) => (s.uiScale = Math.min(2, +(s.uiScale + 0.1).toFixed(2)))));
    if (k === '-') return run(() => updateSettings((s) => (s.uiScale = Math.max(0.6, +(s.uiScale - 0.1).toFixed(2)))));
    if (k === '0') return run(() => updateSettings((s) => (s.uiScale = 1)));
    return;
  }
  if (typing || e.altKey) return;

  switch (k) {
    case 'Tab':
      return run(() => (app.dialog = 'palette'));
    case 'Delete':
    case 'Backspace':
      return run(deleteSelected);
    case 'h':
      return run(() => toggleVisibility());
    case '1':
      return run(() => (app.view.previewShape = 'sphere'));
    case '2':
      return run(() => (app.view.previewShape = 'flat'));
    case '3':
      return run(() => (app.view.previewShape = 'normalMap'));
    case '4':
      return run(() => {
        if (app.view.previewShape === 'mesh') app.view.previewShape = 'sphere';
        app.view.split = app.view.split === 'compare' ? 'single' : 'compare';
      });
    case 'g':
      return run(() => (app.view.showGizmos = !app.view.showGizmos));
    case '\\':
      return run(() => {
        if (app.view.previewShape === 'mesh') app.view.previewShape = 'sphere';
        app.view.split = app.view.split === 'beforeAfter' ? 'single' : 'beforeAfter';
      });
    case 'F1':
      return run(() => (app.dialog = 'shortcuts'));
  }
}
