import { translateOfflineSource } from '~/common/offline-localization';

import { getOfflineLocale } from './offline-locale';

/** Static UI literals only. Protocol fields, code and user content never pass here. */
export const translateOfflineUi = (source: string): string => translateOfflineSource(source, getOfflineLocale());
