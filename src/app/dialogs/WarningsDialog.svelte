<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';

  const close = () => {
    app.dialog = null;
    app.warnings = [];
  };
</script>

<Modal title={tt('warnings.title')} onclose={close} width={520}>
  <p class="muted">{tt('warnings.intro')}</p>
  <ul>
    {#each app.warnings as w}
      <li>{tt(w.key, w.args)}</li>
    {/each}
  </ul>
  {#snippet footer()}
    <button class="btn primary" onclick={close}>{tt('common.ok')}</button>
  {/snippet}
</Modal>

<style>
  ul {
    margin: 8px 0;
    padding-left: 20px;
    line-height: 1.7;
    user-select: text;
  }
</style>
