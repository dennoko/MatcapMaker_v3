<script lang="ts">
  import { registry } from '$core/layers/registry';
  import { findLayer, isGroup, walkLayers } from '$core/model/project';
  import { BLEND_SHORT, type LayerNode } from '$core/model/types';
  import { moveLayer, setLayerProp } from '$core/commands/layerCommands';
  import { app, select, store } from '../state.svelte';
  import { tt, tLayer } from '../i18n.svelte';
  import {
    deleteSelected,
    duplicateSelected,
    groupSelected,
    moveSelected,
    toggleSolo,
    toggleVisibility,
    ungroupSelected,
  } from '../actions';
  import ContextMenu, { type MenuItem } from '../widgets/ContextMenu.svelte';

  interface Row {
    node: LayerNode;
    depth: number;
    parentId: string | null;
    index: number;
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const hidden = new Set<string>();
    walkLayers(app.doc.layers, ({ node, depth, parentId, index }) => {
      if (parentId && hidden.has(parentId)) {
        hidden.add(node.id);
        return;
      }
      out.push({ node, depth, parentId, index });
      if (isGroup(node) && node.collapsed) hidden.add(node.id);
    });
    return out;
  });

  let renaming = $state<string | null>(null);
  let menu = $state<{ x: number; y: number } | null>(null);
  let listEl = $state<HTMLDivElement>();
  let drag = $state<{ id: string; y: number; target: { rowId: string; where: 'before' | 'after' | 'inside' } | null } | null>(null);

  function clickRow(e: MouseEvent, r: Row) {
    const id = r.node.id;
    if (e.ctrlKey || e.metaKey) {
      select(app.selection.includes(id) ? app.selection.filter((x) => x !== id) : [...app.selection, id]);
    } else if (e.shiftKey && app.selection.length) {
      const ids = rows.map((x) => x.node.id);
      const a = ids.indexOf(app.selection[app.selection.length - 1]);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      select(ids.slice(lo, hi + 1));
    } else {
      select([id]);
    }
  }

  function eye(e: MouseEvent, r: Row) {
    e.stopPropagation();
    if (e.altKey) {
      toggleSolo(r.node.id);
      return;
    }
    const ids = app.selection.includes(r.node.id) ? app.selection : [r.node.id];
    toggleVisibility(ids);
  }

  function rename(id: string, name: string) {
    renaming = null;
    const n = findLayer(app.doc.layers, id)?.node;
    if (n && name.trim() && name !== n.name) store.dispatch(setLayerProp([id], 'name', name.trim(), false));
  }

  function toggleCollapse(e: MouseEvent, node: LayerNode) {
    e.stopPropagation();
    store.dispatch(setLayerProp([node.id], 'collapsed', !node.collapsed, false));
  }

  // --- pointer-driven reordering -------------------------------------------

  function rowDown(e: PointerEvent, r: Row) {
    if (e.button !== 0 || renaming) return;
    const target = e.currentTarget as HTMLElement;
    const y0 = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - y0) < 5) return;
      if (!started) {
        started = true;
        target.setPointerCapture(ev.pointerId);
        if (!app.selection.includes(r.node.id)) select([r.node.id]);
      }
      drag = { id: r.node.id, y: ev.clientY, target: hitTest(ev.clientY, r.node.id) };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started && drag?.target) drop(drag.id, drag.target);
      drag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function hitTest(y: number, dragId: string): { rowId: string; where: 'before' | 'after' | 'inside' } | null {
    if (!listEl) return null;
    const els = [...listEl.querySelectorAll<HTMLElement>('[data-row]')];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;
      const id = el.dataset.row!;
      if (id === dragId) return null;
      const node = findLayer(app.doc.layers, id)?.node;
      const f = (y - rect.top) / rect.height;
      if (node && isGroup(node) && f > 0.3 && f < 0.7) return { rowId: id, where: 'inside' };
      return { rowId: id, where: f < 0.5 ? 'before' : 'after' };
    }
    const last = els[els.length - 1];
    if (last && y > last.getBoundingClientRect().bottom) return { rowId: last.dataset.row!, where: 'after' };
    return null;
  }

  function drop(id: string, t: { rowId: string; where: 'before' | 'after' | 'inside' }) {
    const target = findLayer(app.doc.layers, t.rowId);
    const src = findLayer(app.doc.layers, id);
    if (!target || !src) return;
    let parentId: string | null;
    let index: number;
    if (t.where === 'inside') {
      parentId = t.rowId;
      index = 0;
    } else {
      parentId = target.parentId;
      index = target.index + (t.where === 'after' ? 1 : 0);
      if (src.parentId === parentId && src.index < index) index--;
    }
    if (parentId === src.parentId && index === src.index) return;
    store.dispatch(moveLayer(id, parentId, index));
  }

  const menuItems = $derived<MenuItem[]>([
    { label: tt('layers.rename'), action: () => (renaming = app.selection[app.selection.length - 1] ?? null), disabled: !app.selection.length },
    { label: tt('layers.duplicate'), action: duplicateSelected, shortcut: 'Ctrl+D', disabled: !app.selection.length },
    { label: tt('layers.delete'), action: deleteSelected, shortcut: 'Del', disabled: !app.selection.length, danger: true },
    { separator: true },
    { label: tt('layers.toggle'), action: () => toggleVisibility(), shortcut: 'H', disabled: !app.selection.length },
    { label: tt('layers.solo'), action: () => app.primary && toggleSolo(app.primary.id), shortcut: 'Alt+Click', disabled: !app.selection.length, checked: !!app.primary && app.solo.includes(app.primary.id) },
    { separator: true },
    { label: tt('layers.moveUp'), action: () => moveSelected(-1), shortcut: 'Ctrl+↑' },
    { label: tt('layers.moveDown'), action: () => moveSelected(1), shortcut: 'Ctrl+↓' },
    { separator: true },
    { label: tt('layers.group'), action: groupSelected, shortcut: 'Ctrl+G', disabled: !app.selection.length },
    { label: tt('layers.ungroup'), action: ungroupSelected, shortcut: 'Ctrl+Shift+G', disabled: !app.primary || !isGroup(app.primary) },
    { separator: true },
    { label: tt('layers.savePreset'), action: () => (app.dialog = 'savePreset'), disabled: !app.primary },
  ]);
