<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { SHORTCUTS } from '../shortcuts';
</script>

<Modal title={tt('shortcuts.title')} onclose={() => (app.dialog = null)} width={560}>
  <table>
    <tbody>
      {#each SHORTCUTS as s}
        <tr>
          <td class="keys">
            {#each s.keys.split(' / ') as k, i}
              {#if i > 0}<span class="muted"> / </span>{/if}<span class="kbd">{k}</span>
            {/each}
          </td>
          <td>{tt(s.label)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 5px 4px;
    border-bottom: 1px solid var(--border);
  }
  .keys {
    width: 45%;
    white-space: nowrap;
  }
</style>
