<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';

  const req = $derived(app.confirm!);

  function done(v: string) {
    const r = app.confirm;
    app.confirm = null;
    r?.resolve(v);
  }
</script>

<Modal title={req.title} onclose={() => done('cancel')} width={420}>
  <p class="msg">{req.message}</p>
  {#snippet footer()}
    {#each req.buttons as b}
      <button class="btn" class:primary={b.primary} class:danger={b.danger} onclick={() => done(b.value)}>{b.label}</button>
    {/each}
  {/snippet}
</Modal>

<style>
  .msg {
    line-height: 1.6;
    white-space: pre-wrap;
    margin: 4px 0;
  }
</style>
