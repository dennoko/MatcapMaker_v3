<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import DevLogo from '../widgets/DevLogo.svelte';
  import { app, platform } from '../state.svelte';
  import { tt } from '../i18n.svelte';
  import { APP_VERSION } from '$core/model/project';
  import { checkForUpdates } from '../updates';
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
    if (app.versionStatus.state === 'idle') {
      void checkForUpdates(false);
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
      <div class="ver-check-row">
        {#if app.versionStatus.state === 'checking'}
          <span class="muted small checking"><span class="spin"></span>{tt('about.checkingUpdates')}</span>
        {:else if app.updateAvailable}
          <div class="update-box">
            <span class="update-pulse"></span>
            <span class="ok-text small"><strong>v{app.updateAvailable.version}</strong> {tt('status.updateAvailable')}</span>
            <button class="btn ok small" onclick={() => platform.openUrl(app.updateAvailable!.url)}>
              {tt('about.openDownloadPage')}
            </button>
          </div>
        {:else if app.versionStatus.state === 'upToDate'}
          <span class="ok-text small">✓ {tt('about.latestVersion')}</span>
          <button class="btn ghost small" onclick={() => checkForUpdates(true)}>{tt('about.recheckUpdates')}</button>
        {:else if app.versionStatus.state === 'error'}
          <span class="muted small err">{tt('about.checkFailed')}</span>
          <button class="btn ghost small" onclick={() => checkForUpdates(true)}>{tt('about.recheckUpdates')}</button>
        {:else}
          <button class="btn ghost small" onclick={() => checkForUpdates(true)}>{tt('about.checkUpdates')}</button>
        {/if}
      </div>
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
  .ver-check-row {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .update-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border-radius: var(--radius-s);
    background: rgba(0, 230, 118, 0.12);
    border: 1px solid #00e676;
  }
  :root[data-theme='light'] .update-box {
    background: rgba(16, 185, 129, 0.12);
    border-color: #10b981;
  }
  .update-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #00e676;
    box-shadow: 0 0 6px #00e676;
    animation: pulse-dot 1.8s infinite ease-in-out;
  }
  @keyframes pulse-dot {
    0%, 100% { transform: scale(0.9); opacity: 0.8; }
    50% { transform: scale(1.35); opacity: 1; }
  }
  .ok-text {
    color: var(--ok);
  }
  .checking {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .spin {
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
