<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { app } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { applyProjectPreset } from '../actions';
  import { PROJECT_PRESETS } from '../presets/builtin';
  import { listUserPresets, loadPreset, saveProjectPreset, type UserPreset } from '../presets/user';
  import { createEmptyProject } from '$core/model/project';
  import type { Project } from '$core/model/types';
  import { encodePng } from '$platform/pngEncode';

  let thumbs = $state<Record<string, string>>({});
  let user = $state<UserPreset[]>([]);
  let saveName = $state('');

  function thumb(id: string, project: Project) {
    const r = app.renderer;
    if (!r) return;
    try {
      const px = r.export(project, { size: 128, padding: 0, format: 'png8', background: [0, 0, 0], alphaThreshold: 0, smoothPadding: false, jpgQuality: 90 });
      const png = encodePng(px.data, px.width, px.height, 8);
      const url = URL.createObjectURL(new Blob([png as unknown as ArrayBuffer], { type: 'image/png' }));
      thumbs = { ...thumbs, [id]: url };
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    for (const p of PROJECT_PRESETS) thumb(p.id, p.build());
    listUserPresets().then(async (list) => {
      user = list.filter((u) => u.kind === 'project');
      for (const u of user) {
        try {
          thumb(u.path, (await loadPreset(u.path)).project);
        } catch {
          /* unreadable preset */
        }
      }
    });
    return () => Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u));
  });

  async function pickBuiltin(build: () => Project) {
    app.dialog = null;
    await applyProjectPreset(build());
  }

  async function pickUser(u: UserPreset) {
    app.dialog = null;
    const r = await loadPreset(u.path);
    await applyProjectPreset(r.project);
  }

  async function saveCurrent() {
    if (!saveName.trim()) return;
    await saveProjectPreset(saveName.trim());
    saveName = '';
    user = (await listUserPresets()).filter((u) => u.kind === 'project');
    for (const u of user) if (!thumbs[u.path]) thumb(u.path, (await loadPreset(u.path)).project);
  }
</script>

<Modal title={tt('presets.title')} onclose={() => (app.dialog = null)} width={720}>
  <div class="section-title">{tt('presets.builtin')}</div>
  <div class="grid">
    <button class="card" onclick={() => pickBuiltin(() => createEmptyProject())}>
      <div class="img empty">∅</div>
      <span>{tt('presets.blank')}</span>
    </button>
    {#each PROJECT_PRESETS as p}
      <button class="card" onclick={() => pickBuiltin(p.build)}>
        <div class="img">{#if thumbs[p.id]}<img src={thumbs[p.id]} alt="" />{/if}</div>
        <span>{tt(`preset.project.${p.id}`, undefined, p.name)}</span>
      </button>
    {/each}
  </div>

  <div class="section-title user">{tt('presets.user')}</div>
  {#if user.length}
    <div class="grid">
      {#each user as u (u.path)}
        <button class="card" onclick={() => pickUser(u)}>
          <div class="img">{#if thumbs[u.path]}<img src={thumbs[u.path]} alt="" />{/if}</div>
          <span>{u.name}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="muted small">{tt('presets.empty')}</p>
  {/if}
  <div class="save">
    <input class="field" placeholder={tt('presets.name')} bind:value={saveName} onkeydown={(e) => e.key === 'Enter' && saveCurrent()} />
    <button class="btn" disabled={!saveName.trim()} onclick={saveCurrent}>{tt('presets.saveProject')}</button>
  </div>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
    margin: 8px 0 4px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    cursor: pointer;
    transition: border-color 0.12s, transform 0.12s var(--ease);
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .img {
    width: 84px;
    height: 84px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--viewport-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    font-size: 1.6em;
  }
  .img img {
    width: 100%;
    height: 100%;
  }
  .user {
    margin-top: 14px;
  }
  .small {
    font-size: 0.9em;
  }
  .save {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .save input {
    flex: 1;
    user-select: text;
  }
</style>
