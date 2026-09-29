<script lang="ts">
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { newProject } from '../actions';
  import { PROJECT_PRESETS } from '../presets/builtin';
</script>

<div class="strip">
  <div class="section-title">{tt('layers.presets')}</div>
  <div class="chips">
    {#each PROJECT_PRESETS.slice(1) as p}
      <button class="btn small" onclick={() => newProject(p.build())}>{tt(`preset.project.${p.id}`, undefined, p.name)}</button>
    {/each}
    <button class="btn small ghost" onclick={() => (app.dialog = 'presets')}>{tt('layers.morePresets')}</button>
  </div>
</div>

<style>
  .strip {
    padding: 8px 12px 12px;
    border-top: 1px solid var(--border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
</style>
