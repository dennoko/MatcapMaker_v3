<script lang="ts" module>
  export interface MenuItem {
    label?: string;
    action?: () => void;
    shortcut?: string;
    disabled?: boolean;
    checked?: boolean;
    separator?: boolean;
    danger?: boolean;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onclose: () => void;
    minWidth?: number;
  }
  let { x, y, items, onclose, minWidth = 180 }: Props = $props();

  let el: HTMLDivElement;
  let pos = $state({ left: 0, top: 0 });
  let active = $state(-1);

  onMount(() => {
    const r = el.getBoundingClientRect();
    pos = {
      left: Math.min(x, window.innerWidth - r.width - 4),
      top: Math.min(y, window.innerHeight - r.height - 4),
    };
    el.focus();
    const close = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) onclose();
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', close, true));
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close, true);
    };
  });

  function run(it: MenuItem) {
    if (it.disabled || it.separator) return;
    onclose();
    it.action?.();
  }

  function onkeydown(e: KeyboardEvent) {
    const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowDown') active = enabled[(enabled.indexOf(active) + 1) % enabled.length];
    else if (e.key === 'ArrowUp') active = enabled[(enabled.indexOf(active) - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Enter' && active >= 0) run(items[active]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div
  bind:this={el}
  class="menu"
  role="menu"
  tabindex="-1"
  style:left={`${pos.left}px`}
  style:top={`${pos.top}px`}
  style:min-width={`${minWidth}px`}
  {onkeydown}
>
  {#each items as it, i}
    {#if it.separator}
      <div class="sep"></div>
    {:else}
      <button
        class="item"
        class:active={i === active}
        class:danger={it.danger}
        role="menuitem"
        disabled={it.disabled}
        onpointerenter={() => (active = i)}
        onclick={() => run(it)}
      >
        <span class="check">{it.checked ? '✓' : ''}</span>
        <span class="lbl">{it.label}</span>
        {#if it.shortcut}<span class="sc">{it.shortcut}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 1000;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    outline: none;
    animation: pop 0.08s var(--ease);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 26px;
    padding: 0 10px 0 4px;
    border: none;
    background: none;
    border-radius: var(--radius-s);
    text-align: left;
    cursor: pointer;
    gap: 4px;
  }
  .item.active:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }
  .item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .item.danger:not(.active) {
    color: var(--danger);
  }
  .check {
    width: 16px;
    text-align: center;
  }
  .lbl {
    flex: 1;
    white-space: nowrap;
  }
  .sc {
    margin-left: 24px;
    color: var(--text-3);
    font-size: 0.9em;
  }
  .item.active .sc {
    color: rgba(255, 255, 255, 0.8);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
</style>
