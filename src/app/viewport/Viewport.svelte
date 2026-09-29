<script lang="ts">
  import { onMount } from 'svelte';
  import { Renderer } from '$render/Renderer';
  import { computeLayout, hitDisc, inRect, screenToDisc } from '$render/preview/layout';
  import { app, assets, onDocChange, store } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { reportError } from '../actions';
  import { cancelThumbnails, scheduleThumbnails } from './thumbnails';
  import Gizmos from './gizmos/Gizmos.svelte';
  import type { PreviewShape, SplitMode } from '$core/model/types';

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let size = $state({ w: 1, h: 1 });
  let failed = $state<string | null>(null);

  let renderer: Renderer | null = null;
  let raf = 0;
  let interactive = false;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let theme = { bg: [0.1, 0.1, 0.11] as [number, number, number], bg2: [0.14, 0.14, 0.15] as [number, number, number] };
  let lastFrameInfo = 0;

  function cssColor(name: string): [number, number, number] {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }

  export function requestRender() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function draw() {
    raf = 0;
    if (!renderer || renderer.isLost) return;
    try {
      const info = renderer.frame({
        project: app.doc,
        view: $state.snapshot(app.view),
        interactive,
        selectedId: app.primary?.id ?? null,
        solo: app.soloSet,
        blendOverride: app.blendHover,
        cssWidth: size.w,
        cssHeight: size.h,
        dpr: window.devicePixelRatio || 1,
        theme,
      });
      if (!(window as unknown as { __mmFirstFrame?: number }).__mmFirstFrame)
        (window as unknown as { __mmFirstFrame?: number }).__mmFirstFrame = performance.now();
      // status bar update, throttled so dragging doesn't re-render the UI every frame
      const now = performance.now();
      if (info && (now - lastFrameInfo > 120 || !interactive)) {
        app.frame = info;
        lastFrameInfo = now;
      }
      if (!interactive) scheduleThumbnails(renderer);
    } catch (e) {
      reportError(tt('error.render'), e);
    }
  }

  onMount(() => {
    try {
      renderer = new Renderer(canvas, assets);
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
      return;
    }
    app.renderer = renderer;
    renderer.onShaderError = (type, msg) => (app.shaderErrors = { ...app.shaderErrors, [type]: msg });
    renderer.onRestored = () => requestRender();
    if (!renderer.caps.floatTargets) console.warn('EXT_color_buffer_float unavailable: using RGBA8 fallback');

    const ro = new ResizeObserver(() => {
      size = { w: host.clientWidth, h: host.clientHeight };
      requestRender();
    });
    ro.observe(host);

    const off = onDocChange(() => {
      if (store.inTransaction) {
        interactive = true;
        clearTimeout(settle);
        settle = setTimeout(() => {
          interactive = false;
          requestRender();
        }, 150);
      } else {
        clearTimeout(settle);
        interactive = false;
      }
      requestRender();
    });
    const offAssets = assets.onChange(() => requestRender());
    return () => {
      ro.disconnect();
      off();
      offAssets();
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      cancelThumbnails();
      app.renderer = null;
      renderer?.dispose();
    };
  });

  // view / selection / solo / hover-preview changes only need a redraw
  $effect(() => {
    void JSON.stringify(app.view);
    void app.selection.length;
    void app.primary?.id;
    void app.solo.length;
    void app.blendHover;
    void app.redraw;
    void app.doc;
    requestRender();
  });

  $effect(() => {
    void app.settings.theme;
    queueMicrotask(() => {
      theme = { bg: cssColor('--viewport-bg'), bg2: cssColor('--viewport-bg-2') };
      requestRender();
    });
  });

  // --- interaction -----------------------------------------------------------

  const layout = $derived(computeLayout(size.w, size.h, app.view));

  function localPoint(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  }

  function onpointerdown(e: PointerEvent) {
    const [x, y] = localPoint(e);
    if (app.eyedropper) {
      const d = hitDisc(layout, x, y);
      const [px, py] = screenToDisc(d, x, y);
      const c = renderer?.pick(px * 0.5 + 0.5, py * 0.5 + 0.5);
      if (c) app.eyedropper([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])]);
      app.eyedropper = null;
      return;
    }
    const target = e.currentTarget as HTMLElement;
    if (layout.mesh && inRect(layout.mesh, x, y)) {
      target.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const o0 = [...app.view.orbit];
      const move = (ev: PointerEvent) => {
        app.view.orbit = [o0[0] + (ev.clientX - x0) * 0.01, Math.max(-1.5, Math.min(1.5, o0[1] + (ev.clientY - y0) * 0.01))];
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      return;
    }
    if (app.view.split === 'beforeAfter') {
      const d = layout.discs[0];
      target.setPointerCapture(e.pointerId);
      const setSwipe = (cx: number) => (app.view.swipe = Math.min(1, Math.max(0, (cx - (d.cx - d.r)) / (2 * d.r))));
      setSwipe(x);
      const move = (ev: PointerEvent) => setSwipe(localPoint(ev)[0]);
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    }
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    app.view.zoom = Math.min(8, Math.max(0.1, app.view.zoom * k));
  }

  const SHAPES: { v: PreviewShape; key: string }[] = [
    { v: 'sphere', key: '1' },
    { v: 'flat', key: '2' },
    { v: 'normalMap', key: '3' },
    { v: 'mesh', key: '' },
  ];
  const SPLITS: { v: SplitMode; key: string }[] = [
    { v: 'single', key: '' },
    { v: 'compare', key: '4' },
    { v: 'beforeAfter', key: '\\' },
  ];
