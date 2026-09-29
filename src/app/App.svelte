<script lang="ts">
  import { onMount } from 'svelte';
  import { Renderer } from '$render/Renderer';
  import { AssetStore } from '$core/io/assetStore';
  import { createDefaultProject, defaultViewState } from '$core/model/project';
  import { createPlatform } from '$platform/index';
  import { runBenchmark, type BenchResult } from './bench';

  let canvas: HTMLCanvasElement;
  let results = $state<BenchResult[]>([]);
  let renderer: Renderer;
  const platform = createPlatform();

  onMount(() => {
    renderer = new Renderer(canvas, new AssetStore());
    renderer.frame({
      project: createDefaultProject(),
      view: defaultViewState(),
      interactive: false,
      selectedId: null,
      solo: null,
      blendOverride: null,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      dpr: devicePixelRatio,
      theme: { bg: [0.1, 0.1, 0.11], bg2: [0.14, 0.14, 0.15] },
    });
  });

  async function bench() {
    results = await runBenchmark(renderer, platform, null);
  }
</script>

<canvas bind:this={canvas} style="width: 600px; height: 600px; display: block"></canvas>
<button onclick={bench}>Benchmark</button>
<ul>
  {#each results as r}
    <li>{r.name}: {r.value.toFixed(1)} {r.unit}</li>
  {/each}
</ul>
