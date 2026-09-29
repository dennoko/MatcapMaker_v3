<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToRgb, rgbToHex, type RGB } from '$core/schema/params';
  import { hsvToRgb, rgbCss, rgbToHsv } from './color';
  import type { OnEdit } from './edit';
  import { app } from '../state.svelte';
  import { updateSettings } from '../actions';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: RGB;
    onedit: OnEdit<RGB>;
  }
  let { value, onedit }: Props = $props();

  let hsv = $state<[number, number, number]>(untrack(() => rgbToHsv(value)));
  let lastEmitted: string = untrack(() => rgbToHex(value));
  let hexText = $state(untrack(() => rgbToHex(value)));

  // follow external changes without losing hue at zero saturation
  $effect(() => {
    const hex = rgbToHex(value);
    if (hex !== lastEmitted) {
      const n = rgbToHsv(value);
      hsv = n[1] === 0 || n[2] === 0 ? [hsv[0], n[1], n[2]] : n;
      lastEmitted = hex;
    }
    hexText = hex;
  });

  function emit(next: [number, number, number], phase: 'begin' | 'update' | 'end' | 'set') {
    hsv = next;
    const rgb = hsvToRgb(next);
    lastEmitted = rgbToHex(rgb);
    onedit(rgb, phase);
  }

  function remember() {
    const hex = rgbToHex(value);
    updateSettings((s) => {
      s.recentColors = [hex, ...s.recentColors.filter((c) => c !== hex)].slice(0, 12);
    });
  }

  function dragArea(e: PointerEvent, kind: 'sv' | 'hue') {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const apply = (ev: PointerEvent, phase: 'begin' | 'update') => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      if (kind === 'sv') emit([hsv[0], x, 1 - y], phase);
      else emit([y, hsv[1], hsv[2]], phase);
    };
    apply(e, 'begin');
    const move = (ev: PointerEvent) => apply(ev, 'update');
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onedit(hsvToRgb(hsv), 'end');
      remember();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function setHex() {
    if (/^#?[0-9a-f]{6}$/i.test(hexText.trim()) || /^#?[0-9a-f]{3}$/i.test(hexText.trim())) {
      const rgb = hexToRgb(hexText.trim());
      hsv = rgbToHsv(rgb);
      lastEmitted = rgbToHex(rgb);
      onedit(rgb, 'set');
      remember();
    } else hexText = rgbToHex(value);
  }

  function setChannel(i: number, v: number) {
    const rgb = [...value] as RGB;
    rgb[i] = Math.min(255, Math.max(0, Math.round(v))) / 255;
    hsv = rgbToHsv(rgb);
    lastEmitted = rgbToHex(rgb);
    onedit(rgb, 'set');
  }

  function setHsvChannel(i: number, v: number) {
    const n = [...hsv] as [number, number, number];
    n[i] = i === 0 ? (((v % 360) + 360) % 360) / 360 : Math.min(100, Math.max(0, v)) / 100;
    emit(n, 'set');
  }

  function eyedrop() {
    app.eyedropper = (rgb) => {
      hsv = rgbToHsv(rgb);
      lastEmitted = rgbToHex(rgb);
      onedit(rgb, 'set');
      remember();
    };
  }
</script>

<div class="picker">
  <div
    class="sv"
    style:background-color={rgbCss(hsvToRgb([hsv[0], 1, 1]))}
    onpointerdown={(e) => dragArea(e, 'sv')}
    role="presentation"
  >
    <div class="sv-white"></div>
    <div class="sv-black"></div>
    <div class="knob" style:left={`${hsv[1] * 100}%`} style:top={`${(1 - hsv[2]) * 100}%`}></div>
  </div>
  <div class="hue" onpointerdown={(e) => dragArea(e, 'hue')} role="presentation">
    <div class="hknob" style:top={`${hsv[0] * 100}%`}></div>
  </div>
</div>

<div class="row">
  <div class="swatch checker"><div style:background={rgbCss(value)}></div></div>
  <input class="field hex" bind:value={hexText} onchange={setHex} onkeydown={(e) => e.key === 'Enter' && setHex()} spellcheck="false" />
  <button class="btn icon" title={tt('color.eyedropper') + ' (I)'} onclick={eyedrop} class:on={!!app.eyedropper}>⌖</button>
</div>

<div class="nums">
  {#each ['R', 'G', 'B'] as ch, i}
    <label>
      <span>{ch}</span>
      <input
        class="field"
        type="number"
        min="0"
        max="255"
        value={Math.round(value[i] * 255)}
        onchange={(e) => setChannel(i, +(e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  {/each}
</div>
<div class="nums">
  {#each ['H', 'S', 'V'] as ch, i}
    <label>
      <span>{ch}</span>
      <input
        class="field"
        type="number"
        min="0"
        max={i === 0 ? 360 : 100}
        value={Math.round(hsv[i] * (i === 0 ? 360 : 100))}
        onchange={(e) => setHsvChannel(i, +(e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  {/each}
</div>

{#if app.settings.recentColors.length}
  <div class="recent">
    {#each app.settings.recentColors as c}
      <button
        class="chip"
        title={c}
        style:background={c}
        onclick={() => {
          const rgb = hexToRgb(c);
          hsv = rgbToHsv(rgb);
          lastEmitted = c;
          onedit(rgb, 'set');
        }}
        aria-label={c}
      ></button>
    {/each}
  </div>
{/if}

<style>
  .picker {
    display: flex;
    gap: 8px;
    width: 220px;
  }
  .sv {
    position: relative;
    flex: 1;
    height: 150px;
    border-radius: var(--radius-s);
    cursor: crosshair;
    touch-action: none;
  }
  .sv-white,
  .sv-black {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .sv-white {
    background: linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
  }
  .sv-black {
    background: linear-gradient(to top, #000, rgba(0, 0, 0, 0));
  }
  .knob {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .hue {
    position: relative;
    width: 16px;
    border-radius: var(--radius-s);
    background: linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    cursor: ns-resize;
    touch-action: none;
  }
  .hknob {
    position: absolute;
    left: -2px;
    right: -2px;
    height: 6px;
    margin-top: -3px;
    border: 2px solid #fff;
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    align-items: center;
  }
  .swatch {
    width: 28px;
    height: 26px;
    border-radius: var(--radius-s);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .swatch div {
    width: 100%;
    height: 100%;
  }
  .hex {
    flex: 1;
    width: 0;
    font-family: var(--mono);
    user-select: text;
  }
  .btn.on {
    background: var(--accent);
    color: #fff;
  }
  .nums {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: 6px;
  }
  .nums label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .nums span {
    width: 10px;
    color: var(--text-3);
    font-size: 0.9em;
  }
  .nums input {
    width: 100%;
    padding: 0 4px;
    user-select: text;
  }
  .recent {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 3px;
    margin-top: 8px;
  }
  .chip {
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
  }
</style>
