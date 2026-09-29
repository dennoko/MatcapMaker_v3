import {
  getLocale,
  layerTitle,
  onLocaleChange,
  optionLabel,
  paramLabel,
  setLocale,
  t,
  type Locale,
} from '$core/i18n';

/** Reactive locale: reading `i18n.locale` inside a template re-runs on change. */
export const i18n = $state<{ locale: Locale }>({ locale: getLocale() });
onLocaleChange((l) => (i18n.locale = l));

export function changeLocale(l: Locale) {
  setLocale(l);
  document.documentElement.lang = l;
}

export function tt(key: string, args?: Record<string, string | number>, fallback?: string): string {
  void i18n.locale;
  return t(key, args, fallback);
}

export function tLayer(type: string): string {
  void i18n.locale;
  return layerTitle(type);
}

export function tParam(type: string, param: string): string {
  void i18n.locale;
  return paramLabel(type, param);
}

export function tOption(type: string, param: string, option: string): string {
  void i18n.locale;
  return optionLabel(type, param, option);
}