</script>

<div class="panel">
  <div class="head">
    <span class="section-title">{tt('layers.title')}</span>
    <button class="btn icon ghost add" title={`${tt('layers.add')} (Tab)`} onclick={() => (app.dialog = 'palette')}>＋</button>
  </div>

  <div
    class="list scroll"
    bind:this={listEl}
    role="tree"
    tabindex="-1"
    oncontextmenu={(e) => {
      e.preventDefault();
      menu = { x: e.clientX, y: e.clientY };
    }}
  >
    {#each rows as r (r.node.id)}
      {@const n = r.node}
      {@const def = registry.get(n.type)}
      {@const sel = app.selection.includes(n.id)}
      {@const soloOut = app.solo.length > 0 && !app.solo.includes(n.id) && !isGroup(n)}
      <div
        class="row"
        class:sel
        class:primary={app.selection[app.selection.length - 1] === n.id}
        class:off={!n.enabled || soloOut}
        class:drop-before={drag?.target?.rowId === n.id && drag.target.where === 'before'}
        class:drop-after={drag?.target?.rowId === n.id && drag.target.where === 'after'}
        class:drop-inside={drag?.target?.rowId === n.id && drag.target.where === 'inside'}
        class:dragging={drag?.id === n.id}
        data-row={n.id}
        role="treeitem"
        aria-selected={sel}
        tabindex="-1"
        style:padding-left={`${6 + r.depth * 16}px`}
        onpointerdown={(e) => rowDown(e, r)}
        onclick={(e) => clickRow(e, r)}
        onkeydown={(e) => e.key === 'Enter' && select([n.id])}
        oncontextmenu={() => {
          if (!sel) select([n.id]);
        }}
        ondblclick={() => (renaming = n.id)}
      >
        {#if isGroup(n)}
          <button class="twisty" onclick={(e) => toggleCollapse(e, n)} aria-label="collapse">{n.collapsed ? '▸' : '▾'}</button>
        {/if}
        <div class="thumb checker" title={tLayer(n.type)}>
          {#if app.thumbs[n.id]}
            <img src={app.thumbs[n.id]} alt="" />
          {:else}
            <span class="icon">{isGroup(n) ? '▤' : (def?.icon ?? '?')}</span>
          {/if}
        </div>
        <button class="eye" class:solo={app.solo.includes(n.id)} onclick={(e) => eye(e, r)} title={tt('layers.eyeHint')} aria-label="visibility">
          {app.solo.includes(n.id) ? '◉' : n.enabled ? '●' : '○'}
        </button>
        <div class="name">
          {#if renaming === n.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="field"
              value={n.name}
              autofocus
              onblur={(e) => rename(n.id, (e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') rename(n.id, (e.currentTarget as HTMLInputElement).value);
                if (e.key === 'Escape') renaming = null;
              }}
              onclick={(e) => e.stopPropagation()}
              onpointerdown={(e) => e.stopPropagation()}
            />
          {:else}
            <span class="label">{n.name}</span>
            {#if app.shaderErrors[n.type]}<span class="badge" title={app.shaderErrors[n.type]}>⚠</span>{/if}
            {#if n.mask?.enabled}<span class="tag" title={tt('mask.title')}>M</span>{/if}
          {/if}
        </div>
        <span class="blend" title={tt(`blend.${n.blendMode}`)}>{BLEND_SHORT[n.blendMode]}</span>
        <div class="opa" title={`${Math.round(n.opacity * 100)}%`}><div style:width={`${n.opacity * 100}%`}></div></div>
      </div>
    {/each}
    {#if !rows.length}
      <div class="empty muted">{tt('layers.empty')}</div>
    {/if}
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 6px 12px;
  }
  .add {
    font-size: 1.2em;
  }
  .list {
    flex: 1;
    min-height: 80px;
    padding: 0 6px 8px;
    outline: none;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding-right: 8px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    cursor: default;
    touch-action: none;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.sel {
    background: var(--accent-soft);
  }
  .row.primary {
    border-color: var(--accent);
  }
  .row.off .thumb,
  .row.off .label {
    opacity: 0.4;
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
  }
  .row.drop-before::before {
    top: -2px;
  }
  .row.drop-after::after {
    bottom: -2px;
  }
  .row.drop-inside {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .twisty {
    border: none;
    background: none;
    width: 14px;
    padding: 0;
    cursor: pointer;
    color: var(--text-2);
  }
  .thumb {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
  }
  .thumb img {
    width: 100%;
    height: 100%;
  }
  .icon {
    font-size: 1.1em;
    color: #fff;
    text-shadow: 0 0 3px #000;
  }
  .eye {
    border: none;
    background: none;
    width: 20px;
    padding: 0;
    cursor: pointer;
    color: var(--text-2);
  }
  .eye.solo {
    color: var(--warn);
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name input {
    width: 100%;
    user-select: text;
  }
  .badge {
    color: var(--danger);
  }
  .tag {
    font-size: 0.75em;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--panel-2);
    color: var(--text-2);
    border: 1px solid var(--border);
  }
  .blend {
    font-size: 0.8em;
    color: var(--text-3);
    width: 26px;
    text-align: right;
  }
  .opa {
    width: 26px;
    height: 4px;
    border-radius: 2px;
    background: var(--field);
    overflow: hidden;
  }
  .opa div {
    height: 100%;
    background: var(--text-3);
  }
  .empty {
    padding: 20px;
    text-align: center;
  }
</style>
