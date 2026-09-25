
import React, { type FC } from 'react';

import { translateOfflineUi } from '~/ui/translate-offline';

import { AuthInputRow } from './components/auth-input-row';
import { AuthTableBody } from './components/auth-table-body';
import { AuthToggleRow } from './components/auth-toggle-row';

export const SingleTokenAuth: FC<{ disabled?: boolean }> = ({ disabled = false }) => (
  <AuthTableBody>
    <AuthToggleRow label={translateOfflineUi("Enabled")} property="disabled" invert disabled={disabled} />
    <AuthInputRow label={translateOfflineUi("Token")} property="token" mask disabled={disabled} />
  </AuthTableBody>
);
