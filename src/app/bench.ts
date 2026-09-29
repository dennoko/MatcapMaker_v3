// Phase 0 measurements: differential re-render cost with 10 layers and 4K
// export (render + JFA padding + readback + encode). Reachable from Help.

import type { Renderer } from '$render/Renderer';
import { createDefaultProject, createLayer, defaultViewState } from '$core/model/project';
import type { Project } from '$core/model/types';
import type { Platform } from '$platform/types';
import { produce } from 'immer';

export interface BenchResult {
  name: string;
  value: number;
  unit: string;
  target?: number;
}

function tenLayerProject(): Project {
  const p = createDefaultProject('bench');
  const extra = [
    createLayer('fresnel'),
    createLayer('gradient', { gradientType: 'radial' }),
    createLayer('noise', { intensity: 0.2 }),
    createLayer('spotLight', { direction: [0.5, 0.5, 0.7] }),
    createLayer('spotLight', { direction: [-0.5, -0.4, 0.7], color: [0.2, 0.5, 1] }),
    createLayer('colorAdjust', { saturation: 1.2 }),
    createLayer('fresnel', { color: [1, 0.5, 0.2], power: 2 }),
    createLayer('blurSharpen', { radius: 0.2 }),
  ];
  return { ...p, layers: [...extra, ...p.layers] };
}

function gpuSync(r: Renderer) {
  const gl = r.ctx.gl;
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

export async function runBenchmark(r: Renderer, platform: Platform, exportPath: string | null): Promise<BenchResult[]> {
  const out: BenchResult[] = [];
  let project = tenLayerProject();
  const base = {
    view: defaultViewState(),
    selectedId: null,
    solo: null,
    blendOverride: null,
    cssWidth: 800,
    cssHeight: 600,
    dpr: 1,
    theme: { bg: [0.1, 0.1, 0.1] as [number, number, number], bg2: [0.15, 0.15, 0.15] as [number, number, number] },
  };

  for (const interactive of [false, true]) {
    r.frame({ ...base, project, interactive });
    gpuSync(r);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      // front-most layer changes → only its slots re-render
      project = produce(project, (d) => {
        d.layers[0].params.power = 1 + (i % 10);
      });
      const t0 = performance.now();
      r.frame({ ...base, project, interactive });
      gpuSync(r);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    out.push({
      name: `slider (front layer, 10 layers, ${interactive ? 512 : 1024}px) median`,
      value: times[times.length >> 1],
      unit: 'ms',
      target: 16,
    });
    const backTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      project = produce(project, (d) => {
        d.layers[d.layers.length - 1].params.color = [i / 10, 0, 0];
      });
      const t0 = performance.now();
      r.frame({ ...base, project, interactive });
      gpuSync(r);
      backTimes.push(performance.now() - t0);
    }
    backTimes.sort((a, b) => a - b);
    out.push({
      name: `slider (back layer = full recomposite, ${interactive ? 512 : 1024}px) median`,
      value: backTimes[backTimes.length >> 1],
      unit: 'ms',
    });
  }

  const t0 = performance.now();
  const enc = r.export(project, {
    size: 4096,
    padding: 16,
    format: 'png8',
    background: [0, 0, 0],
    alphaThreshold: 0,
    smoothPadding: false,
    jpgQuality: 92,
  });
  const tGpu = performance.now() - t0;
  for (const [k, v] of Object.entries(enc.timings)) out.push({ name: `4K export: ${k}`, value: v, unit: 'ms' });
  if (exportPath) {
    const t1 = performance.now();
    await platform.writeImage(enc.data, { path: exportPath, width: enc.width, height: enc.height, format: 'png8' });
    out.push({ name: '4K export: IPC + PNG encode + write', value: performance.now() - t1, unit: 'ms' });
    out.push({ name: '4K export total (padding 16px)', value: performance.now() - t0, unit: 'ms', target: 2000 });
  } else {
    out.push({ name: '4K export GPU side total', value: tGpu, unit: 'ms' });
  }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) out.push({ name: 'JS heap', value: mem.usedJSHeapSize / 1048576, unit: 'MB' });
  out.push({ name: 'GPU memory (estimated)', value: r.memoryBytes / 1048576, unit: 'MB' });
  out.push({ name: 'startup → first frame', value: (window as unknown as { __mmFirstFrame?: number }).__mmFirstFrame ?? 0, unit: 'ms', target: 1000 });
  return out;
}
