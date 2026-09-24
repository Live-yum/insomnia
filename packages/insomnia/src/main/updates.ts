import { ipcMainOn } from './ipc/electron';

// No updater SDK is imported or initialized, including when old preferences enable updates.
export const getUpdatesBaseURL = '';
export const getUpdateUrl = (_channel: string): string | null => null;
export const init = async () => {
  ipcMainOn('getUpdateStatus', event => { event.returnValue = 'idle'; });
  ipcMainOn('manualUpdateCheck', () => {});
  ipcMainOn('applyUpdateAndRestart', () => {});
};
