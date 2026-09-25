import { OFFLINE_UI_LANGUAGE_KEY, parseOfflineUiLanguage, translateOfflineSource } from '~/common/offline-localization';

import { getElectronStorage } from './electron-storage';

// A concrete default prevents undefined from entering the native JSON store.
export const getNativeOfflineLocale = () =>
  parseOfflineUiLanguage(getElectronStorage().getItem(OFFLINE_UI_LANGUAGE_KEY, 'zh-CN'));

/** Only authored menu labels, never dynamic window or project titles. */
export const translateNativeOfflineUi = (source: string): string => {
  const locale = getNativeOfflineLocale();
  if (locale === 'en-US') return source;
  return translateOfflineSource(source.replaceAll('&', '').trim(), locale);
};
