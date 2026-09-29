<script lang="ts">
  import Modal from './Modal.svelte';
  import { app, platform } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { runBenchmark, type BenchResult } from '../bench';
  import { joinPath } from '$platform/types';

  let results = $state<BenchResult[]>([]);
  let running = $state(false);
  let writeFile = $state(platform.kind === 'tauri');

  async function run() {
    const r = app.renderer;
    if (!r) return;
    running = true;
    results = [];
    await new Promise((res) => setTimeout(res, 30));
    try {
      const path = writeFile && platform.kind === 'tauri' ? joinPath((await platform.paths()).output, 'benchmark_4096.png') : null;
      results = await runBenchmark(r, platform, path);
      platform.log('info', `benchmark ${JSON.stringify(results)}`);
    } finally {
      running = false;
      app.redraw++;
    }
  }
</script>

<Modal title={tt('bench.title')} onclose={() => (app.dialog = null)} width={560}>
  <p class="muted">{tt('bench.intro')}</p>
  {#if platform.kind === 'tauri'}
    <label class="chk"><input type="checkbox" bind:checked={writeFile} /> {tt('bench.writeFile')}</label>
  {/if}
  {#if results.length}
    <table>
      <tbody>
        {#each results as r}
          <tr class:bad={r.target !== undefined && r.value > r.target}>
            <td>{r.name}</td>
            <td class="num">{r.value.toFixed(1)} {r.unit}</td>
            <td class="muted num">{r.target !== undefined ? `${tt('bench.target')} ≤ ${r.target} ${r.unit}` : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#snippet footer()}
    <button class="btn" onclick={() => (app.dialog = null)}>{tt('common.close')}</button>
    <button class="btn primary" disabled={running} onclick={run}>{running ? tt('bench.running') : tt('bench.run')}</button>
  {/snippet}
</Modal>

<style>
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    user-select: text;
  }
  td {
    padding: 4px;
    border-bottom: 1px solid var(--border);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  tr.bad td:nth-child(2) {
    color: var(--warn);
  }
</style>
