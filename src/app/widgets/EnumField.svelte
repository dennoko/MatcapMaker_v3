<script lang="ts">
  import type { OnEdit } from './edit';

  interface Props {
    value: string;
    options: readonly string[];
    label: (o: string) => string;
    onedit: OnEdit<string>;
  }
  let { value, options, label, onedit }: Props = $props();
</script>

{#if options.length <= 3}
  <div class="seg" role="radiogroup">
    {#each options as o}
      <button class:on={o === value} role="radio" aria-checked={o === value} onclick={() => o !== value && onedit(o, 'set')}>
        {label(o)}
      </button>
    {/each}
  </div>
{:else}
  <select class="field" {value} onchange={(e) => onedit((e.currentTarget as HTMLSelectElement).value, 'set')}>
    {#each options as o}
      <option value={o}>{label(o)}</option>
    {/each}
  </select>
{/if}

<style>
  .seg {
    display: flex;
    height: var(--row);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--field);
  }
  .seg button {
    flex: 1;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-2);
    border-right: 1px solid var(--border);
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seg button:last-child {
    border-right: none;
  }
  .seg button.on {
    background: var(--accent);
    color: #fff;
  }
  select {
    width: 100%;
  }
</style>
