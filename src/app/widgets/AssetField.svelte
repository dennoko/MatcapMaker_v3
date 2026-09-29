<script lang="ts">
  import { assets } from '../state.svelte';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: string | null;
    onpick: () => void;
    onclear?: () => void;
    placeholder?: string;
  }
  let { value, onpick, onclear, placeholder }: Props = $props();

  let url = $state<string | null>(null);
  const entry = $derived(value ? assets.get(value) : undefined);

  $effect(() => {
    const e = entry;
    if (!e || !e.meta.mime.startsWith('image/')) {
      url = null;
      return;
    }
    const u = URL.createObjectURL(new Blob([e.bytes as unknown as ArrayBuffer], { type: e.meta.mime }));
    url = u;
    return () => URL.revokeObjectURL(u);
  });
</script>

<div class="asset" data-drop-asset>
  <button class="thumb checker" onclick={onpick} title={tt('asset.choose')}>
    {#if url}<img src={url} alt="" />{:else}<span>＋</span>{/if}
  </button>
  <div class="info">
    <div class="name">{entry ? entry.meta.name : (placeholder ?? tt('asset.none'))}</div>
    {#if entry && entry.meta.width}<div class="muted dim">{entry.meta.width} × {entry.meta.height}</div>{/if}
  </div>
  <button class="btn small" onclick={onpick}>{tt('asset.choose')}</button>
  {#if entry && onclear}
    <button class="btn icon small ghost" onclick={onclear} title={tt('asset.clear')}>✕</button>
  {/if}
</div>

<style>
  .asset {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .thumb {
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb span {
    color: #fff;
    text-shadow: 0 0 3px #000;
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dim {
    font-size: 0.85em;
  }
</style>
