<script lang="ts">
  import { registry } from '$core/layers/registry';
  import { flattenLayers, isGroup } from '$core/model/project';
  import { setBlendSpace, setHdr, renameProject } from '$core/commands/layerCommands';
  import type { MaskRef } from '$core/model/types';
  import { app, store } from '../state.svelte';
  import { tt, tLayer, tParam } from '../i18n.svelte';
  import { maskEdit, paramEdit, propEdit } from '../editing';
  import { pickImage } from '../actions';
  import ParamField from '../widgets/ParamField.svelte';
  import ScrubNumber from '../widgets/ScrubNumber.svelte';
  import BlendSelect from '../widgets/BlendSelect.svelte';
  import EnumField from '../widgets/EnumField.svelte';
  import AssetField from '../widgets/AssetField.svelte';
  import PreviewSettings from './PreviewSettings.svelte';
  import { replaceLayer } from '$core/commands/layerCommands';
  import { createLayer } from '$core/model/project';

  let tab = $state<'layer' | 'preview' | 'project'>('layer');

  const node = $derived(app.primary);
  const def = $derived(node ? registry.get(node.type) : undefined);
  const group = $derived(node ? isGroup(node) : false);
  const shaderError = $derived(node ? app.shaderErrors[node.type] : undefined);
  const visibleParams = $derived(
    def && node
      ? Object.entries(def.params).filter(([, s]) => !s.hidden && (!s.visibleIf || s.visibleIf(node.params)))
      : [],
  );
  const maskLayers = $derived(
    node ? flattenLayers(app.doc.layers).filter((l) => l.id !== node.id && registry.get(l.type)?.kind === 'generator') : [],
  );

  async function pickAsset(key: string) {
    if (!node) return;
    const id = await pickImage();
    if (id) paramEdit(node.id, key, tParam(node.type, key))(id, 'set');
  }

  function resetLayer() {
    if (!node || group) return;
    const fresh = createLayer(node.type);
    store.dispatch(replaceLayer(node.id, { ...fresh, id: node.id, name: node.name }));
  }

  function toggleMask() {
    if (!node) return;
    const m: MaskRef | undefined = node.mask ? { ...node.mask, enabled: !node.mask.enabled } : { enabled: true, source: 'fresnel', invert: false, amount: 2 };
    maskEdit(node.id, node.mask)('enabled')(m.enabled, 'set');
  }
</script>

