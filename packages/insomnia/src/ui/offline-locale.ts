import { useSyncExternalStore } from 'react';

import { OFFLINE_UI_LANGUAGE_KEY, type OfflineUiLanguage, parseOfflineUiLanguage } from '~/common/offline-localization';

export type OfflineLocale = OfflineUiLanguage;
const listeners = new Set<() => void>();

export function getOfflineLocale(): OfflineLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  return parseOfflineUiLanguage(window.localStorage.getItem(OFFLINE_UI_LANGUAGE_KEY));
}

/** Persist the explicit choice to native storage before reporting success. */
export async function setOfflineLocale(locale: OfflineLocale): Promise<void> {
  if (locale !== 'zh-CN' && locale !== 'en-US') throw new Error('Unsupported interface language');
  if (typeof window === 'undefined') return;
  if (window.main?.electronStorage) {
    await window.main.electronStorage.setItem(OFFLINE_UI_LANGUAGE_KEY, locale);
    // Reading flushes the native store's debounced write before immediate restart.
    const persisted = await window.main.electronStorage.getItem(OFFLINE_UI_LANGUAGE_KEY);
    if (persisted !== locale) throw new Error('Language preference was not persisted');
  }
  window.localStorage.setItem(OFFLINE_UI_LANGUAGE_KEY, locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const storageChanged = (event: StorageEvent) => {
    if (event.key === OFFLINE_UI_LANGUAGE_KEY) listener();
  };
  window.addEventListener('storage', storageChanged);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', storageChanged);
  };
}

export function useOfflineLocale(): OfflineLocale {
  return useSyncExternalStore(subscribe, getOfflineLocale, () => 'zh-CN');
}

export const localize = (zh: string, en: string): string => getOfflineLocale() === 'zh-CN' ? zh : en;
