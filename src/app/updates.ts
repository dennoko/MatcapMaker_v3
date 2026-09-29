// "A new version is available" notice (no auto-update). Checks the latest
// GitHub release once per start when enabled in settings.

import { app, platform } from './state.svelte';
import { APP_VERSION } from '$core/model/project';

// the list endpoint answers 200 [] when there are no releases (/latest would 404)
export const RELEASES_API = 'https://api.github.com/repos/dennoko/MatcapMaker_v3/releases?per_page=5';

export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((x) => parseInt(x, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkForUpdates() {
  if (!app.settings.checkUpdates) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(RELEASES_API, { signal: ctrl.signal, headers: { Accept: 'application/vnd.github+json' } });
    clearTimeout(t);
    if (!res.ok) return;
    const list = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean }[];
    const j = Array.isArray(list) ? list.find((r) => r.tag_name && !r.draft && !r.prerelease) : undefined;
    if (!j?.tag_name) return;
    if (isNewer(j.tag_name, APP_VERSION)) {
      app.updateAvailable = { version: j.tag_name.replace(/^v/i, ''), url: j.html_url ?? 'https://github.com/dennoko/MatcapMaker_v3/releases' };
      platform.log('info', `update available: ${j.tag_name}`);
    }
  } catch {
    /* offline or rate-limited: stay quiet */
  }
}
