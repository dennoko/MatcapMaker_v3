<script lang="ts">
  import Modal from './Modal.svelte';
  import { app, platform } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { exportFileName, exportSpec, exportWithDialog, updateSettings } from '../actions';
  import { EXPORT_SIZES } from '../settings';
  import ScrubNumber from '../widgets/ScrubNumber.svelte';
  import ColorField from '../widgets/ColorField.svelte';
  import EnumField from '../widgets/EnumField.svelte';
  import { estimateExportBytes, type ExportFormat, type OuterBackground } from '$render/export/Exporter';

  const e = $derived(app.settings.export);
  let preview = $state<HTMLCanvasElement>();
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const CROP = 48;
  /** GPU memory the (frequently refreshed) preview may use */
  const PREVIEW_BUDGET = 256 * 1024 * 1024;
  /** resolution the preview actually renders at (lower than the export when it would exceed the budget) */
  let previewSize = $state(0);

  const outerBackgrounds: OuterBackground[] = ['black', 'white', 'transparent'];
  const formats: ExportFormat[] = platform.caps.exr ? ['png8', 'png16', 'jpg', 'exr'] : ['png8', 'png16', 'jpg'];

  function set<K extends keyof typeof e>(k: K, v: (typeof e)[K]) {
    updateSettings((s) => (s.export[k] = v));
  }

  // magnified crop of the disc edge at the target resolution, so the
  // padding result can be checked before writing the file
  function renderPreview() {
    const r = app.renderer;
    const c = preview;
    if (!r || !c) return;
    const spec = exportSpec();
    // same image at a lower resolution (padding scaled to match) when the
    // full-size render would need more GPU memory than a preview should use
    let size = Math.min(spec.size, r.caps.maxTextureSize);
    const fits = (s: number) =>
      estimateExportBytes(app.doc, { size: s, padding: spec.padding }, r.ctx.accumFormat, r.caps.floatTargets) <= PREVIEW_BUDGET;
    while (size > 256 && !fits(size)) size = Math.round(size / 2);
    const padding = spec.padding > 0 ? Math.max(1, Math.round((spec.padding * size) / spec.size)) : 0;
    previewSize = size < spec.size ? size : 0;
    const cw = Math.min(CROP, size);
    const a = (size / 2) * (1 - Math.SQRT1_2);
    const x = Math.max(0, Math.min(size - cw, Math.round(a - cw / 2)));
    try {
      const px = r.export(app.doc, {
        ...spec,
        size,
        padding,
        format: spec.format === 'jpg' ? 'jpg' : 'png8',
        crop: { x, y: x, w: cw, h: cw },
      });
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(cw, cw);
      for (let i = 0, j = 0; i < cw * cw; i++) {
        if (px.channels === 3) {
          img.data.set([px.data[j], px.data[j + 1], px.data[j + 2], 255], i * 4);
          j += 3;
        } else {
          img.data.set(px.data.subarray(i * 4, i * 4 + 4), i * 4);
        }
      }
      c.width = c.height = cw;
      ctx.putImageData(img, 0, 0);
    } catch (err) {
      console.warn(err);
    }
  }

  $effect(() => {
    void JSON.stringify(e);
    void app.doc;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  });

  async function run() {
    if (await exportWithDialog()) app.dialog = null;
  }

  const name = $derived.by(() => {
    void JSON.stringify(e);
    void app.doc.meta.name;
    return exportFileName();
  });
</script>

<Modal title={tt('export.title')} onclose={() => (app.dialog = null)} width={620}>
  <div class="layout">
    <div class="form">
      <div class="label">{tt('export.resolution')}</div>
      <div class="sizes">
        {#each EXPORT_SIZES as s}
          <button class="btn small" class:primary={e.size === s} onclick={() => set('size', s)}>{s}</button>
        {/each}
      </div>
      <div class="row2">
        <ScrubNumber value={e.size} min={16} max={Math.min(8192, app.renderer?.caps.maxTextureSize ?? 8192)} integer label={tt('export.custom')} unit="px" onedit={(v) => set('size', v)} />
      </div>

      <div class="label">{tt('export.padding')}</div>
      <ScrubNumber value={e.padding} min={0} max={256} softMax={64} integer unit="px" defaultValue={4} onedit={(v) => set('padding', v)} />
      <label class="chk"><input type="checkbox" checked={e.smoothPadding} onchange={(ev) => set('smoothPadding', (ev.currentTarget as HTMLInputElement).checked)} /> {tt('export.smoothPadding')}</label>
      <div class="sub">
        <ScrubNumber value={e.alphaThreshold} min={0} max={0.99} step={0.01} label={tt('export.alphaThreshold')} defaultValue={0} onedit={(v) => set('alphaThreshold', v)} />
      </div>

      <div class="label">{tt('export.format')}</div>
      <EnumField value={e.format} options={formats} label={(o) => tt(`export.format.${o}`)} onedit={(v) => set('format', v as ExportFormat)} />
      {#if e.format === 'jpg'}
        <div class="grid">
          <span>{tt('export.background')}</span>
          <ColorField value={e.background} onedit={(v) => set('background', v)} />
          <span>{tt('export.quality')}</span>
          <ScrubNumber value={e.jpgQuality} min={1} max={100} integer defaultValue={92} onedit={(v) => set('jpgQuality', v)} />
        </div>
      {/if}
      {#if e.format !== 'jpg'}
        <div class="grid">
          <span>{tt('export.outerBackground')}</span>
          <EnumField value={e.outerBackground} options={outerBackgrounds} label={(o) => tt(`export.outerBackground.${o}`)} onedit={(v) => set('outerBackground', v as OuterBackground)} />
        </div>
      {/if}
      {#if e.format === 'exr' && !app.doc.settings.hdr}
        <p class="muted small">{tt('export.exrHint')}</p>
      {/if}

      <div class="label">{tt('export.template')}</div>
      <input class="field tpl" value={e.template} onchange={(ev) => set('template', (ev.currentTarget as HTMLInputElement).value)} spellcheck="false" />
      <div class="muted small">{tt('export.templateHint')} → <b>{name}</b></div>
    </div>

    <div class="pv">
      <div class="label">{tt('export.paddingPreview')}</div>
      <div class="pvbox checker"><canvas bind:this={preview}></canvas></div>
      <div class="muted small">{tt('export.paddingPreviewHint', { size: CROP })}</div>
      {#if previewSize}
        <div class="muted small">{tt('export.paddingPreviewScaled', { size: previewSize })}</div>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <span class="muted small hint">{tt('export.quickHint')}</span>
    <button class="btn" onclick={() => (app.dialog = null)}>{tt('common.cancel')}</button>
    <button class="btn primary" onclick={run} disabled={!!app.busy}>{tt('export.run')}</button>
  {/snippet}
</Modal>

<style>
  .layout {
    display: flex;
    gap: 18px;
  }
  .form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .label {
    margin-top: 8px;
    color: var(--text-2);
    font-weight: 600;
  }
  .sizes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .row2 {
    width: 180px;
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
  }
  .sub {
    width: 220px;
  }
  .grid {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 6px;
    align-items: center;
    margin-top: 4px;
  }
  .tpl {
    user-select: text;
  }
  .small {
    font-size: 0.86em;
  }
  .pv {
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pvbox {
    width: 192px;
    height: 192px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    overflow: hidden;
  }
  .pvbox canvas {
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    display: block;
  }
  .hint {
    margin-right: auto;
    align-self: center;
  }
</style>
