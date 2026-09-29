<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    width?: number;
  }
  let { title, onclose, children, footer, width = 480 }: Props = $props();

  let box: HTMLDivElement;
  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.querySelector<HTMLElement>('input, select, button, [tabindex]:not([tabindex="-1"])');
    (first ?? box).focus();
    return () => prev?.focus?.();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
    if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = [...box.querySelectorAll<HTMLElement>('input, select, button, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (x) => !x.hasAttribute('disabled'),
      );
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        f[f.length - 1].focus();
        e.preventDefault();
      } else if (!e.shiftKey && i === f.length - 1) {
        f[0].focus();
        e.preventDefault();
      }
    }
    e.stopPropagation();
  }
</script>

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div bind:this={box} class="modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" style:width={`${width}px`} {onkeydown}>
    <div class="title">
      <span>{title}</span>
      <button class="btn icon ghost" onclick={onclose} aria-label="close">✕</button>
    </div>
    <div class="content scroll">
      {@render children()}
    </div>
    {#if footer}
      <div class="footer">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 800;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade 0.12s;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .modal {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
    outline: none;
    animation: rise 0.16s var(--ease);
  }
  @keyframes rise {
    from {
      transform: translateY(8px) scale(0.98);
      opacity: 0;
    }
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 6px 16px;
    font-weight: 600;
    font-size: 1.08em;
  }
  .content {
    padding: 6px 16px 14px;
    min-height: 0;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }
</style>
