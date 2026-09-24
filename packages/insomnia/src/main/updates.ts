import { BrowserWindow } from 'electron';

import { ipcMainOn } from './ipc/electron';

export const getUpdatesBaseURL = '';
export const getUpdateUrl = (_updateChannel: string): string | null => null;
let initialized = false;

// Keep IPC replies deterministic; never import either updater or start a timer.
export const init = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  ipcMainOn('getUpdateStatus', event => {
    event.returnValue = 'idle';
  });
  ipcMainOn('applyUpdateAndRestart', () => {});
  ipcMainOn('manualUpdateCheck', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('update-status-changed', 'idle');
      window.webContents.send('show-toast', {
        content: {
          title: 'Updates are disabled in this offline build',
          description: 'Install a separately reviewed offline package to upgrade.',
          status: 'info',
        },
      });
    }
  });
};
