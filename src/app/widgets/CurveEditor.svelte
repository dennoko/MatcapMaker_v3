<script lang="ts">
  import type { CurveValue } from '$core/schema/params';
  import type { OnEdit } from './edit';
  import { tt } from '../i18n.svelte';

  interface Props {
    value: CurveValue;
    defaultValue: CurveValue;
    onedit: OnEdit<CurveValue>;
  }
  let { value, defaultValue, onedit }: Props = $props();

  const S = 180;
  let selected = $state(-1);

  // Catmull-Rom like the shader (evalCurve) for an accurate preview
  function evalCurve(pts: CurveValue, x: number): number {
    const p = [...pts].sort((a, b) => a.x - b.x);
    if (x <= p[0].x) return p[0].y;
    for (let i = 0; i < p.length - 1; i++) {
      const p1 = p[i];
      const p2 = p[i + 1];
      if (x <= p2.x) {
        const p0 = i > 0 ? p[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
        const p3 = i + 2 < p.length ? p[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
        const t = (x - p1.x) / Math.max(p2.x - p1.x, 1e-5);
        const t2 = t * t;
        const t3 = t2 * t;
        const y =
          0.5 *
          (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        return Math.min(1, Math.max(0, y));
      }
    }
    return p[p.length - 1].y;
  }

  const path = $derived.by(() => {
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${(x * S).toFixed(1)},${((1 - evalCurve(value, x)) * S).toFixed(1)}`;
    }
    return d;
  });

  function toPt(svg: SVGSVGElement, e: PointerEvent) {
    const r = svg.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    };
  }

  function down(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const q = toPt(svg, e);
    let idx = value.findIndex((p) => Math.hypot(p.x - q.x, p.y - q.y) < 0.05);
    let pts = value.map((p) => ({ ...p }));
    if (idx < 0) {
      if (value.length >= 8) return;
      pts.push(q);
      idx = pts.length - 1;
    }
    selected = idx;
    onedit(pts, 'begin');
    onedit(pts, 'update');
    svg.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = toPt(svg, ev);
      pts = pts.map((o, i) => (i === idx ? p : o));
      onedit(pts, 'update');
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      onedit(pts, 'end');
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  }

  function remove() {
    if (selected < 0 || value.length <= 2) return;
    onedit(
      value.filter((_, i) => i !== selected),
      'set',
    );
    selected = -1;
  }
</script>

<div class="curve">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
  <svg
    width={S}
    height={S}
    viewBox={`0 0 ${S} ${S}`}
    onpointerdown={down}
    ondblclick={remove}
    onkeydown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && remove()}
    role="application"
    tabindex="0"
  >
    {#each [0.25, 0.5, 0.75] as g}
      <line x1={g * S} y1="0" x2={g * S} y2={S} class="grid" />
      <line x1="0" y1={g * S} x2={S} y2={g * S} class="grid" />
    {/each}
    <line x1="0" y1={S} x2={S} y2="0" class="diag" />
    <path d={path} class="line" />
    {#each value as p, i}
      <circle cx={p.x * S} cy={(1 - p.y) * S} r={i === selected ? 5 : 4} class:sel={i === selected} />
    {/each}
  </svg>
  <div class="side">
    <div class="muted hint">{tt('curve.hint')}</div>
    <button class="btn small" onclick={() => onedit(structuredClone($state.snapshot(defaultValue)) as CurveValue, 'set')}>↺ {tt('menu.resetDefault')}</button>
  </div>
</div>

<style>
  .curve {
    display: flex;
    gap: 8px;
  }
  svg {
    background: var(--field);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    cursor: crosshair;
    touch-action: none;
    flex-shrink: 0;
  }
  .grid {
    stroke: var(--border);
  }
  .diag {
    stroke: var(--text-3);
    stroke-dasharray: 3 3;
  }
  .line {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.5;
  }
  circle {
    fill: var(--panel);
    stroke: var(--text);
    stroke-width: 1.5;
  }
  circle.sel {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85em;
  }
</style>
