<script lang="ts">
  import ContextMenu, { type MenuItem } from '../widgets/ContextMenu.svelte';
  import { app, platform } from '../state.svelte';
  import { changeLocale, tt } from '../i18n.svelte';
  import {
    addLayer,
    deleteSelected,
    duplicateSelected,
    groupSelected,
    newProject,
    openDialog,
    openPath,
    pasteFromClipboard,
    quickExport,
    redo,
    saveProject,
    undo,
    ungroupSelected,
    updateSettings,
  } from '../actions';
  import { basename } from '$platform/types';
  import { isGroup } from '$core/model/project';

  let open = $state<string | null>(null);
  let anchors: Record<string, HTMLButtonElement> = $state({});

  const menus = $derived<Record<string, MenuItem[]>>({
    file: [
      { label: tt('menu.file.new'), shortcut: 'Ctrl+N', action: () => newProject() },
      { label: tt('menu.file.newFromPreset'), action: () => (app.dialog = 'presets') },
      { label: tt('menu.file.open'), shortcut: 'Ctrl+O', action: openDialog },
      { separator: true },
      ...(app.settings.recentFiles.length
        ? [
            ...app.settings.recentFiles.slice(0, 8).map((p, i) => ({ label: `${i + 1}. ${basename(p)}`, action: () => openPath(p) })),
            { label: tt('menu.file.clearRecent'), action: () => updateSettings((s) => (s.recentFiles = [])) },
            { separator: true },
          ]
        : []),
      { label: tt('menu.file.save'), shortcut: 'Ctrl+S', action: () => saveProject() },
      { label: tt('menu.file.saveAs'), shortcut: 'Ctrl+Shift+S', action: () => saveProject(true) },
      { separator: true },
      { label: tt('menu.file.quickExport'), shortcut: 'Ctrl+E', action: quickExport },
      { label: tt('menu.file.export'), shortcut: 'Ctrl+Shift+E', action: () => (app.dialog = 'export') },
      ...(platform.kind === 'tauri'
        ? [{ separator: true }, { label: tt('menu.file.exit'), action: () => window.close() }]
        : []),
    ],
    edit: [
      { label: tt('menu.edit.undo'), shortcut: 'Ctrl+Z', action: undo, disabled: !app.canUndo },
      { label: tt('menu.edit.redo'), shortcut: 'Ctrl+Y', action: redo, disabled: !app.canRedo },
      { separator: true },
      { label: tt('layers.add'), shortcut: 'Tab', action: () => (app.dialog = 'palette') },
      { label: tt('layers.duplicate'), shortcut: 'Ctrl+D', action: duplicateSelected, disabled: !app.selection.length },
      { label: tt('layers.delete'), shortcut: 'Del', action: deleteSelected, disabled: !app.selection.length },
      { label: tt('layers.group'), shortcut: 'Ctrl+G', action: groupSelected, disabled: !app.selection.length },
      { label: tt('layers.ungroup'), shortcut: 'Ctrl+Shift+G', action: ungroupSelected, disabled: !app.primary || !isGroup(app.primary) },
      { separator: true },
      { label: tt('menu.edit.pasteImage'), shortcut: 'Ctrl+V', action: pasteFromClipboard },
      { label: tt('menu.edit.addImage'), action: () => addLayer('image') },
      { separator: true },
      { label: tt('menu.edit.settings'), shortcut: 'Ctrl+,', action: () => (app.dialog = 'settings') },
    ],
    view: [
      { label: tt('preview.shape.sphere'), shortcut: '1', checked: app.view.previewShape === 'sphere', action: () => (app.view.previewShape = 'sphere') },
      { label: tt('preview.shape.flat'), shortcut: '2', checked: app.view.previewShape === 'flat', action: () => (app.view.previewShape = 'flat') },
      { label: tt('preview.shape.normalMap'), shortcut: '3', checked: app.view.previewShape === 'normalMap', action: () => (app.view.previewShape = 'normalMap') },
      { label: tt('preview.shape.mesh'), checked: app.view.previewShape === 'mesh', action: () => ((app.view.previewShape = 'mesh'), (app.view.split = 'single')) },
      { separator: true },
      { label: tt('preview.split.single'), checked: app.view.split === 'single', action: () => (app.view.split = 'single') },
      {
        label: tt('preview.split.compare'),
        shortcut: '4',
        checked: app.view.split === 'compare',
        action: () => {
          if (app.view.previewShape === 'mesh') app.view.previewShape = 'sphere';
          app.view.split = app.view.split === 'compare' ? 'single' : 'compare';
        },
      },
      {
        label: tt('preview.split.beforeAfter'),
        shortcut: '\\',
        checked: app.view.split === 'beforeAfter',
        action: () => {
          if (app.view.previewShape === 'mesh') app.view.previewShape = 'sphere';
          app.view.split = app.view.split === 'beforeAfter' ? 'single' : 'beforeAfter';
        },
      },
      { label: tt('preview.gizmos'), shortcut: 'G', checked: app.view.showGizmos, action: () => (app.view.showGizmos = !app.view.showGizmos) },
      { separator: true },
      { label: tt('preview.zoomReset'), action: () => (app.view.zoom = 1) },
      { label: tt('menu.view.uiLarger'), shortcut: 'Ctrl++', action: () => updateSettings((s) => (s.uiScale = Math.min(2, +(s.uiScale + 0.1).toFixed(2)))) },
      { label: tt('menu.view.uiSmaller'), shortcut: 'Ctrl+-', action: () => updateSettings((s) => (s.uiScale = Math.max(0.6, +(s.uiScale - 0.1).toFixed(2)))) },
      { separator: true },
      { label: tt('settings.theme.dark'), checked: app.settings.theme === 'dark', action: () => updateSettings((s) => (s.theme = 'dark')) },
      { label: tt('settings.theme.light'), checked: app.settings.theme === 'light', action: () => updateSettings((s) => (s.theme = 'light')) },
      { separator: true },
      { label: '日本語', checked: app.settings.language === 'ja', action: () => (updateSettings((s) => (s.language = 'ja')), changeLocale('ja')) },
      { label: 'English', checked: app.settings.language === 'en', action: () => (updateSettings((s) => (s.language = 'en')), changeLocale('en')) },
    ],
    help: [
      { label: tt('menu.help.shortcuts'), shortcut: 'F1', action: () => (app.dialog = 'shortcuts') },
      { label: tt('menu.help.tour'), action: () => (app.dialog = 'tour') },
      { label: tt('menu.help.benchmark'), action: () => (app.dialog = 'benchmark') },
      ...(platform.kind === 'tauri'
        ? [{ label: tt('settings.openLogs'), action: async () => platform.reveal((await platform.paths()).logs) }]
        : []),
      { separator: true },
      { label: tt('menu.help.about'), action: () => (app.dialog = 'about') },
    ],
  });

  const TOP = ['file', 'edit', 'view', 'help'] as const;
</script>

<nav class="menubar">
  {#each TOP as m}
    <button
      bind:this={anchors[m]}
      class="top"
      class:open={open === m}
      onclick={() => (open = open === m ? null : m)}
      onpointerenter={() => open && (open = m)}
    >
      {tt(`menu.${m}`)}
    </button>
  {/each}
</nav>

{#if open && anchors[open]}
  {@const r = anchors[open].getBoundingClientRect()}
  {#key open}
    <ContextMenu x={r.left} y={r.bottom + 2} items={menus[open]} onclose={() => (open = null)} minWidth={230} />
  {/key}
{/if}

<style>
  .menubar {
    display: flex;
    gap: 2px;
  }
  .top {
    border: none;
    background: none;
    padding: 4px 10px;
    border-radius: var(--radius-s);
    cursor: pointer;
    color: var(--text-2);
  }
  .top:hover,
  .top.open {
    background: var(--panel-2);
    color: var(--text);
  }
</style>
