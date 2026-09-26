import translations from './offline-ui-translations.json';

export type OfflineUiLanguage = 'zh-CN' | 'en-US';
export const OFFLINE_UI_LANGUAGE_KEY = 'insomnia.offline.ui-locale';

export function parseOfflineUiLanguage(value: unknown): OfflineUiLanguage {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}

/** Only explicit, authored UI source strings call this; never transform user data. */
export function translateOfflineSource(source: string, locale: OfflineUiLanguage): string {
  if (locale === 'en-US' || !Object.hasOwn(translations, source)) return source;
  return (translations as Record<string, string>)[source];
}
