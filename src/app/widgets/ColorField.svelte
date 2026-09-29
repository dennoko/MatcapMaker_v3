<script lang="ts">
  import { rgbToHex, type RGB } from '$core/schema/params';
  import { rgbCss } from './color';
  import type { OnEdit } from './edit';
  import Popover from './Popover.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { app } from '../state.svelte';

  interface Props {
    value: RGB;
    defaultValue?: RGB;
    onedit: OnEdit<RGB>;
  }
  let { value, defaultValue, onedit }: Props = $props();

  let anchor = $state<HTMLButtonElement>();
  let open = $state(false);

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      e.stopPropagation();
      app.eyedropper = (rgb) => onedit(rgb, 'set');
    }
  }
</script>

<button
  bind:this={anchor}
  class="color"
  onclick={() => (open = !open)}
  ondblclick={() => defaultValue && onedit([...defaultValue] as RGB, 'set')}
  {onkeydown}
  title={rgbToHex(value)}
>
  <span class="sw checker"><span style:background={rgbCss(value)}></span></span>
  <span class="hex">{rgbToHex(value).toUpperCase()}</span>
</button>

{#if open && anchor}
  <Popover {anchor} placement="left" onclose={() => (open = false)}>
    <ColorPicker {value} {onedit} />
  </Popover>
{/if}

<style>
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: var(--row);
    padding: 0 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    background: var(--field);
    cursor: pointer;
  }
  .color:hover {
    border-color: var(--border-strong);
  }
  .sw {
    width: 36px;
    height: 18px;
    border-radius: 3px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .sw span {
    display: block;
    width: 100%;
    height: 100%;
  }
  .hex {
    font-family: var(--mono);
    font-size: 0.92em;
    color: var(--text-2);
  }
</style>
