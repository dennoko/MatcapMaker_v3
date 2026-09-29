<script lang="ts">
  import type { GradientValue, RGB } from '$core/schema/params';
  import { gradientCssSampled, rgbCss, sampleGradient } from './color';
  import type { OnEdit, Phase } from './edit';
  import ColorField from './ColorField.svelte';
  import ScrubNumber from './ScrubNumber.svelte';
  import Popover from './Popover.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: GradientValue;
    maxStops: number;
    defaultValue: GradientValue;
    onedit: OnEdit<GradientValue>;
  }
  let { value, maxStops, defaultValue, onedit }: Props = $props();

  let selected = $state(0);
  let band = $state<HTMLDivElement>();
  let pinPopover = $state<{ el: HTMLElement; index: number } | null>(null);
  const sel = $derived(value.stops[Math.min(selected, value.stops.length - 1)]);

  function clone(): GradientValue {
    return { stops: value.stops.map((s) => ({ pos: s.pos, color: [...s.color] as RGB })), interp: value.interp };
  }

  function update(mut: (g: GradientValue) => void, phase: Phase) {
    const g = clone();
    mut(g);
    onedit(g, phase);
  }

  function tAt(clientX: number) {
    const r = band!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  }

  function addAt(e: PointerEvent) {
    if (value.stops.length >= maxStops) return;
    const t = tAt(e.clientX);
    const color = sampleGradient(value.stops, value.interp, t);
    update((g) => g.stops.push({ pos: +t.toFixed(4), color }), 'set');
    selected = value.stops.length; // new stop is last (value updates after emit)
  }

  function dragPin(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selected = index;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 2) return;
      if (!moved) {
        moved = true;
        onedit(value, 'begin');
      }
      const t = tAt(ev.clientX);
      update((g) => (g.stops[index].pos = +t.toFixed(4)), 'update');
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (moved) onedit(value, 'end');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  function remove(index = selected) {
    if (value.stops.length <= 2) return;
    update((g) => g.stops.splice(index, 1), 'set');
    selected = Math.max(0, index - 1);
  }

  function reverse() {
    update((g) => {
      for (const s of g.stops) s.pos = +(1 - s.pos).toFixed(4);
    }, 'set');
  }

  function distribute() {
    update((g) => {
      const order = g.stops.map((s, i) => ({ s, i })).sort((a, b) => a.s.pos - b.s.pos);
      order.forEach((o, k) => (o.s.pos = +(k / (order.length - 1)).toFixed(4)));
    }, 'set');
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      remove();
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="grad" role="group" tabindex="-1" {onkeydown}>
  <div class="band-wrap checker">
    <div
      bind:this={band}
      class="band"
      style:background={gradientCssSampled(value.stops, value.interp)}
      onpointerdown={addAt}
      title={tt('gradient.hint')}
      role="presentation"
    ></div>
  </div>
  <div class="pins">
    {#each value.stops as s, i}
      <button
        class="pin"
        class:sel={i === selected}
        style:left={`${s.pos * 100}%`}
        onpointerdown={(e) => dragPin(e, i)}
        ondblclick={(e) => (pinPopover = { el: e.currentTarget as HTMLElement, index: i })}
        aria-label={`stop ${i + 1}`}
      >
        <span style:background={rgbCss(s.color)}></span>
      </button>
    {/each}
  </div>

  {#if sel}
    <div class="stop-row">
      <div class="color"><ColorField value={sel.color} onedit={(c, ph) => update((g) => (g.stops[selected].color = c), ph)} /></div>
      <div class="pos">
        <ScrubNumber
          value={sel.pos}
          min={0}
          max={1}
          step={0.001}
          label={tt('gradient.position')}
          onedit={(v, ph) => update((g) => (g.stops[selected].pos = v), ph)}
        />
      </div>
      <button class="btn icon" title={tt('gradient.removeStop')} disabled={value.stops.length <= 2} onclick={() => remove()}>✕</button>
    </div>
  {/if}

  <div class="tools">
    <select
      class="field"
      value={value.interp}
      onchange={(e) => update((g) => (g.interp = (e.currentTarget as HTMLSelectElement).value as GradientValue['interp']), 'set')}
      title={tt('gradient.interp')}
    >
      <option value="rgb">RGB</option>
      <option value="oklab">OKLab</option>
    </select>
    <button class="btn small" onclick={reverse} title={tt('gradient.reverse')}>⇄ {tt('gradient.reverse')}</button>
    <button class="btn small" onclick={distribute} title={tt('gradient.distribute')}>⋯ {tt('gradient.distribute')}</button>
    <button class="btn small ghost" onclick={() => onedit(structuredClone($state.snapshot(defaultValue)) as GradientValue, 'set')} title={tt('menu.resetDefault')}>↺</button>
  </div>
  <div class="hint muted">{tt('gradient.hint')}</div>
</div>

{#if pinPopover}
  <Popover anchor={pinPopover.el} placement="left" onclose={() => (pinPopover = null)}>
    <ColorPicker
      value={value.stops[pinPopover.index]?.color ?? [0, 0, 0]}
      onedit={(c, ph) => update((g) => (g.stops[pinPopover!.index].color = c), ph)}
    />
  </Popover>
{/if}

<style>
  .grad {
    display: flex;
    flex-direction: column;
    gap: 6px;
    outline: none;
  }
  .band-wrap {
    height: 26px;
    border-radius: var(--radius-s);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .band {
    height: 100%;
    cursor: copy;
  }
  .pins {
    position: relative;
    height: 16px;
    margin: -4px 7px 0;
  }
  .pin {
    position: absolute;
    top: 0;
    width: 14px;
    height: 16px;
    margin-left: -7px;
    padding: 2px;
    border: 1px solid var(--border-strong);
    border-radius: 3px 3px 5px 5px;
    background: var(--panel-2);
    cursor: ew-resize;
    touch-action: none;
  }
  .pin span {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 2px;
  }
  .pin.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .stop-row {
    display: flex;
    gap: 6px;
  }
  .stop-row .color {
    flex: 1;
    min-width: 0;
  }
  .stop-row .pos {
    width: 110px;
  }
  .tools {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .tools select {
    width: 80px;
  }
  .hint {
    font-size: 0.85em;
  }
</style>