</script>

<div class="viewport" class:picking={!!app.eyedropper}>
  <div
    class="host"
    bind:this={host}
    data-drop-zone="viewport"
    role="application"
    aria-label={tt('viewport.label')}
    {onpointerdown}
    {onwheel}
  >
    <canvas bind:this={canvas}></canvas>
    {#if app.view.showGizmos && !app.eyedropper && (!layout.mesh || app.view.split === 'compare')}
      <Gizmos {layout} />
    {/if}
    {#if failed}
      <div class="fail">
        <strong>{tt('error.webgl')}</strong>
        <p>{failed}</p>
      </div>
    {/if}
    {#if app.eyedropper}
      <div class="hint-banner">{tt('viewport.eyedropperHint')}</div>
    {/if}
    {#if app.view.split === 'beforeAfter'}
      <div class="ba-labels" style:left={`${layout.swipeX}px`}>
        <span>{tt('viewport.before')}</span><span>{tt('viewport.after')}</span>
      </div>
    {/if}
  </div>

  <div class="toolbar">
    <div class="seg" role="radiogroup" aria-label={tt('preview.shape')}>
      {#each SHAPES as s}
        <button
          class:on={app.view.previewShape === s.v}
          title={`${tt(`preview.shape.${s.v}`)}${s.key ? ` (${s.key})` : ''}`}
          onclick={() => {
            app.view.previewShape = s.v;
            if (s.v === 'mesh' && app.view.split === 'beforeAfter') app.view.split = 'single';
          }}>{tt(`preview.shape.${s.v}`)}</button
        >
      {/each}
    </div>
    <div class="seg" role="radiogroup" aria-label={tt('preview.split')}>
      {#each SPLITS as s}
        <button
          class:on={app.view.split === s.v}
          title={`${tt(`preview.split.${s.v}`)}${s.key ? ` (${s.key})` : ''}`}
          onclick={() => {
            app.view.split = s.v;
            if (s.v === 'beforeAfter' && app.view.previewShape === 'mesh') {
              app.view.previewShape = 'sphere';
            }
          }}>{tt(`preview.split.${s.v}Short`)}</button
        >
      {/each}
    </div>
    <div class="spacer"></div>
    <button class="btn small ghost" class:on={app.view.showGizmos} title={`${tt('preview.gizmos')} (G)`} onclick={() => (app.view.showGizmos = !app.view.showGizmos)}>✥</button>
    <button class="btn small ghost zoom" title={tt('preview.zoomReset')} onclick={() => (app.view.zoom = 1)}>🔍 {Math.round(app.view.zoom * 100)}%</button>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--viewport-bg);
  }
  .host {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .picking .host {
    cursor: crosshair;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: var(--field);
    padding: 3px 10px;
    cursor: pointer;
    color: var(--text-2);
    border-right: 1px solid var(--border);
  }
  .seg button:last-child {
    border-right: none;
  }
  .seg button.on {
    background: var(--accent);
    color: #fff;
  }
  .spacer {
    flex: 1;
  }
  .btn.on {
    color: var(--accent);
  }
  .zoom {
    font-variant-numeric: tabular-nums;
  }
  .fail {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--danger);
    padding: 20px;
    text-align: center;
  }
  .hint-banner {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--accent);
    pointer-events: none;
  }
  .ba-labels {
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    display: flex;
    gap: 16px;
    font-size: 0.85em;
    color: #fff;
    text-shadow: 0 0 3px #000;
    pointer-events: none;
  }
</style>
