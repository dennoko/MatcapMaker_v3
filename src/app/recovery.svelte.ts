// Autosave for crash recovery: 2 s after the last change a snapshot is
// written to %LOCALAPPDATA%\MatcapMaker\recovery; it is removed on a clean
// exit and offered for restore on the next start if it is still there.

import { app, onDocChange, platform, store, toast } from './state.svelte';
import { buildBundle, openFile, reportError, updateTitle } from './actions';
import { tt } from './i18n.svelte';
import { webMarkRecoveryTime } from '$platform/web';

let timer: ReturnType<typeof setTimeout> | undefined;
let writing = false;

export function startAutosave() {
  onDocChange(() => schedule());
  // view changes are saved with the project too
  $effect.root(() => {
    $effect(() => {
      void JSON.stringify(app.view);
      schedule();
    });
  });
}

function schedule() {
  if (!app.settings.autosave) return;
  clearTimeout(timer);
  timer = setTimeout(write, 2000);
}

async function write() {
  if (writing || !store.isDirty) return;
  writing = true;
  try {
    const bundle = await buildBundle(app.doc, app.view, false);
    const doc = JSON.parse(bundle.projectJson);
    doc.recovery = { sourcePath: app.filePath, savedAt: new Date().toISOString() };
    bundle.projectJson = JSON.stringify(doc);
    await platform.saveProject(await platform.recoveryPath(), bundle);
    if (platform.kind === 'web') await webMarkRecoveryTime();
  } catch (e) {
    platform.log('warn', `autosave failed: ${String(e)}`);
  } finally {
    writing = false;
  }
}

export async function clearRecovery() {
  clearTimeout(timer);
  await platform.recoveryClear().catch(() => undefined);
}

export async function checkRecovery(): Promise<{ path: string; modified: number } | null> {
  return platform.recoveryCheck().catch(() => null);
}

export async function restoreRecovery(path: string) {
  try {
    const bundle = await platform.loadProject({ path });
    const doc = JSON.parse(bundle.projectJson);
    const source: string | null = doc.recovery?.sourcePath ?? null;
    await openFile({ path, name: 'recovery.mcproj' }, true, false);
    app.filePath = platform.kind === 'tauri' ? source : null;
    // it was never saved: keep it dirty so closing asks to save
    store.markUnsaved();
    updateTitle();
    toast(tt('toast.recovered'), 'success');
  } catch (e) {
    reportError(tt('error.open', { name: 'recovery' }), e);
  }
}
