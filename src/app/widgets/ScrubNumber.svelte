<script lang="ts">
  import { clamp, decimalsFor, evalNumber, formatNum, type OnEdit } from './edit';
  import { tt } from '../i18n.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';

  interface Props {
    value: number;
    min: number;
    max: number;
    softMin?: number;
    softMax?: number;
    step?: number;
    label?: string;
    unit?: string;
    integer?: boolean;
    defaultValue?: number;
    /** show the slider fill */
    bar?: boolean;
    disabled?: boolean;
    onedit: OnEdit<number>;
  }

  let {
    value,
    min,
    max,
    softMin,
    softMax,
    step,
    label,
    unit = '',
    integer = false,
    defaultValue,
    bar = true,
    disabled = false,
    onedit,
  }: Props = $props();

  const lo = $derived(softMin ?? min);
  const hi = $derived(softMax ?? max);
  const decimals = $derived(integer ? 0 : decimalsFor(hi - lo, step));
  const fill = $derived(clamp((value - lo) / (hi - lo || 1), 0, 1));

  let el: HTMLDivElement;
  let editing = $state(false);
  let text = $state('');
  let input = $state<HTMLInputElement>();
  let menu = $state<{ x: number; y: number } | null>(null);

  let drag: { x0: number; v0: number; moved: boolean; id: number } | null = null;

  function quantize(v: number) {
    v = clamp(v, min, max);
    if (integer) v = Math.round(v);
    else if (step) v = Math.round(v / step) * step;
    return +v.toFixed(6);
  }

  function onpointerdown(e: PointerEvent) {
    if (disabled || editing || e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, v0: value, moved: false, id: e.pointerId };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      onedit(value, 'begin');
    }
    const width = el.clientWidth || 100;
    let speed = (hi - lo) / width;
    if (e.shiftKey) speed *= 0.1;
    if (e.ctrlKey) speed *= 10;
    onedit(quantize(drag.v0 + dx * speed), 'update');
  }

  function onpointerup(e: PointerEvent) {
    if (!drag) return;
    const d = drag;
    drag = null;
    el.releasePointerCapture(e.pointerId);
    if (d.moved) onedit(value, 'end');
    else startEdit();
  }

  function startEdit() {
    if (disabled) return;
    text = formatNum(value, Math.max(decimals, 3));
    editing = true;
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  }

  function commitText() {
    if (!editing) return;
    editing = false;
    const v = evalNumber(text);
    if (v !== null && v !== value) onedit(quantize(v), 'set');
  }

  function onkeydown(e: KeyboardEvent) {
    if (editing) {
      if (e.key === 'Enter') commitText();
      else if (e.key === 'Escape') editing = false;
      e.stopPropagation();
      return;
    }
    const s = step ?? (integer ? 1 : (hi - lo) / 100);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      onedit(quantize(value + s * (e.shiftKey ? 0.1 : 1)), 'set');
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      onedit(quantize(value - s * (e.shiftKey ? 0.1 : 1)), 'set');
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter') {
      startEdit();
      e.preventDefault();
    }
  }

  function onwheel(e: WheelEvent) {
    if (disabled || document.activeElement !== el) return;
    e.preventDefault();
    const s = step ?? (integer ? 1 : (hi - lo) / 100);
    const dir = e.deltaY < 0 ? 1 : -1;
    onedit(quantize(value + dir * s * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1)), 'set');
  }

  function reset() {
    if (defaultValue !== undefined && !disabled) onedit(defaultValue, 'set');
  }

  const menuItems = $derived<MenuItem[]>([
    { label: tt('menu.resetDefault'), action: reset, disabled: defaultValue === undefined },
    { label: tt('menu.copyValue'), action: () => navigator.clipboard?.writeText(String(value)) },
    {
      label: tt('menu.pasteValue'),
      action: async () => {
        const v = evalNumber((await navigator.clipboard?.readText()) ?? '');
        if (v !== null) onedit(quantize(v), 'set');
      },
    },
  ]);
</script>

<div
  bind:this={el}
  class="scrub"
  class:disabled
  class:editing
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onkeydown}
  {onwheel}
  ondblclick={reset}
  oncontextmenu={(e) => {
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY };
  }}
>
  {#if editing}
    <input
      bind:this={input}
      bind:value={text}
      class="edit"
      onblur={commitText}
      onkeydown={onkeydown}
      spellcheck="false"
    />
  {:else}
    {#if bar}<div class="fill" style:width={`${fill * 100}%`}></div>{/if}
    {#if label}<span class="label">{label}</span>{/if}
    <span class="value">{formatNum(value, decimals)}{unit}</span>
  {/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}

<style>
  .scrub {
    position: relative;
    height: var(--row);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 8px;
    border-radius: var(--radius-s);
    border: 1px solid var(--border);
    background: var(--field);
    cursor: ew-resize;
    overflow: hidden;
    min-width: 0;
    touch-action: none;
  }
  .scrub:hover {
    border-color: var(--border-strong);
  }
  .scrub:focus-visible,
  .scrub.editing {
    outline: none;
    border-color: var(--accent);
  }
  .scrub.disabled {
    opacity: 0.5;
    cursor: default;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-soft);
    border-right: 1px solid var(--accent);
    pointer-events: none;
  }
  .label,
  .value {
    position: relative;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label {
    color: var(--text-2);
  }
  .value {
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }
  .edit {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    outline: none;
    font-variant-numeric: tabular-nums;
    user-select: text;
  }
</style>
