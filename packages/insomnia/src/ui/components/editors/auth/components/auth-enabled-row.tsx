
import React, { type FC } from 'react';

import { translateOfflineUi } from '~/ui/translate-offline';

import { AuthToggleRow } from './auth-toggle-row';

export const AuthEnabledRow: FC = () => <AuthToggleRow label={translateOfflineUi("Enabled")} property="disabled" invert />;
