import { OFFLINE_UI_LANGUAGE_KEY, parseOfflineUiLanguage, translateOfflineSource } from '~/common/offline-localization';

import { getElectronStorage } from './electron-storage';

export const getNativeOfflineLocale = () => parseOfflineUiLanguage(getElectronStorage().getItem(OFFLINE_UI_LANGUAGE_KEY));

/** Called only for source-authored native menu labels, not window/project titles. */
export const translateNativeOfflineUi = (source: string): string => {
  const locale = getNativeOfflineLocale();
  if (locale === 'en-US') return source;
  const plain = source.replaceAll('&', '').trim();
  return translateOfflineSource(plain, locale);
};
