<script lang="ts">
  import { normalize3, type Vec3 } from '$core/schema/params';
  import type { OnEdit } from './edit';
  import ScrubNumber from './ScrubNumber.svelte';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: Vec3;
    defaultValue: Vec3;
    onedit: OnEdit<Vec3>;
  }
  let { value, defaultValue, onedit }: Props = $props();

  const R = 38;
  const hx = $derived(R + value[0] * R);
  const hy = $derived(R - value[1] * R);
  const back = $derived(value[2] < 0);

  function fromPoint(el: SVGSVGElement, x: number, y: number, keepBack: boolean): Vec3 {
    const r = el.getBoundingClientRect();
    let px = ((x - r.left) / r.width) * 2 - 1;
    let py = -(((y - r.top) / r.height) * 2 - 1);
    const l = Math.hypot(px, py);
    if (l > 1) {
      px /= l;
      py /= l;
    }
    const z = Math.sqrt(Math.max(0, 1 - px * px - py * py));
    return normalize3([px, py, keepBack ? -z : z]);
  }

  function down(e: PointerEvent) {
    const el = e.currentTarget as SVGSVGElement;
    el.setPointerCapture(e.pointerId);
    const keepBack = e.altKey;
    onedit(value, 'begin');
    onedit(fromPoint(el, e.clientX, e.clientY, keepBack), 'update');
    const move = (ev: PointerEvent) => onedit(fromPoint(el, ev.clientX, ev.clientY, ev.altKey), 'update');
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onedit(value, 'end');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function setAxis(i: number, v: number, phase: Parameters<OnEdit<Vec3>>[1]) {
    const n = [...value] as Vec3;
    n[i] = v;
    onedit(normalize3(n), phase);
  }
</script>

<div class="dir">
  <svg
    width={R * 2}
    height={R * 2}
    viewBox={`0 0 ${R * 2} ${R * 2}`}
    onpointerdown={down}
    ondblclick={() => onedit([...defaultValue] as Vec3, 'set')}
    role="slider"
    aria-valuenow={value[2]}
    tabindex="-1"
  >
    <defs>
      <radialGradient id="ballg" cx="40%" cy="35%" r="70%">
        <stop offset="0%" stop-color="var(--panel-2)" />
        <stop offset="100%" stop-color="var(--field)" />
      </radialGradient>
    </defs>
    <circle cx={R} cy={R} r={R - 1} fill="url(#ballg)" stroke="var(--border-strong)" />
    <line x1={R} y1={R} x2={hx} y2={hy} stroke="var(--text-3)" stroke-dasharray="2 2" />
    <circle cx={hx} cy={hy} r="5" fill={back ? 'none' : 'var(--accent)'} stroke="var(--accent)" stroke-width="2" />
  </svg>
  <div class="axes">
    {#each ['X', 'Y', 'Z'] as a, i}
      <ScrubNumber value={value[i]} min={-1} max={1} label={a} onedit={(v, ph) => setAxis(i, v, ph)} />
    {/each}
    <div class="hint muted">{tt('direction.hint')}</div>
  </div>
</div>

<style>
  .dir {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  svg {
    flex-shrink: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .axes {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .hint {
    font-size: 0.8em;
  }
</style>
