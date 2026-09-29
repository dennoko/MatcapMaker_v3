<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import DevLogo from '../widgets/DevLogo.svelte';
  import { app, platform } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { APP_VERSION } from '$core/model/project';
  import appIcon from '../../../src-tauri/icons/128x128.png';

  interface Lic {
    name: string;
    version: string;
    license: string;
    source: 'npm' | 'cargo' | 'asset';
    repository?: string;
    textId?: string;
  }

  let list = $state<Lic[]>([]);
  let texts = $state.raw<Record<string, string>>({});
  let open = $state<string | null>(null);
  let filter = $state('');

  onMount(async () => {
    try {
      const m = (await import('../../generated/licenses.json')).default as { packages: Lic[]; texts: Record<string, string> };
      texts = m.texts;
      list = m.packages;
    } catch {
      list = [];
    }
  });

  const shown = $derived(list.filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase())));
  const renderer = $derived(app.renderer?.caps.renderer ?? '');
</script>

<Modal title={tt('about.title')} onclose={() => (app.dialog = null)} width={640}>
  <div class="hero">
    <img src={appIcon} alt="" />
    <div>
      <div class="name">Matcap Maker</div>
      <div class="muted">v{APP_VERSION} · {platform.kind === 'tauri' ? 'Desktop' : 'Web'}</div>
      <div class="muted small">{renderer}</div>
    </div>
    <button class="dev" title="github.com/dennoko" onclick={() => platform.openUrl('https://github.com/dennoko')}>
      <span class="muted small">{tt('about.developer')}</span>
      <DevLogo height={26} />
    </button>
  </div>

  <div class="head">
    <span class="section-title">{tt('about.licenses')} ({list.length})</span>
    <input class="field" placeholder={tt('about.filter')} bind:value={filter} />
  </div>
  <div class="list scroll">
    {#each shown as l (l.source + l.name + l.version)}
      <div class="item">
        <button class="line" onclick={() => (open = open === l.name + l.version ? null : l.name + l.version)}>
          <span class="n">{l.name}</span>
          <span class="muted">{l.version}</span>
          <span class="lic">{l.license}</span>
          <span class="src">{l.source}</span>
        </button>
        {#if open === l.name + l.version}
          <pre>{(l.textId && texts[l.textId]) || l.repository || l.license}</pre>
        {/if}
      </div>
    {/each}
    {#if !list.length}
      <p class="muted">{tt('about.noLicenses')}</p>
    {/if}
  </div>

  {#snippet footer()}
    <button class="btn primary" onclick={() => (app.dialog = null)}>{tt('common.close')}</button>
  {/snippet}
</Modal>

<style>
  .hero {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 14px;
  }
  .hero img {
    width: 56px;
    height: 56px;
  }
  .dev {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-s);
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .dev:hover {
    background: var(--panel-2);
  }
  .name {
    font-size: 1.4em;
    font-weight: 700;
  }
  .small {
    font-size: 0.85em;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .head input {
    width: 180px;
  }
  .list {
    max-height: 340px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
  }
  .line {
    display: flex;
    width: 100%;
    gap: 8px;
    padding: 5px 8px;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }
  .line:hover {
    background: var(--panel-2);
  }
  .n {
    flex: 1;
  }
  .lic {
    color: var(--accent);
  }
  .src {
    width: 44px;
    color: var(--text-3);
    font-size: 0.85em;
  }
  pre {
    margin: 0;
    padding: 8px;
    font-size: 0.8em;
    white-space: pre-wrap;
    max-height: 200px;
    overflow: auto;
    background: var(--field);
    user-select: text;
  }
</style>
