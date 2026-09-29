import { app, platform, toast } from './state.svelte';
import { tt } from './i18n.svelte';
import { BUILTIN_LAYERS, registry } from '$core/layers/registry';
import { loadPlugin } from '$core/layers/pluginLoader';
import { addStrings, type Locale } from '$core/i18n';

/** Registers layer plugins from Documents/MatcapMaker/plugins. */
export async function loadPlugins() {
  const sources = await platform.pluginsList().catch(() => []);
  if (!sources.length) return;
  const builtin = new Set(BUILTIN_LAYERS.map((d) => d.type));
  let ok = 0;
  for (const src of sources) {
    try {
      const { def, strings } = loadPlugin(src.json, src.glsl, builtin);
      for (const [locale, s] of Object.entries(strings)) {
        if (locale === 'en' || locale === 'ja') addStrings(locale as Locale, s);
      }
      registry.register(def);
      ok++;
    } catch (e) {
      platform.log('warn', `plugin ${src.id}: ${String(e)}`);
      toast(`Plugin "${src.id}": ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
  if (ok) {
    app.pluginsLoaded++;
    toast(tt('toast.pluginsLoaded', { count: ok }));
  }
}
