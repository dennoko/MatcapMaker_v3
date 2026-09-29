<script lang="ts">
  // Direct manipulation on the preview for the selected layer:
  //  spot light  – drag the highlight (direction), ring knob (rotation),
  //                axis handles (scale X/Y), wheel on the handle (range)
  //  gradient    – drag the arrow (angle) / center + radius (radial)
  //  image       – move / rotate / scale the planar image box
  //  fresnel     – drag the 50% rim circle (power), Shift+drag (bias)
  import { screenToDisc, discToScreen, type PreviewLayout } from '$render/preview/layout';
  import { app, store } from '../../state.svelte';
  import { tt, tParam } from '../../i18n.svelte';
  import { setParams } from '$core/commands/layerCommands';
  import type { ParamValue, Vec2, Vec3 } from '$core/schema/params';
  import {
    DEG,
    discToNormal,
    imageToUv,
    powerForHalfRadius,
    rimHalfRadius,
    screenToUv,
    spotRadius,
    uvToImage,
    uvToScreen,
    type ImageXform,
  } from './math';
  import { assets } from '../../state.svelte';

  interface Props {
    layout: PreviewLayout;
  }
  let { layout }: Props = $props();

  let svg = $state<SVGSVGElement>();
  let active = $state<string | null>(null);

  const node = $derived(app.primary);
  const disc = $derived(layout.discs[0]);
  const p = $derived((node?.params ?? {}) as Record<string, ParamValue>);

  function local(e: PointerEvent | WheelEvent): [number, number] {
    const r = svg!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Runs a gizmo drag as one undo step. */
  function drag(e: PointerEvent, id: string, params: string[], onMove: (x: number, y: number, ev: PointerEvent) => Record<string, ParamValue> | null) {
    if (!node || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as SVGElement;
    target.setPointerCapture(e.pointerId);
    const nodeId = node.id;
    const label = params.map((k) => tParam(node.type, k)).join(', ');
    store.begin('history.gizmo', { param: label });
    active = id;
    const move = (ev: PointerEvent) => {
      const [x, y] = local(ev);
      const values = onMove(x, y, ev);
      if (values) store.dispatch(setParams(nodeId, values));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      store.commit();
      active = null;
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  // --- spot light -------------------------------------------------------------
  const spot = $derived.by(() => {
    if (node?.type !== 'spotLight') return null;
    const d = p.direction as Vec3;
    const [hx, hy] = discToScreen(disc, d[0], d[1]);
    const theta = (p.rotation as number) / DEG;
    const base = disc.r * Math.max(spotRadius(p.range as number), 0.04);
    const sc = p.scale as Vec2;
    const rx = base * sc[0];
    const ry = base * sc[1];
    const ax: [number, number] = [Math.cos(theta), -Math.sin(theta)];
    const ay: [number, number] = [Math.cos(theta + Math.PI / 2), -Math.sin(theta + Math.PI / 2)];
    const ring = Math.max(rx, ry) + 16;
    return { hx, hy, back: d[2] < 0, theta, base, rx, ry, ax, ay, ring };
  });

  function spotWheel(e: WheelEvent) {
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    const r = Math.min(1, Math.max(0, (p.range as number) + (e.deltaY < 0 ? 0.01 : -0.01)));
    store.dispatch(setParams(node.id, { range: +r.toFixed(3) }));
  }

  // --- gradient ---------------------------------------------------------------
  const grad = $derived.by(() => {
    if (node?.type !== 'gradient') return null;
    if (p.gradientType === 'radial') {
      const c = p.center as Vec2;
      const [cx, cy] = discToScreen(disc, c[0], c[1]);
      return { radial: true, cx, cy, rr: (p.radius as number) * disc.r } as const;
    }
    const a = (p.angle as number) / DEG;
    const x0 = disc.cx - Math.cos(a) * disc.r;
    const y0 = disc.cy + Math.sin(a) * disc.r;
    const x1 = disc.cx + Math.cos(a) * disc.r;
    const y1 = disc.cy - Math.sin(a) * disc.r;
    return { radial: false, x0, y0, x1, y1, a } as const;
  });

  function angleAt(x: number, y: number): number {
    const deg = Math.atan2(-(y - disc.cy), x - disc.cx) * DEG;
    return +(((deg % 360) + 360) % 360).toFixed(1);
  }

  // --- image (planar) ---------------------------------------------------------
  const img = $derived.by(() => {
    if (node?.type !== 'image' || p.mapping !== 'planar' || !p.image) return null;
    const meta = assets.get(p.image as string)?.meta;
    const t: ImageXform = {
      aspect: meta && meta.height ? meta.width / meta.height : 1,
      rotation: p.rotation as number,
      scale: p.scale as number,
      scaleXY: p.scaleXY as Vec2,
      offset: p.offset as Vec2,
    };
    const corners = (
      [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ] as const
    ).map(([qx, qy]) => {
      const [u, v] = imageToUv(t, qx, qy);
      return uvToScreen(disc, u, v);
    });
    const [cu, cv] = imageToUv(t, 0, 0);
    const [cx, cy] = uvToScreen(disc, cu, cv);
    // rotation knob above the top edge (q.y = +0.5 is "up" in image space)
    const [tu, tv] = imageToUv(t, 0, 0.5);
    const [tx, ty] = uvToScreen(disc, tu, tv);
    const len = Math.hypot(tx - cx, ty - cy) || 1;
    const rot: [number, number] = [tx + ((tx - cx) / len) * 24, ty + ((ty - cy) / len) * 24];
    return { t, corners, cx, cy, top: [tx, ty] as [number, number], rot };
  });

  function imgMove(e: PointerEvent) {
    const im = img;
    if (!im) return;
    const t0 = { ...im.t };
    const [sx, sy] = local(e);
    const uvS = screenToUv(disc, sx, sy);
    const qS = uvToImage(t0, uvS[0], uvS[1]);
    drag(e, 'img-move', ['offset'], (x, y) => {
      const uv = screenToUv(disc, x, y);
      const q = uvToImage(t0, uv[0], uv[1]);
      return { offset: [+(t0.offset[0] + q[0] - qS[0]).toFixed(4), +(t0.offset[1] + q[1] - qS[1]).toFixed(4)] as Vec2 };
    });
  }

  function imgRotate(e: PointerEvent) {
    const im = img;
    if (!im) return;
    const [sx, sy] = local(e);
    const a0 = Math.atan2(-(sy - im.cy), sx - im.cx);
    const r0 = im.t.rotation;
    const { cx, cy } = im;
    drag(e, 'img-rot', ['rotation'], (x, y, ev) => {
      let r = r0 + (Math.atan2(-(y - cy), x - cx) - a0) * DEG;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      return { rotation: +(((r % 360) + 360) % 360).toFixed(2) };
    });
  }

  function imgScale(e: PointerEvent) {
    const im = img;
    if (!im) return;
    const [sx, sy] = local(e);
    const d0 = Math.hypot(sx - im.cx, sy - im.cy) || 1;
    const s0 = im.t.scale;
    const { cx, cy } = im;
    drag(e, 'img-scale', ['scale'], (x, y) => ({
      scale: +Math.min(20, Math.max(0.01, (s0 * Math.hypot(x - cx, y - cy)) / d0)).toFixed(4),
    }));
  }

  // --- fresnel ------------------------------------------------------------------
  const rim = $derived.by(() => {
    if (node?.type !== 'fresnel') return null;
    const r = rimHalfRadius(p.power as number) * disc.r;
    const a = Math.PI / 4;
    return { r, kx: disc.cx - Math.cos(a) * r, ky: disc.cy - Math.sin(a) * r };
  });

  function rimDrag(e: PointerEvent) {
    const [, sy] = local(e);
    const bias0 = p.bias as number;
    drag(e, 'rim', ['power', 'bias'], (x, y, ev): Record<string, ParamValue> => {
      if (ev.shiftKey) return { bias: +Math.min(1, Math.max(-1, bias0 - (y - sy) / 200)).toFixed(3) };
      const r = Math.hypot(x - disc.cx, y - disc.cy) / disc.r;
      return { power: +Math.min(50, powerForHalfRadius(r)).toFixed(3) };
    });
  }
</script>

<svg bind:this={svg} class="gizmos" class:dragging={!!active}>
  {#if spot}
    {@const s = spot}
    <g class="spot" class:back={s.back}>
      <ellipse
        cx={s.hx}
        cy={s.hy}
        rx={s.rx}
        ry={s.ry}
        transform={`rotate(${(-s.theta * DEG).toFixed(2)} ${s.hx} ${s.hy})`}
        class="outline"
      />
      <circle cx={s.hx} cy={s.hy} r={s.ring} class="ring" />
      <!-- scale handles -->
      {#each [1, -1] as sgn}
        <rect
          role="button" tabindex="-1" class="h sq"
          x={s.hx + s.ax[0] * s.rx * sgn - 5}
          y={s.hy + s.ax[1] * s.rx * sgn - 5}
          width="10"
          height="10"
          onpointerdown={(e) =>
            drag(e, 'sx', ['scale'], (x, y) => {
              const proj = Math.abs((x - s.hx) * s.ax[0] + (y - s.hy) * s.ax[1]);
              return { scale: [+Math.min(10, Math.max(0.01, proj / s.base)).toFixed(3), (p.scale as Vec2)[1]] as Vec2 };
            })}
        ><title>{tParam('spotLight', 'scale')} X</title></rect>
        <rect
          role="button" tabindex="-1" class="h sq"
          x={s.hx + s.ay[0] * s.ry * sgn - 5}
          y={s.hy + s.ay[1] * s.ry * sgn - 5}
          width="10"
          height="10"
          onpointerdown={(e) =>
            drag(e, 'sy', ['scale'], (x, y) => {
              const proj = Math.abs((x - s.hx) * s.ay[0] + (y - s.hy) * s.ay[1]);
              return { scale: [(p.scale as Vec2)[0], +Math.min(10, Math.max(0.01, proj / s.base)).toFixed(3)] as Vec2 };
            })}
        ><title>{tParam('spotLight', 'scale')} Y</title></rect>
      {/each}
      <!-- rotation knob (perpendicular to the major axis) -->
      <circle
        role="button" tabindex="-1" class="h rot"
        cx={s.hx + s.ay[0] * s.ring}
        cy={s.hy + s.ay[1] * s.ring}
        r="6"
        onpointerdown={(e) =>
          drag(e, 'rot', ['rotation'], (x, y, ev) => {
            let deg = Math.atan2(-(y - s.hy), x - s.hx) * DEG - 90;
            if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
            return { rotation: +(((deg % 360) + 360) % 360).toFixed(2) };
          })}
      ><title>{tParam('spotLight', 'rotation')}</title></circle>
      <!-- direction handle: grab the highlight itself -->
      <circle
        role="button" tabindex="-1" class="h dir"
        cx={s.hx}
        cy={s.hy}
        r="9"
        onwheel={spotWheel}
        onpointerdown={(e) =>
          drag(e, 'dir', ['direction'], (x, y) => ({ direction: discToNormal(screenToDisc(disc, x, y)) }))}
      ><title>{tt('gizmo.spot')}</title></circle>
    </g>
  {/if}

  {#if grad}
    {@const g = grad}
    {#if g.radial}
      <circle cx={g.cx} cy={g.cy} r={g.rr} class="ring dashed" />
      <circle
        role="button" tabindex="-1" class="h"
        cx={g.cx + g.rr}
        cy={g.cy}
        r="6"
        onpointerdown={(e) =>
          drag(e, 'grad-r', ['radius'], (x, y) => ({ radius: +Math.min(2, Math.max(0.01, Math.hypot(x - g.cx, y - g.cy) / disc.r)).toFixed(3) }))}
      ><title>{tParam('gradient', 'radius')}</title></circle>
      <circle
        role="button" tabindex="-1" class="h dir"
        cx={g.cx}
        cy={g.cy}
        r="8"
        onpointerdown={(e) =>
          drag(e, 'grad-c', ['center'], (x, y) => {
            const [px, py] = screenToDisc(disc, x, y);
            return { center: [+Math.min(1, Math.max(-1, px)).toFixed(3), +Math.min(1, Math.max(-1, py)).toFixed(3)] as Vec2 };
          })}
      ><title>{tParam('gradient', 'center')}</title></circle>
    {:else}
      <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y1} class="axis" />
      <circle role="button" tabindex="-1" class="h small" cx={g.x0} cy={g.y0} r="5"
        onpointerdown={(e) => drag(e, 'grad-a0', ['angle'], (x, y, ev) => ({ angle: snap((angleAt(x, y) + 180) % 360, ev) }))} />
      <circle role="button" tabindex="-1" class="h dir" cx={g.x1} cy={g.y1} r="8"
        onpointerdown={(e) => drag(e, 'grad-a1', ['angle'], (x, y, ev) => ({ angle: snap(angleAt(x, y), ev) }))}
      ><title>{tParam('gradient', 'angle')}</title></circle>
    {/if}
  {/if}

  {#if img}
    {@const m = img}
    <polygon role="button" tabindex="-1" class="box" points={m.corners.map((c) => c.join(',')).join(' ')} onpointerdown={imgMove}><title>{tParam('image', 'offset')}</title></polygon>
    <line x1={m.top[0]} y1={m.top[1]} x2={m.rot[0]} y2={m.rot[1]} class="axis" />
    <circle role="button" tabindex="-1" class="h rot" cx={m.rot[0]} cy={m.rot[1]} r="6" onpointerdown={imgRotate}><title>{tParam('image', 'rotation')}</title></circle>
    {#each m.corners as c}
      <rect role="button" tabindex="-1" class="h sq" x={c[0] - 5} y={c[1] - 5} width="10" height="10" onpointerdown={imgScale}><title>{tParam('image', 'scale')}</title></rect>
    {/each}
  {/if}

  {#if rim}
    <circle cx={disc.cx} cy={disc.cy} r={rim.r} class="ring dashed grab" onpointerdown={rimDrag} />
    <circle role="button" tabindex="-1" class="h" cx={rim.kx} cy={rim.ky} r="7" onpointerdown={rimDrag}><title>{tt('gizmo.rim')}</title></circle>
  {/if}
</svg>

<script lang="ts" module>
  function snap(v: number, ev: PointerEvent) {
    return ev.shiftKey ? Math.round(v / 15) * 15 : v;
  }
</script>

<style>
  .gizmos {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .h,
  .box,
  .grab {
    pointer-events: all;
    cursor: grab;
  }
  .dragging .h,
  .dragging .box {
    cursor: grabbing;
  }
  .h {
    fill: rgba(255, 255, 255, 0.92);
    stroke: #1a6fe0;
    stroke-width: 2;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .h:hover {
    fill: #4c9bff;
    stroke: #fff;
  }
  .h.dir {
    fill: rgba(255, 255, 255, 0.25);
    stroke: #fff;
    stroke-width: 2.5;
  }
  .h.dir:hover {
    fill: rgba(76, 155, 255, 0.45);
  }
  .h.rot {
    fill: #ffcc4d;
    stroke: #6b4d00;
  }
  .outline {
    fill: none;
    stroke: rgba(255, 255, 255, 0.7);
    stroke-dasharray: 4 3;
  }
  .ring {
    fill: none;
    stroke: rgba(255, 255, 255, 0.35);
  }
  .ring.dashed {
    stroke-dasharray: 5 4;
    stroke: rgba(255, 255, 255, 0.6);
  }
  .grab {
    fill: none;
    stroke-width: 10;
    stroke: transparent;
  }
  .grab:hover {
    stroke: rgba(76, 155, 255, 0.35);
  }
  .axis {
    stroke: rgba(255, 255, 255, 0.75);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .box {
    fill: rgba(76, 155, 255, 0.06);
    stroke: #4c9bff;
    stroke-width: 1.5;
    cursor: move;
  }
  .spot.back .h.dir {
    stroke-dasharray: 3 2;
  }
</style>
