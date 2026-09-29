import type { Locale } from '$core/i18n';
import type { ExportFormat } from '$render/export/Exporter';

export type Theme = 'dark' | 'light';

export interface ExportSettings {
  size: number;
  padding: number;
  format: ExportFormat;
  background: [number, number, number];
  alphaThreshold: number;
  smoothPadding: boolean;
  jpgQuality: number;
  /** e.g. {project}_{size} */
  template: string;
  lastDir: string;
}

/** Persisted app settings (not part of any project). */
export interface AppSettings {
  version: 1;
  language: Locale;
  theme: Theme;
  uiScale: number;
  export: ExportSettings;
  recentFiles: string[];
  tourDone: boolean;
  checkUpdates: boolean;
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  recentColors: string[];
  debugOverlay: boolean;
  autosave: boolean;
}

export const EXPORT_SIZES = [64, 128, 256, 512, 1024, 2048, 4096] as const;

export function defaultSettings(language: Locale): AppSettings {
  return {
    version: 1,
    language,
    theme: 'dark',
    uiScale: 1,
    export: {
      size: 2048,
      padding: 4,
      format: 'png8',
      background: [0, 0, 0],
      alphaThreshold: 0,
      smoothPadding: false,
      jpgQuality: 92,
      template: '{project}_{size}',
      lastDir: '',
    },
    recentFiles: [],
    tourDone: false,
    checkUpdates: true,
    leftWidth: 260,
    rightWidth: 320,
    leftCollapsed: false,
    rightCollapsed: false,
    recentColors: [],
    debugOverlay: false,
    autosave: true,
  };
}

export function mergeSettings(base: AppSettings, raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppSettings>;
  const out: AppSettings = { ...base, ...r, export: { ...base.export, ...(r.export ?? {}) } };
  if (out.language !== 'ja' && out.language !== 'en') out.language = base.language;
  if (out.theme !== 'dark' && out.theme !== 'light') out.theme = 'dark';
  if (!Array.isArray(out.recentFiles)) out.recentFiles = [];
  if (!Array.isArray(out.recentColors)) out.recentColors = [];
  out.uiScale = Math.min(2, Math.max(0.6, Number(out.uiScale) || 1));
  out.export.size = Math.min(8192, Math.max(16, Math.round(Number(out.export.size) || 2048)));
  out.export.padding = Math.min(256, Math.max(0, Math.round(Number(out.export.padding) || 0)));
  return out;
}

/** v3 config.json (Documents/MatcapMaker/config.json) → settings. */
export function importV3Config(base: AppSettings, raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const s = structuredClone(base);
  if (typeof r.export_resolution === 'number') s.export.size = r.export_resolution;
  if (typeof r.export_padding === 'number') s.export.padding = r.export_padding;
  if (r.language === 'ja' || r.language === 'en') s.language = r.language;
  return s;
}

export function applyTemplate(template: string, vars: Record<string, string | number>): string {
  const name = template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'matcap';
}
