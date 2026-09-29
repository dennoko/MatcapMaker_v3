<script lang="ts">
  import Modal from './Modal.svelte';
  import { app, platform, toast } from '../state.svelte';
  import { changeLocale, tt } from '../i18n.svelte';
  import { updateSettings } from '../actions';
  import { importV3Config, type Theme } from '../settings';
  import EnumField from '../widgets/EnumField.svelte';
  import ScrubNumber from '../widgets/ScrubNumber.svelte';
  import type { Locale } from '$core/i18n';

  async function importV3() {
    try {
      const p = await platform.paths();
      const bytes = await platform.readFile(`${p.documents}\\config.json`);
      const raw = JSON.parse(new TextDecoder().decode(bytes));
      updateSettings((s) => Object.assign(s, importV3Config(s, raw)));
      changeLocale(app.settings.language);
      toast(tt('settings.v3Imported'), 'success');
    } catch {
      toast(tt('settings.v3NotFound'), 'error');
    }
  }
</script>

<Modal title={tt('settings.title')} onclose={() => (app.dialog = null)} width={460}>
  <div class="grid">
    <span>{tt('settings.language')}</span>
    <EnumField
      value={app.settings.language}
      options={['ja', 'en']}
      label={(o) => (o === 'ja' ? '日本語' : 'English')}
      onedit={(v) => {
        updateSettings((s) => (s.language = v as Locale));
        changeLocale(v as Locale);
      }}
    />
    <span>{tt('settings.theme')}</span>
    <EnumField value={app.settings.theme} options={['dark', 'light']} label={(o) => tt(`settings.theme.${o}`)} onedit={(v) => updateSettings((s) => (s.theme = v as Theme))} />
    <span>{tt('settings.uiScale')}</span>
    <ScrubNumber value={Math.round(app.settings.uiScale * 100)} min={60} max={200} step={5} unit="%" defaultValue={100} onedit={(v) => updateSettings((s) => (s.uiScale = v / 100))} />
    <span>{tt('settings.autosave')}</span>
    <label class="chk"><input type="checkbox" checked={app.settings.autosave} onchange={(e) => updateSettings((s) => (s.autosave = (e.currentTarget as HTMLInputElement).checked))} /> {tt('settings.autosaveHint')}</label>
    <span>{tt('settings.updates')}</span>
    <label class="chk"><input type="checkbox" checked={app.settings.checkUpdates} onchange={(e) => updateSettings((s) => (s.checkUpdates = (e.currentTarget as HTMLInputElement).checked))} /> {tt('settings.updatesHint')}</label>
    <span>{tt('settings.debug')}</span>
    <label class="chk"><input type="checkbox" checked={app.settings.debugOverlay} onchange={(e) => updateSettings((s) => (s.debugOverlay = (e.currentTarget as HTMLInputElement).checked))} /> {tt('settings.debugHint')}</label>
  </div>
  {#if platform.caps.revealInFolder}
    <div class="row">
      <button class="btn small" onclick={importV3}>{tt('settings.importV3')}</button>
      <button class="btn small" onclick={async () => platform.reveal((await platform.paths()).logs)}>{tt('settings.openLogs')}</button>
      <button class="btn small" onclick={async () => platform.reveal((await platform.paths()).presets)}>{tt('settings.openPresets')}</button>
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn primary" onclick={() => (app.dialog = null)}>{tt('common.close')}</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 10px;
    align-items: center;
  }
  .grid > span {
    color: var(--text-2);
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
    font-size: 0.92em;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
</style>
