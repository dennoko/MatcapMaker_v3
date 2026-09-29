<script lang="ts">
  import { onMount } from 'svelte';
  import './styles.css';
  import { app, platform } from './state.svelte';
  import { changeLocale, tt } from './i18n.svelte';
  import { confirmDiscard, loadSettings, openPath, redo, undo, updateSettings, updateTitle } from './actions';
  import { handleKeydown } from './shortcuts';
  import MenuBar from './layout/MenuBar.svelte';
  import StatusBar from './layout/StatusBar.svelte';
  import Toasts from './layout/Toasts.svelte';
  import LayerPanel from './panels/LayerPanel.svelte';
  import Inspector from './panels/Inspector.svelte';
  import Viewport from './viewport/Viewport.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import SettingsDialog from './dialogs/SettingsDialog.svelte';
  import AboutDialog from './dialogs/AboutDialog.svelte';
  import ConfirmDialog from './dialogs/ConfirmDialog.svelte';
  import WarningsDialog from './dialogs/WarningsDialog.svelte';
  import CommandPalette from './dialogs/CommandPalette.svelte';
  import { basename } from '$platform/types';

  let winW = $state(window.innerWidth);
  let winH = $state(window.innerHeight);
  const portrait = $derived(winH > winW * 1.05 || winW < 900);

  onMount(() => {
    window.addEventListener('error', (e) => platform.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => platform.log('error', `unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`));
    const onResize = () => {
      winW = window.innerWidth;
      winH = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    (async () => {
      await loadSettings();
      changeLocale(app.settings.language);
      platform.onCloseRequested(async () => {
        if (!(await confirmDiscard())) return false;
        return true;
      });
      const launch = await platform.launchFile().catch(() => null);
      if (launch) await openPath(launch);
      platform.onOpenFile((p) => openPath(p));
      updateTitle();
    })();
    return () => window.removeEventListener('resize', onResize);
  });

  $effect(() => {
    document.documentElement.dataset.theme = app.settings.theme;
    document.documentElement.style.setProperty('--ui-scale', String(app.settings.uiScale));
  });

  $effect(() => {
    void app.dirty;
    void app.filePath;
    void app.doc.meta.name;
    updateTitle();
  });

  // --- panel resizing ------------------------------------------------------
  function resize(e: PointerEvent, side: 'left' | 'right') {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = side === 'left' ? app.settings.leftWidth : app.settings.rightWidth;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const w = Math.min(560, Math.max(180, side === 'left' ? w0 + dx : w0 - dx));
      if (side === 'left') app.settings.leftWidth = w;
      else app.settings.rightWidth = w;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      updateSettings(() => {});
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  const title = $derived(app.filePath ? basename(app.filePath) : `${app.doc.meta.name}.mcproj`);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app" class:portrait>
  <header class="top">
    <MenuBar />
    <div class="title" title={app.filePath ?? ''}>
      {title}{#if app.dirty}<span class="dot" title={tt('status.unsaved')}> •</span>{/if}
    </div>
    <div class="actions">
      <button class="btn icon ghost" title={`${tt('menu.edit.undo')} (Ctrl+Z)`} disabled={!app.canUndo} onclick={undo}>↶</button>
      <button class="btn icon ghost" title={`${tt('menu.edit.redo')} (Ctrl+Y)`} disabled={!app.canRedo} onclick={redo}>↷</button>
      <button class="btn primary" title="Ctrl+Shift+E" onclick={() => (app.dialog = 'export')}>⤓ {tt('export.button')}</button>
    </div>
  </header>

  <main
    class="main"
    style:--left={app.settings.leftCollapsed ? '0px' : `${app.settings.leftWidth}px`}
    style:--right={app.settings.rightCollapsed ? '0px' : `${app.settings.rightWidth}px`}
  >
    <aside class="left" class:collapsed={app.settings.leftCollapsed}>
      {#if !app.settings.leftCollapsed}
        <LayerPanel />
      {/if}
    </aside>
    {#if !portrait}
      <div class="splitter" role="separator" aria-orientation="vertical" onpointerdown={(e) => resize(e, 'left')}>
        <button class="collapse" title={tt('layout.toggleLeft')} onclick={() => updateSettings((s) => (s.leftCollapsed = !s.leftCollapsed))}>
          {app.settings.leftCollapsed ? '›' : '‹'}
        </button>
      </div>
    {/if}
    <section class="center">
      <Viewport />
    </section>
    {#if !portrait}
      <div class="splitter" role="separator" aria-orientation="vertical" onpointerdown={(e) => resize(e, 'right')}>
        <button class="collapse" title={tt('layout.toggleRight')} onclick={() => updateSettings((s) => (s.rightCollapsed = !s.rightCollapsed))}>
          {app.settings.rightCollapsed ? '‹' : '›'}
        </button>
      </div>
    {/if}
    <aside class="right" class:collapsed={app.settings.rightCollapsed && !portrait}>
      {#if !app.settings.rightCollapsed || portrait}
        <Inspector />
      {/if}
    </aside>
  </main>

  <StatusBar />
</div>

{#if app.dialog === 'export'}<ExportDialog />{/if}
{#if app.dialog === 'settings'}<SettingsDialog />{/if}
{#if app.dialog === 'about'}<AboutDialog />{/if}
{#if app.dialog === 'warnings'}<WarningsDialog />{/if}
{#if app.dialog === 'palette'}<CommandPalette />{/if}
{#if app.confirm}<ConfirmDialog />{/if}
<Toasts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .title {
    flex: 1;
    text-align: center;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--left) 6px 1fr 6px var(--right);
  }
  .left,
  .right {
    background: var(--panel);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .center {
    min-width: 0;
    min-height: 0;
  }
  .splitter {
    position: relative;
    background: var(--bg);
    cursor: col-resize;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    touch-action: none;
  }
  .splitter:hover {
    background: var(--accent-soft);
  }
  .collapse {
    position: absolute;
    top: 50%;
    left: -5px;
    width: 14px;
    height: 36px;
    margin-top: -18px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel-2);
    color: var(--text-3);
    cursor: pointer;
    z-index: 2;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .splitter:hover .collapse {
    opacity: 1;
  }
  /* portrait / narrow window: inspector goes under the viewport */
  .portrait .main {
    grid-template-columns: minmax(200px, 38%) 1fr;
    grid-template-rows: 1fr minmax(220px, 42%);
  }
  .portrait .left {
    grid-row: 1 / 3;
    border-right: 1px solid var(--border);
  }
  .portrait .center {
    grid-column: 2;
    grid-row: 1;
  }
  .portrait .right {
    grid-column: 2;
    grid-row: 2;
    border-top: 1px solid var(--border);
  }
</style>
