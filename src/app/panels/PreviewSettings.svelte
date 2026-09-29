<script lang="ts">
  import { app, platform } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { pickImage, reportError, setMeshFrom } from '../actions';
  import ScrubNumber from '../widgets/ScrubNumber.svelte';
  import EnumField from '../widgets/EnumField.svelte';
  import AssetField from '../widgets/AssetField.svelte';
  import Vec2Field from '../widgets/Vec2Field.svelte';
  import type { PreviewShape, SplitMode } from '$core/model/types';
  import { MESH_EXTENSIONS } from '$render/preview/mesh';

  const v = $derived(app.view);

  async function pickNormal() {
    const id = await pickImage();
    if (id) app.view.normalMap.asset = id;
  }

  async function pickMesh() {
    const f = await platform.pickOpenFile([{ name: 'Mesh (OBJ / GLB / FBX)', extensions: MESH_EXTENSIONS }], tt('preview.loadMesh'));
    if (!f) return;
    try {
      await setMeshFrom(f.bytes, f.name);
    } catch (e) {
      reportError(tt('error.mesh'), e);
    }
  }
</script>

<div class="grid">
  <label for="shape">{tt('preview.shape')}</label>
  <select class="field" value={v.previewShape} onchange={(e) => (app.view.previewShape = (e.currentTarget as HTMLSelectElement).value as PreviewShape)}>
    {#each ['sphere', 'flat', 'normalMap', 'mesh'] as s}
      <option value={s}>{tt(`preview.shape.${s}`)}</option>
    {/each}
  </select>
  <label for="split">{tt('preview.split')}</label>
  <EnumField value={v.split} options={['single', 'compare', 'beforeAfter']} label={(o) => tt(`preview.split.${o}`)} onedit={(o) => (app.view.split = o as SplitMode)} />
  <label for="zoom">{tt('preview.zoom')}</label>
  <ScrubNumber value={Math.round(v.zoom * 100)} min={10} max={800} softMax={300} unit="%" defaultValue={100} onedit={(z) => (app.view.zoom = z / 100)} />
  <label for="gizmo">{tt('preview.gizmos')}</label>
  <div><input type="checkbox" checked={v.showGizmos} onchange={(e) => (app.view.showGizmos = (e.currentTarget as HTMLInputElement).checked)} /> <span class="kbd">G</span></div>
</div>

<div class="sep"></div>
<div class="section-title">{tt('preview.normalMap')}</div>
<div class="grid top">
  <label for="nm">{tt('preview.normalMap.image')}</label>
  <div data-drop-normal>
    <AssetField value={v.normalMap.asset} onpick={pickNormal} onclear={() => (app.view.normalMap.asset = null)} placeholder={tt('preview.normalMap.builtin')} />
  </div>
  <label for="nms">{tt('preview.normalMap.strength')}</label>
  <ScrubNumber value={v.normalMap.strength} min={0} max={10} softMax={5} defaultValue={1} onedit={(x) => (app.view.normalMap.strength = x)} />
  <label for="nmsc">{tt('preview.normalMap.scale')}</label>
  <ScrubNumber value={v.normalMap.scale} min={0.01} max={50} softMin={0.1} softMax={10} defaultValue={1} onedit={(x) => (app.view.normalMap.scale = x)} />
  <label for="nmo">{tt('preview.normalMap.offset')}</label>
  <Vec2Field value={v.normalMap.offset} min={-10} max={10} softMin={-1} softMax={1} defaultValue={[0, 0]} onedit={(o) => (app.view.normalMap.offset = o)} />
</div>

<div class="sep"></div>
<div class="section-title">{tt('preview.mesh')}</div>
<div class="row">
  <button class="btn small" onclick={pickMesh}>{tt('preview.loadMesh')}</button>
  {#if v.mesh}
    <button
      class="btn small ghost"
      onclick={() => {
        app.view.mesh = null;
        app.renderer?.setMesh(null);
      }}>{tt('preview.defaultMesh')}</button>
  {/if}
</div>
<p class="muted note">{tt('preview.meshHint')}</p>

{#if app.doc.settings.hdr}
  <div class="sep"></div>
  <div class="section-title">HDR</div>
  <div class="grid top">
    <label for="exp">{tt('preview.exposure')}</label>
    <ScrubNumber value={v.exposure} min={-10} max={10} softMin={-4} softMax={4} defaultValue={0} unit=" EV" onedit={(x) => (app.view.exposure = x)} />
    <label for="tm">{tt('preview.toneMap')}</label>
    <div><input type="checkbox" checked={v.toneMap} onchange={(e) => (app.view.toneMap = (e.currentTarget as HTMLInputElement).checked)} /></div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(70px, 34%) 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  .grid.top {
    margin-top: 8px;
  }
  .grid > label {
    color: var(--text-2);
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 12px 0;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .note {
    font-size: 0.88em;
    line-height: 1.5;
  }
</style>
