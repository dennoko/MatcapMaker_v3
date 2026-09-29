import type { Platform } from './types';
import { createTauriPlatform } from './tauri';
import { createWebPlatform } from './web';

declare const __WEB_BUILD__: boolean;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createPlatform(): Platform {
  if (!__WEB_BUILD__ && isTauri()) return createTauriPlatform();
  return createWebPlatform();
}

export * from './types';
