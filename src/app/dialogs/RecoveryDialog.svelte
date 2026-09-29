<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { clearRecovery, restoreRecovery } from '../recovery.svelte';

  interface Props {
    info: { path: string; modified: number };
    ondone: () => void;
  }
  let { info, ondone }: Props = $props();

  const time = $derived(info.modified ? new Date(info.modified * 1000).toLocaleString(app.settings.language) : '—');

  async function restore() {
    const path = info.path;
    ondone();
    await restoreRecovery(path);
  }

  async function discard() {
    ondone();
    await clearRecovery();
  }
</script>

<Modal title={tt('recovery.title')} onclose={discard} width={440}>
  <p class="msg">{tt('recovery.message', { time })}</p>
  {#snippet footer()}
    <button class="btn danger" onclick={discard}>{tt('recovery.discard')}</button>
    <button class="btn primary" onclick={restore}>{tt('recovery.restore')}</button>
  {/snippet}
</Modal>

<style>
  .msg {
    line-height: 1.6;
  }
</style>
