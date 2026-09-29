import en from './en.json';
import ja from './ja.json';
import { registry } from '../layers/registry';

export type Locale = 'en' | 'ja';
type Dict = Record<string, string>;

const DICTS: Record<Locale, Dict> = { en, ja };
let current: Locale = 'en';
const listeners = new Set<(l: Locale) => void>();
/** Extra strings contributed at runtime (plugins). */
const extra: Record<Locale, Dict> = { en: {}, ja: {} };

export function detectLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale) {
  if (l === current) return;
  current = l;
  listeners.forEach((f) => f(l));
}

export function onLocaleChange(f: (l: Locale) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function addStrings(locale: Locale, strings: Dict) {
  Object.assign(extra[locale], strings);
}

function format(s: string, args?: Record<string, string | number>) {
  if (!args) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in args ? String(args[k]) : m));
}

function lookup(key: string): string | undefined {
  return extra[current][key] ?? DICTS[current][key] ?? extra.en[key] ?? DICTS.en[key];
}

/** Translates a key; falls back to English, then to `fallback` or the key. */
export function t(key: string, args?: Record<string, string | number>, fallback?: string): string {
  return format(lookup(key) ?? fallback ?? key, args);
}

export function hasKey(key: string): boolean {
  return lookup(key) !== undefined;
}

function humanize(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function layerTitle(type: string): string {
  if (type === 'group') return t('layer.group.title', undefined, 'Group');
  return t(`layer.${type}.title`, undefined, registry.get(type)?.title ?? humanize(type));
}

/** Param label: layer-specific key → generic param key → humanized name. */
export function paramLabel(type: string, param: string): string {
  const specific = lookup(`layer.${type}.param.${param}`);
  if (specific) return specific;
  return t(`param.${param}`, undefined, humanize(param));
}

export function optionLabel(type: string, param: string, option: string): string {
  const specific = lookup(`layer.${type}.param.${param}.${option}`);
  if (specific) return specific;
  return t(`option.${option}`, undefined, humanize(option));
}
