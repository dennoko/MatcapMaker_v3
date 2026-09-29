<script lang="ts">
  import { onMount } from 'svelte';
  import './styles.css';
  import { app, platform, toast } from './state.svelte';
  import { changeLocale, tt } from './i18n.svelte';
  import { confirmDiscard, handlePaste, loadSettings, openPath, redo, undo, updateSettings, updateTitle } from './actions';
  import { handleKeydown } from './shortcuts';
  import MenuBar from './layout/MenuBar.svelte';
  import StatusBar from './layout/StatusBar.svelte';
  import DevLogo from './widgets/DevLogo.svelte';
  import Toasts from './layout/Toasts.svelte';
  import LayerPanel from './panels/LayerPanel.svelte';
  import PresetStrip from './panels/PresetStrip.svelte';
  import Inspector from './panels/Inspector.svelte';
  import Viewport from './viewport/Viewport.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import SettingsDialog from './dialogs/SettingsDialog.svelte';
  import AboutDialog from './dialogs/AboutDialog.svelte';
  import ConfirmDialog from './dialogs/ConfirmDialog.svelte';
  import WarningsDialog from './dialogs/WarningsDialog.svelte';
  import CommandPalette from './dialogs/CommandPalette.svelte';
  import PresetGallery from './dialogs/PresetGallery.svelte';
  import SavePresetDialog from './dialogs/SavePresetDialog.svelte';
  import ShortcutsDialog from './dialogs/ShortcutsDialog.svelte';
  import RecoveryDialog from './dialogs/RecoveryDialog.svelte';
  import TourDialog from './dialogs/TourDialog.svelte';
  import BenchmarkDialog from './dialogs/BenchmarkDialog.svelte';
  import { checkRecovery, clearRecovery, startAutosave } from './recovery.svelte';
  import { dropHint, handleDrop, setDropHover } from './drop';
  import { checkForUpdates } from './updates';
  import { loadPlugins } from './plugins';
  import { basename } from '$platform/types';
  import { APP_VERSION } from '$core/model/project';

  let winW = $state(window.innerWidth);
  let winH = $state(window.innerHeight);
  const portrait = $derived(winH > winW * 1.05 || winW < 900);
  let recovery = $state<{ path: string; modified: number } | null>(null);

  onMount(() => {
    window.addEventListener('error', (e) => platform.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => platform.log('error', `unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`));
    const onResize = () => {
      winW = window.innerWidth;
      winH = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    (async () => {
      await platform.initialize((notice) => toast(tt(`platform.${notice}`), 'info', undefined, 12000));
      await loadSettings();
      changeLocale(app.settings.language);
      platform.onCloseRequested(async () => {
        if (!(await confirmDiscard())) return false;
        // clean exit: the autosave is no longer needed
        await clearRecovery();
        return true;
      });
      platform.onFileDrop((e) => handleDrop(e), setDropHover);
      await loadPlugins();
      const launch = await platform.launchFile().catch(() => null);
      recovery = await checkRecovery();
      if (launch) await openPath(launch);
      platform.onOpenFile((p) => openPath(p));
      startAutosave();
      updateTitle();
      if (!recovery && !app.settings.tourDone) app.dialog = 'tour';
      checkForUpdates();
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

<svelte:window onkeydown={handleKeydown} onpaste={handlePaste} />

<div class="app" class:portrait>
  <header class="top">
    <div class="lead">
      <MenuBar />
      <div class="title" title={app.filePath ?? ''}>
        {title}{#if app.dirty}<span class="dot" title={tt('status.unsaved')}> •</span>{/if}
      </div>
    </div>
    <div class="center-brand">
      <button class="brand" title={tt('menu.help.about')} onclick={() => (app.dialog = 'about')}><DevLogo height={20} /></button>
      <button
        class="ver-badge"
        class:has-update={!!app.updateAvailable}
        title={app.updateAvailable ? tt('status.update', { version: app.updateAvailable.version }) : `Matcap Maker v${APP_VERSION}`}
        onclick={() => {
          if (app.updateAvailable) {
            platform.openUrl(app.updateAvailable.url);
          } else {
            app.dialog = 'about';
          }
        }}
      >
        {#if app.updateAvailable}
          <span class="update-pulse"></span>
          <span class="update-text">v{APP_VERSION} → v{app.updateAvailable.version}</span>
          <span class="update-tag">{tt('status.updateBadge')}</span>
        {:else}
          <span class="ver-text">v{APP_VERSION}</span>
        {/if}
      </button>
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
        <PresetStrip />
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
{#if app.dialog === 'presets'}<PresetGallery />{/if}
{#if app.dialog === 'savePreset'}<SavePresetDialog />{/if}
{#if app.dialog === 'shortcuts'}<ShortcutsDialog />{/if}
{#if app.dialog === 'tour'}<TourDialog />{/if}
{#if app.dialog === 'benchmark'}<BenchmarkDialog />{/if}
{#if recovery}<RecoveryDialog info={recovery} ondone={() => (recovery = null)} />{/if}
{#if app.confirm}<ConfirmDialog />{/if}
{#if app.dropHover}
  <div class="drop-hint" style:left={`${app.dropHover.x}px`} style:top={`${app.dropHover.y}px`}>{dropHint(app.dropHover.x, app.dropHover.y)}</div>
{/if}
<Toasts />

<style>
  .drop-hint {
    position: fixed;
    z-index: 990;
    transform: translate(12px, 12px);
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    pointer-events: none;
    box-shadow: var(--shadow);
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  /* three columns: the logo sits at the exact center of the window */
  .top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .lead {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .center-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
  }
  .brand {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    border: none;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    opacity: 0.85;
    cursor: pointer;
  }
  .brand:hover {
    opacity: 1;
    background: var(--panel-2);
  }
  .ver-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 7px;
    border-radius: var(--radius-s);
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text-3);
    font-size: 0.8em;
    font-family: var(--mono);
    line-height: 1.35;
    cursor: pointer;
    transition: all 0.15s var(--ease);
  }
  .ver-badge:hover {
    color: var(--text);
    background: var(--field);
    border-color: var(--border-strong);
  }
  .ver-badge.has-update {
    background: rgba(0, 230, 118, 0.15);
    color: #00e676;
    border: 1px solid #00e676;
    box-shadow: 0 0 10px rgba(0, 230, 118, 0.35);
    font-weight: 700;
  }
  :root[data-theme='light'] .ver-badge.has-update {
    background: rgba(16, 185, 129, 0.15);
    color: #047857;
    border: 1px solid #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.25);
  }
  .ver-badge.has-update:hover {
    background: rgba(0, 230, 118, 0.25);
    box-shadow: 0 0 15px rgba(0, 230, 118, 0.55);
  }
  :root[data-theme='light'] .ver-badge.has-update:hover {
    background: rgba(16, 185, 129, 0.25);
  }
  .update-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
    animation: pulse-dot 1.8s infinite ease-in-out;
  }
  @keyframes pulse-dot {
    0%, 100% {
      transform: scale(0.9);
      opacity: 0.8;
    }
    50% {
      transform: scale(1.35);
      opacity: 1;
    }
  }
  .update-tag {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    background: currentColor;
    color: var(--bg);
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .title {
    min-width: 0;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    color: var(--accent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
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
