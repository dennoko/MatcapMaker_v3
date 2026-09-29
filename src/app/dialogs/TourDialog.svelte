<script lang="ts">
  // First-run 3-step tour (add layers → adjust with gizmos → export).
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { updateSettings } from '../actions';

  let step = $state(0);
  const STEPS = [
    { key: 'tour.step1', target: '.left' },
    { key: 'tour.step2', target: '.center' },
    { key: 'tour.step3', target: '.top .actions' },
  ];

  const rect = $derived.by(() => {
    const el = document.querySelector(STEPS[step].target);
    return el?.getBoundingClientRect() ?? null;
  });

  function finish() {
    updateSettings((s) => (s.tourDone = true));
    app.dialog = null;
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') finish();
    if (e.key === 'ArrowRight' || e.key === 'Enter') step < STEPS.length - 1 ? step++ : finish();
    if (e.key === 'ArrowLeft' && step > 0) step--;
  }
</script>

<svelte:window {onkeydown} />

<div class="tour" role="dialog" aria-label={tt('tour.title')}>
  {#if rect}
    <div class="spot" style:left={`${rect.left - 4}px`} style:top={`${rect.top - 4}px`} style:width={`${rect.width + 8}px`} style:height={`${rect.height + 8}px`}></div>
  {/if}
  <div class="card">
    <div class="muted small">{tt('tour.title')} · {step + 1}/{STEPS.length}</div>
    <h3>{tt(`${STEPS[step].key}.title`)}</h3>
    <p>{tt(`${STEPS[step].key}.body`)}</p>
    <div class="row">
      <button class="btn ghost" onclick={finish}>{tt('common.skip')}</button>
      <span class="dots">
        {#each STEPS as _, i}<span class:on={i === step}></span>{/each}
      </span>
      {#if step > 0}<button class="btn" onclick={() => step--}>{tt('common.back')}</button>{/if}
      {#if step < STEPS.length - 1}
        <button class="btn primary" onclick={() => step++}>{tt('common.next')}</button>
      {:else}
        <button class="btn primary" onclick={finish}>{tt('common.done')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 820;
  }
  .spot {
    position: fixed;
    border-radius: 8px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
    border: 2px solid var(--accent);
    pointer-events: none;
    transition: all 0.25s var(--ease);
  }
  .card {
    position: fixed;
    left: 50%;
    bottom: 64px;
    transform: translateX(-50%);
    width: 440px;
    max-width: calc(100vw - 32px);
    padding: 16px 18px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  h3 {
    margin: 6px 0;
  }
  p {
    line-height: 1.6;
    margin: 0 0 12px;
  }
  .small {
    font-size: 0.85em;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dots {
    flex: 1;
    display: flex;
    justify-content: center;
    gap: 5px;
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .dots span.on {
    background: var(--accent);
  }
</style>
