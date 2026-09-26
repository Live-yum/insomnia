
import React, { type FC } from 'react';

import { translateOfflineUi } from '~/ui/translate-offline';

import { AuthInputRow } from './components/auth-input-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

export const NTLMAuth: FC = () => (
  <AuthTableBody>
    <AuthToggleRow label={translateOfflineUi("Enabled")} property="disabled" invert />
    <AuthInputRow label={translateOfflineUi("Username")} property="username" />
    <AuthInputRow label={translateOfflineUi("Password")} property="password" mask />
  </AuthTableBody>
);
