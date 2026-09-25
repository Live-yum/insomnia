import { useSyncExternalStore } from 'react';

export type OfflineLocale = 'zh-CN' | 'en-US';
export const OFFLINE_LOCALE_KEY = 'insomnia.offline.ui-locale';
const listeners = new Set<() => void>();

export function getOfflineLocale(): OfflineLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  try { return window.localStorage.getItem(OFFLINE_LOCALE_KEY) === 'en-US' ? 'en-US' : 'zh-CN'; } catch { return 'zh-CN'; }
}

export function setOfflineLocale(locale: OfflineLocale) {
  if (locale !== 'zh-CN' && locale !== 'en-US') throw new Error('Unsupported interface language');
  window.localStorage.setItem(OFFLINE_LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === OFFLINE_LOCALE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useOfflineLocale() {
  return useSyncExternalStore(subscribe, getOfflineLocale, () => 'zh-CN' as const);
}

/** Explicit source labels only; never run this on user documents or responses. */
export function localize(zh: string, en: string): string {
  return getOfflineLocale() === 'zh-CN' ? zh : en;
}
