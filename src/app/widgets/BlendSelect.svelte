<script lang="ts">
  // Blend-mode dropdown. Hovering an item previews it live (not recorded in
  // history) until a choice is made.
  import { BLEND_MODES, type BlendMode } from '$core/model/types';
  import Popover from './Popover.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: BlendMode;
    layerId: string;
    onchange: (m: BlendMode) => void;
  }
  let { value, layerId, onchange }: Props = $props();

  let anchor = $state<HTMLButtonElement>();
  let open = $state(false);

  const GROUPS: BlendMode[][] = [
    ['normal'],
    ['darken', 'multiply', 'subtract'],
    ['lighten', 'screen', 'colorDodge', 'add'],
    ['overlay', 'softLight', 'hardLight'],
    ['difference'],
  ];

  function close() {
    open = false;
    app.blendHover = null;
  }

  function pick(m: BlendMode) {
    app.blendHover = null;
    open = false;
    if (m !== value) onchange(m);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = BLEND_MODES.indexOf(value);
    const next = BLEND_MODES[(i + (e.key === 'ArrowDown' ? 1 : -1) + BLEND_MODES.length) % BLEND_MODES.length];
    onchange(next);
  }
</script>

<button bind:this={anchor} class="field sel" onclick={() => (open ? close() : (open = true))} {onkeydown}>
  <span>{tt(`blend.${value}`)}</span>
  <span class="caret">▾</span>
</button>

{#if open && anchor}
  <Popover {anchor} onclose={close}>
    <div class="list" role="listbox" tabindex="-1" onpointerleave={() => (app.blendHover = null)}>
      {#each GROUPS as g, gi}
        {#if gi > 0}<div class="sep"></div>{/if}
        {#each g as m}
          <button
            class="opt"
            class:cur={m === value}
            role="option"
            aria-selected={m === value}
            onpointerenter={() => (app.blendHover = { layerId, mode: m })}
            onclick={() => pick(m)}
          >
            {tt(`blend.${m}`)}
          </button>
        {/each}
      {/each}
    </div>
  </Popover>
{/if}

<style>
  .sel {
    display: flex;
    align-items: center;
    width: 100%;
    cursor: pointer;
    text-align: left;
  }
  .sel span:first-child {
    flex: 1;
  }
  .caret {
    color: var(--text-3);
  }
  .list {
    display: flex;
    flex-direction: column;
    min-width: 170px;
    margin: -6px;
  }
  .opt {
    border: none;
    background: none;
    text-align: left;
    padding: 5px 10px;
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .opt:hover {
    background: var(--accent);
    color: #fff;
  }
  .opt.cur {
    font-weight: 600;
    color: var(--accent);
  }
  .opt.cur:hover {
    color: #fff;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 3px 4px;
  }
</style>