<div class="inspector">
  <div class="tabs" role="tablist">
    <button role="tab" class:on={tab === 'layer'} aria-selected={tab === 'layer'} onclick={() => (tab = 'layer')}>{tt('inspector.layer')}</button>
    <button role="tab" class:on={tab === 'preview'} aria-selected={tab === 'preview'} onclick={() => (tab = 'preview')}>{tt('inspector.preview')}</button>
    <button role="tab" class:on={tab === 'project'} aria-selected={tab === 'project'} onclick={() => (tab = 'project')}>{tt('inspector.project')}</button>
  </div>

  <div class="body scroll">
    {#if tab === 'layer'}
      {#if !node}
        <div class="empty muted">{tt('inspector.noSelection')}</div>
      {:else}
        {#key node.id}
          <div class="head">
            <span class="type">{group ? '▤' : def?.icon}</span>
            <input
              class="field name"
              value={node.name}
              onchange={(e) => propEdit([node.id], 'name')((e.currentTarget as HTMLInputElement).value, 'set')}
              onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              spellcheck="false"
            />
          </div>
          <div class="sub muted">
            {tLayer(node.type)}
            {#if app.selection.length > 1}· {tt('inspector.multi', { count: app.selection.length })}{/if}
          </div>
          {#if shaderError}
            <div class="error" title={shaderError}>⚠ {tt('error.shader')}</div>
          {/if}

          <div class="grid">
            <label for="blend">{tt('inspector.blend')}</label>
            <BlendSelect value={node.blendMode} layerId={node.id} onchange={(m) => propEdit(app.selection, 'blendMode')(m, 'set')} />
            <label for="opacity">{def?.kind === 'generator' || group ? tt('inspector.opacity') : tt('inspector.strength')}</label>
            <ScrubNumber
              value={Math.round(node.opacity * 1000) / 10}
              min={0}
              max={100}
              unit="%"
              step={0.1}
              defaultValue={100}
              onedit={(v, ph) => propEdit(app.selection, 'opacity')(v / 100, ph)}
            />
          </div>

          {#if visibleParams.length}
            <div class="sep"></div>
            <div class="grid">
              {#each visibleParams as [key, spec] (key)}
                {@const wide = spec.kind === 'gradient' || spec.kind === 'direction' || spec.kind === 'curve'}
                <label class:wide title={key} for={`p-${key}`}>{tParam(node.type, key)}</label>
                <div class:wide>
                  <ParamField
                    type={node.type}
                    name={key}
                    {spec}
                    value={node.params[key] ?? spec.default}
                    onedit={paramEdit(node.id, key, tParam(node.type, key))}
                    onpickAsset={() => pickAsset(key)}
                  />
                </div>
              {/each}
            </div>
          {/if}

          <div class="sep"></div>
          <div class="mask-head">
            <label class="chk">
              <input type="checkbox" checked={!!node.mask?.enabled} onchange={toggleMask} />
              {tt('mask.title')}
            </label>
          </div>
          {#if node.mask?.enabled}
            {@const me = maskEdit(node.id, node.mask)}
            <div class="grid">
              <label for="msrc">{tt('mask.source')}</label>
              <select class="field" value={node.mask.source} onchange={(e) => me('source')((e.currentTarget as HTMLSelectElement).value as MaskRef['source'], 'set')}>
                {#each ['fresnel', 'noise', 'image', 'layer'] as s}
                  <option value={s}>{tt(`mask.${s}`)}</option>
                {/each}
              </select>
              {#if node.mask.source === 'fresnel' || node.mask.source === 'noise'}
                <label for="mamt">{node.mask.source === 'fresnel' ? tt('param.power') : tt('param.scale')}</label>
                <ScrubNumber value={node.mask.amount} min={0.01} max={50} softMax={10} defaultValue={2} onedit={me('amount')} />
              {/if}
              {#if node.mask.source === 'image'}
                <label for="mimg">{tt('mask.image')}</label>
                <AssetField
                  value={node.mask.asset ?? null}
                  onpick={async () => {
                    const id = await pickImage();
                    if (id) me('asset')(id, 'set');
                  }}
                  onclear={() => me('asset')(null, 'set')}
                />
              {/if}
              {#if node.mask.source === 'layer'}
                <label for="mlay">{tt('mask.layer')}</label>
                <select class="field" value={node.mask.layerId ?? ''} onchange={(e) => me('layerId')((e.currentTarget as HTMLSelectElement).value || null, 'set')}>
                  <option value="">—</option>
                  {#each maskLayers as l}
                    <option value={l.id}>{l.name}</option>
                  {/each}
                </select>
              {/if}
              <label for="minv">{tt('mask.invert')}</label>
              <div><input type="checkbox" checked={node.mask.invert} onchange={(e) => me('invert')((e.currentTarget as HTMLInputElement).checked, 'set')} /></div>
            </div>
          {/if}

          {#if !group}
            <div class="footer">
              <button class="btn small" onclick={resetLayer}>↺ {tt('inspector.resetLayer')}</button>
            </div>
          {/if}
        {/key}
      {/if}
    {:else if tab === 'preview'}
      <PreviewSettings />
    {:else}
      <div class="grid">
        <label for="pname">{tt('project.name')}</label>
        <input
          class="field"
          value={app.doc.meta.name}
          onchange={(e) => store.dispatch(renameProject((e.currentTarget as HTMLInputElement).value))}
          spellcheck="false"
        />
        <label for="bspace" title={tt('project.blendSpaceHint')}>{tt('project.blendSpace')}</label>
        <EnumField
          value={app.doc.settings.blendSpace}
          options={['srgb', 'linear']}
          label={(o) => tt(`project.blendSpace.${o}`)}
          onedit={(v) => store.dispatch(setBlendSpace(v as 'srgb' | 'linear'))}
        />
        <label for="hdr" title={tt('project.hdrHint')}>HDR</label>
        <EnumField
          value={app.doc.settings.hdr ? 'on' : 'off'}
          options={['off', 'on']}
          label={(o) => tt(`common.${o}`)}
          onedit={(v) => store.dispatch(setHdr(v === 'on'))}
        />
      </div>
      <p class="muted note">{tt('project.hdrHint')}</p>
      <p class="muted note">{tt('project.blendSpaceHint')}</p>
    {/if}
  </div>
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    border: none;
    background: none;
    padding: 6px 10px;
    color: var(--text-3);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: 10px 12px 16px;
  }
  .empty {
    padding: 20px 4px;
    text-align: center;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .type {
    width: 22px;
    text-align: center;
    font-size: 1.2em;
    color: var(--accent);
  }
  .name {
    flex: 1;
    font-weight: 600;
    user-select: text;
  }
  .sub {
    margin: 4px 0 10px 30px;
    font-size: 0.9em;
  }
  .error {
    color: var(--danger);
    margin-bottom: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(70px, 34%) 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  .grid > label {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid > .wide {
    grid-column: 1 / -1;
  }
  label.wide {
    margin-top: 4px;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 12px 0;
  }
  .mask-head {
    margin-bottom: 8px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .footer {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }
  .note {
    font-size: 0.88em;
    line-height: 1.5;
    margin: 10px 0 0;
  }
</style>
