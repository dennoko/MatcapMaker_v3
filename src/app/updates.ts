// "A new version is available" check and notification.
// Fetches version.json from the public GitHub repository using raw.githubusercontent.com,
// completely avoiding the 60 req/hour unauthenticated API rate limits.
// Modeled after DennokoMeshEditor's version checker.

import { app, platform } from './state.svelte';
import { APP_VERSION } from '$core/model/project';
import { isNewerVersion, normalizeVersion } from '$core/util/version';

export const REPO_OWNER = 'dennoko';
export const REPO_NAME = 'MatcapMaker_v3';
export const VERSION_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/version.json`;
export const REQUEST_TIMEOUT_MS = 8000;

const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const WEB_DOWNLOAD_URL = `${RELEASES_URL}/latest/download/MatcapMaker_web.html`;

export interface VersionInfo {
  version: string;
  url?: string;
  message?: string;
}

/** Single-file web users get the HTML directly; desktop uses version.json's url if it is https. */
function targetUrl(info: VersionInfo): string {
  if (__WEB_BUILD__) return WEB_DOWNLOAD_URL;
  const url = typeof info.url === 'string' ? info.url.trim() : '';
  return /^https:\/\//i.test(url) ? url : RELEASES_URL;
}

async function fetchVersionInfo(): Promise<VersionInfo> {
  const ctrl = new AbortController();
  // the timeout covers the body too: a stalled response must not leave the state at 'checking'
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(VERSION_URL, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()) as VersionInfo;
    if (!info || typeof info.version !== 'string' || !info.version.trim()) throw new Error('invalid version.json');
    return info;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches version.json at most once per call; no retries. Automatic calls (`force = false`)
 * run only once per session and respect the setting; `force` is for explicit user actions.
 */
export async function checkForUpdates(force = false): Promise<void> {
  if (app.versionStatus.state === 'checking') return;
  if (!force) {
    if (!app.settings.checkUpdates) return;
    // hosted web always serves the latest bundle; only file:// and desktop check automatically
    if (__WEB_BUILD__ && location.protocol !== 'file:') return;
    if (app.versionStatus.state !== 'idle') return;
  }

  app.versionStatus = { state: 'checking', currentVersion: APP_VERSION };
  try {
    const info = await fetchVersionInfo();
    const latest = normalizeVersion(info.version);
    const url = targetUrl(info);
    const message = info.message || '';
    if (isNewerVersion(latest, APP_VERSION)) {
      app.updateAvailable = { version: latest, url, message };
      app.versionStatus = { state: 'updateAvailable', currentVersion: APP_VERSION, latestVersion: latest, url, message };
      platform.log('info', `update available: v${latest}`);
    } else {
      app.updateAvailable = null;
      app.versionStatus = { state: 'upToDate', currentVersion: APP_VERSION, latestVersion: latest, url, message };
    }
  } catch (err) {
    // offline, timeout, rate limit or a bad file: stay quiet, the About dialog offers a retry
    app.versionStatus = { state: 'error', currentVersion: APP_VERSION };
    platform.log('warn', `version check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
