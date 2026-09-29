<script lang="ts">
  // Tab: search & add layers (and a few commands) by name.
  import { onMount } from 'svelte';
  import { registry } from '$core/layers/registry';
  import { app } from '../state.svelte';
  import { tt, tLayer } from '../i18n.svelte';
  import { addLayer, groupSelected, quickExport } from '../actions';
  import { LAYER_PRESETS } from '../presets/builtin';
  import { applyLayerPreset, listUserPresets, type UserPreset } from '../presets/user';

  interface Entry {
    id: string;
    label: string;
    hint: string;
    icon: string;
    run: () => void;
  }

  let q = $state('');
  let active = $state(0);
  let input: HTMLInputElement;
  let userPresets = $state<UserPreset[]>([]);

  const entries = $derived.by<Entry[]>(() => {
    void app.pluginsLoaded;
    const layers: Entry[] = registry.all().map((d) => ({
      id: `layer:${d.type}`,
      label: tLayer(d.type),
      hint: d.plugin ? tt('palette.plugin') : tt(`category.${d.category}`),
      icon: d.icon,
      run: () => addLayer(d.type),
    }));
    const presets: Entry[] = LAYER_PRESETS.map((p) => ({
      id: `preset:${p.id}`,
      label: tt(`preset.layer.${p.id}`, undefined, p.name),
      hint: tt('palette.layerPreset'),
      icon: registry.get(p.type)?.icon ?? '•',
      run: () => addLayer(p.type, p.params, tt(`preset.layer.${p.id}`, undefined, p.name)),
    }));
    const cmds: Entry[] = [
      { id: 'cmd:group', label: tt('layers.group'), hint: tt('palette.command'), icon: '▤', run: groupSelected },
      { id: 'cmd:export', label: tt('menu.file.quickExport'), hint: tt('palette.command'), icon: '⤓', run: quickExport },
    ];
    const mine: Entry[] = userPresets.map((u) => ({
      id: `user:${u.path}`,
      label: u.name,
      hint: tt('presets.user'),
      icon: '★',
      run: () => applyLayerPreset(u.path),
    }));
    return [...layers, ...presets, ...mine, ...cmds];
  });

  const results = $derived.by(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries
      .map((e) => {
        const l = e.label.toLowerCase();
        const idx = l.indexOf(s);
        const score = idx === 0 ? 0 : idx > 0 ? 1 : e.id.toLowerCase().includes(s) || e.hint.toLowerCase().includes(s) ? 2 : -1;
        return { e, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.e);
  });

  $effect(() => {
    void q;
    active = 0;
  });

  onMount(() => {
    input.focus();
    listUserPresets().then((l) => (userPresets = l.filter((u) => u.kind === 'layer')));
  });

  function run(e: Entry | undefined) {
    if (!e) return;
    app.dialog = null;
    e.run();
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') app.dialog = null;
    else if (e.key === 'ArrowDown') active = Math.min(results.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') run(results[active]);
    else return;
    e.preventDefault();
  }
</script>

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (app.dialog = null)}>
  <div class="palette" role="dialog" aria-label={tt('palette.title')}>
    <input bind:this={input} class="q" placeholder={tt('palette.placeholder')} bind:value={q} {onkeydown} spellcheck="false" />
    <div class="list scroll" role="listbox">
      {#each results as r, i (r.id)}
        <button class="item" class:active={i === active} role="option" aria-selected={i === active} onpointerenter={() => (active = i)} onclick={() => run(r)}>
          <span class="ic">{r.icon}</span>
          <span class="lb">{r.label}</span>
          <span class="hint">{r.hint}</span>
        </button>
      {/each}
      {#if !results.length}<div class="none muted">{tt('palette.none')}</div>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 850;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    justify-content: center;
    padding-top: 12vh;
  }
  .palette {
    width: 460px;
    max-width: calc(100vw - 32px);
    height: fit-content;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: rise 0.12s var(--ease);
  }
  @keyframes rise {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
  }
  .q {
    width: 100%;
    height: 42px;
    padding: 0 14px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    outline: none;
    font-size: 1.1em;
    user-select: text;
  }
  .list {
    max-height: 360px;
    padding: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: none;
    border-radius: var(--radius-s);
    text-align: left;
    cursor: pointer;
  }
  .item.active {
    background: var(--accent);
    color: #fff;
  }
  .ic {
    width: 20px;
    text-align: center;
  }
  .lb {
    flex: 1;
  }
  .hint {
    font-size: 0.85em;
    opacity: 0.7;
  }
  .none {
    padding: 14px;
    text-align: center;
  }
</style>
