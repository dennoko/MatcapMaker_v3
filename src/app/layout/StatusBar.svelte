<script lang="ts">
  import { app, platform, store } from '../state.svelte';
  import { tt } from '../i18n.svelte';

  const history = $derived.by(() => {
    void app.historyVersion;
    const { past, future } = store.entries();
    return { past: past.slice(-6), offset: Math.max(0, past.length - 6), total: past.length, future: future.slice(0, 2) };
  });

  function label(e: { label: string; labelArgs?: Record<string, string | number> }) {
    return tt(e.label, e.labelArgs);
  }
</script>

<footer class="status">
  <div class="history">
    <span class="muted">{tt('status.history')}:</span>
    <button class="step" class:cur={history.total === 0} onclick={() => store.jumpTo(-1)}>{tt('history.open')}</button>
    {#if history.offset > 0}<span class="muted">…</span>{/if}
    {#each history.past as e, i}
      <span class="arrow">›</span>
      <button class="step" class:cur={history.offset + i === history.total - 1} onclick={() => store.jumpTo(history.offset + i)}>{label(e)}</button>
    {/each}
    {#each history.future as e, i}
      <span class="arrow muted">›</span>
      <button class="step future" onclick={() => store.jumpTo(history.total + i)}>{label(e)}</button>
    {/each}
  </div>
  {#if app.busy}
    <span class="busy"><span class="spin"></span>{app.busy}</span>
  {/if}
  {#if app.solo.length}
    <button class="step solo" onclick={() => (app.solo = [])}>{tt('status.solo')} ✕</button>
  {/if}
  {#if app.updateAvailable}
    <button class="step update" onclick={() => app.updateAvailable && platform.openUrl(app.updateAvailable.url)}>{tt('status.update', { version: app.updateAvailable.version })}</button>
  {/if}
  <span class="frame">
    {#if app.frame}
      {app.frame.resolution}px · {app.frame.ms.toFixed(1)}ms
      {#if app.settings.debugOverlay}
        · {app.frame.passes} {tt('status.passes')} · {app.frame.reused} {tt('status.cached')} · {((app.renderer?.memoryBytes ?? 0) / 1048576).toFixed(0)}MB
      {/if}
    {/if}
  </span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 26px;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    font-size: 0.9em;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
  }
  .history {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
  }
  .step {
    border: none;
    background: none;
    padding: 1px 5px;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .step:hover {
    background: var(--panel-2);
  }
  .step.cur {
    color: var(--text);
    background: var(--accent-soft);
  }
  .step.future {
    color: var(--text-3);
    font-style: italic;
  }
  .step.solo {
    color: var(--warn);
  }
  .step.update {
    color: var(--ok);
  }
  .arrow {
    color: var(--text-3);
  }
  .frame {
    font-variant-numeric: tabular-nums;
    color: var(--text-3);
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
  }
  .spin {
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
