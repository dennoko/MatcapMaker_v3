<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    children: Snippet;
    placement?: 'below' | 'left';
    /** keep open when clicking these elements */
    ignore?: HTMLElement[];
  }
  let { anchor, onclose, children, placement = 'below', ignore = [] }: Props = $props();

  let el: HTMLDivElement;
  let pos = $state({ left: -9999, top: -9999 });

  function place() {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let left: number;
    let top: number;
    if (placement === 'left') {
      left = a.left - r.width - 8;
      top = a.top;
      if (left < 4) left = a.right + 8;
    } else {
      left = a.left;
      top = a.bottom + 4;
      if (top + r.height > window.innerHeight - 4) top = a.top - r.height - 4;
    }
    pos = {
      left: Math.max(4, Math.min(left, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(top, window.innerHeight - r.height - 4)),
    };
  }

  onMount(() => {
    place();
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el.contains(t) || anchor.contains(t) || ignore.some((i) => i.contains(t))) return;
      onclose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      }
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', close, true));
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
    };
  });
</script>

<div bind:this={el} class="popover" style:left={`${pos.left}px`} style:top={`${pos.top}px`}>
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: 900;
    padding: 10px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
</style>
