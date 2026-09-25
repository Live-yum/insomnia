import { useSyncExternalStore } from 'react';

import { OFFLINE_UI_LANGUAGE_KEY, type OfflineUiLanguage, parseOfflineUiLanguage } from '~/common/offline-localization';

export type OfflineLocale = OfflineUiLanguage;
const listeners = new Set<() => void>();

export function getOfflineLocale(): OfflineLocale {
  if (typeof window === 'undefined') return 'zh-CN';
  return parseOfflineUiLanguage(window.localStorage.getItem(OFFLINE_UI_LANGUAGE_KEY));
}

/** Persist both renderer and native-menu preferences; never overwrite a user choice on startup. */
export async function setOfflineLocale(locale: OfflineLocale): Promise<void> {
  if (locale !== 'zh-CN' && locale !== 'en-US') throw new Error('Unsupported interface language');
  if (typeof window === 'undefined') return;
  if (window.main?.electronStorage) {
    await window.main.electronStorage.setItem(OFFLINE_UI_LANGUAGE_KEY, locale);
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
