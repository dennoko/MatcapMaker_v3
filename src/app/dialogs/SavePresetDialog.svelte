<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { saveLayerPreset } from '../presets/user';

  let name = $state(app.primary?.name ?? '');

  async function save() {
    const node = app.primary;
    if (!node || !name.trim()) return;
    app.dialog = null;
    await saveLayerPreset($state.snapshot(node) as typeof node, name.trim());
  }
</script>

<Modal title={tt('presets.saveTitle')} onclose={() => (app.dialog = null)} width={380}>
  <label class="lbl" for="pname">{tt('presets.name')}</label>
  <input id="pname" class="field" bind:value={name} onkeydown={(e) => e.key === 'Enter' && save()} />
  {#snippet footer()}
    <button class="btn" onclick={() => (app.dialog = null)}>{tt('common.cancel')}</button>
    <button class="btn primary" disabled={!name.trim()} onclick={save}>{tt('common.save')}</button>
  {/snippet}
</Modal>

<style>
  .lbl {
    display: block;
    margin-bottom: 6px;
    color: var(--text-2);
  }
  input {
    width: 100%;
    user-select: text;
  }
</style>
