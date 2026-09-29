<script lang="ts">
  import { app } from '../state.svelte';

  function dismiss(id: number) {
    app.toasts = app.toasts.filter((t) => t.id !== id);
  }
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <span class="text">{t.text}</span>
      {#if t.action}
        <button
          class="btn small"
          onclick={() => {
            t.action!.run();
            dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="x" onclick={() => dismiss(t.id)} aria-label="dismiss">✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 950;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 440px;
    padding: 8px 10px 8px 14px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    animation: slide 0.18s var(--ease);
  }
  .toast.success {
    border-left-color: var(--ok);
  }
  .toast.error {
    border-left-color: var(--danger);
  }
  @keyframes slide {
    from {
      transform: translateX(12px);
      opacity: 0;
    }
  }
  .text {
    line-height: 1.4;
    user-select: text;
  }
  .x {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-3);
  }
</style>
