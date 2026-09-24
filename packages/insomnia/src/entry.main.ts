import fs from 'node:fs/promises';
import inspector from 'node:inspector';
import { arch, release } from 'node:os';
import path from 'node:path';

import electron, { app, BrowserWindow, net, session } from 'electron';
import contextMenu from 'electron-context-menu';
import { configureFetch } from 'insomnia-api';
import type { Stats } from 'insomnia-data';
import { initDatabase, initServices, models, services } from 'insomnia-data';
import { isMac } from 'insomnia-data/common';
import { servicesNodeImpl } from 'insomnia-data/node';

import { insomniaFetch, setFetchImplementation } from '~/common/insomnia-fetch';
import { mainDatabase } from '~/main/database.main';
import { initElectronStorage } from '~/main/electron-storage';
import { runGitCredentialsMigration } from '~/main/git/migrations';
import { registerPathHandlers } from '~/main/ipc/path';
import { registerLLMConfigServiceAPI } from '~/main/llm-config-service';
import { isPermissionAllowed } from '~/main/permission-policy';
import { initRuntime } from '~/runtimes';
import { nodeRuntime } from '~/runtimes/runtime.node';

import { userDataFolder } from '../config/config.json';
import { installOfflineNetworkPolicy } from './main/offline-network';
import { configureV3ClientDefaults } from './common/configure-v3-client';
import { getAppVersion, getProductName, isDevelopment } from './common/constants';
import { AnalyticsEvent, trackAnalyticsEvent } from './main/analytics';
import { registerInsomniaProtocols } from './main/api.protocol';
import { backupIfNewerVersionAvailable } from './main/backup';
import { registerSyncHandlers } from './main/cloud-sync/ipc';
import { backfillAllManagedGitFolderSlugs, registerGitServiceAPI } from './main/git-service';
import { registerCookieHandlers } from './main/ipc/cookies';
import { ipcMainOn, ipcMainOnce, registerElectronHandlers } from './main/ipc/electron';
import { registerElectronStorageHandlers } from './main/ipc/electron-storage';
import { registergRPCHandlers } from './main/ipc/grpc';
import { registerMainHandlers } from './main/ipc/main';
import { registerSecretStorageHandlers } from './main/ipc/secret-storage';
import log, { initializeLogging } from './main/log';
import { registerCurlHandlers } from './main/network/curl';
import { registerMcpHandlers } from './main/network/mcp';
import { registerSocketIOHandlers } from './main/network/socket-io';
import { registerWebSocketHandlers } from './main/network/websocket';
import { watchProxySettings } from './main/proxy';
import { initializeSentry, sentryWatchAnalyticsEnabled } from './main/sentry';
import { checkIfRestartNeeded } from './main/squirrel-startup';
import * as updates from './main/updates';
import * as windowUtils from './main/window-utils';

// Override the Electron userData path
// This makes Chromium use this folder for eg localStorage
// ensure userData dir change is made before configure sentry SDK (https://docs.sentry.io/platforms/javascript/guides/electron/#app-userdata-directory)
const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : '');
const dataPath = process.env.INSOMNIA_DATA_PATH || (portableDirectory
  ? path.join(portableDirectory, 'data')
  : path.join(app.getPath('userData'), '../', userDataFolder));

installOfflineNetworkPolicy();

app.setPath('userData', dataPath);
app.setPath('sessionData', dataPath);

initializeLogging();
initElectronStorage(dataPath);

initializeSentry();

registerInsomniaProtocols();

let openDeepLinkUrl = async (url: string) => {
  console.warn('[main] openDeepLinkUrl function not initialized yet, cannot open URL:', url);
};
configureFetch(options => insomniaFetch({ ...options, onDeepLink: (uri: string) => openDeepLinkUrl(uri) }));
configureV3ClientDefaults();
// net.fetch picks up the proxy + OS certs like the renderer; node fetch does neither.
// only works post-ready, which is fine — nothing calls this earlier. 'omit' = no cookies, same as before.
setFetchImplementation((input, init) =>
  net.fetch(input, { ...init, credentials: 'omit', bypassCustomProtocolHandlers: true }),
);

// Handle potential auto-update
if (checkIfRestartNeeded()) {
  process.exit(0);
}

log.info(`Running version ${getAppVersion()}`);

// So if (window) checks don't throw
global.window = global.window || undefined;

// setup right click menu
app.on('web-contents-created', (_, contents) => {
  if (contents.getType() === 'webview') {
    contextMenu({ window: contents });
  } else {
    contextMenu();
  }
});

// When the app is first launched
app.on('ready', async () => {
  registerElectronHandlers();
  // @TODO - Maybe move the register stuff in the registerMainHandlers function
  registerMainHandlers();
  registerPathHandlers();
  registergRPCHandlers();
  registerCookieHandlers();
  registerGitServiceAPI();
  registerLLMConfigServiceAPI();
  registerWebSocketHandlers();
  registerSocketIOHandlers();
  registerCurlHandlers();
  registerMcpHandlers();
  registerSecretStorageHandlers();
  registerElectronStorageHandlers();
  registerSyncHandlers();

  /**
   * There's no option that prevents Electron from fetching spellcheck dictionaries from Chromium's CDN and passing a non-resolving URL is the only known way to prevent it from fetching.
   * see: https://github.com/electron/electron/issues/22995
   * On macOS the OS spellchecker is used and therefore we do not download any dictionary files.
   * This API is a no-op on macOS.
   */
  const disableSpellcheckerDownload = () => {
    electron.session.defaultSession.setSpellCheckerEnabled(false);
  };
  disableSpellcheckerDownload();

  // Default-deny web-API permissions; only allow-listed ones are granted (see permission-policy.ts).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(isPermissionAllowed(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => isPermissionAllowed(permission));

  // Init some important things first
  await initDatabase(mainDatabase);
  // Initialize services for main process
  initServices(servicesNodeImpl);
  initRuntime(nodeRuntime);
  await _createModelInstances();
  // proxy has to be set up before backup's net.fetch below
  await watchProxySettings();
  // backup needs the channel from settings which needs the database
  await backupIfNewerVersionAvailable();
  sentryWatchAnalyticsEnabled();

  await runGitCredentialsMigration();
  // Must run — and finish — before the window/renderer exists: it's the only
  // point in the app's lifecycle where nothing else (a file watcher, a git
  // operation kicked off by a route loader) can be concurrently reading or
  // writing these same folders, so the rename can never race another reader
  // into resurrecting the old path (see backfillManagedFolderSlug).
  await backfillAllManagedGitFolderSlugs();

  await _launchApp();

  // Init the rest
  await updates.init();
  // recursive = ignore already exists error
  await fs.mkdir(path.join(dataPath, 'responses'), { recursive: true });
});

// Portable builds intentionally do not register system-wide protocol handlers.
app.on('quit', () => {
  // stop the inspector if active to unblock electron app exit in development mode
  if (isDevelopment() && inspector.url()) {
    inspector.close();
  }
});
// Quit when all windows are closed (except on Mac).
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
// Mac-only, when the user clicks the doc icon
app.on('activate', (_error, hasVisibleWindows) => {
  // Create a new window when clicking the doc icon if there isn't one open
  if (!hasVisibleWindows) {
    try {
      console.log('[main] creating new window for MacOS activate event');
      windowUtils.createWindow();
    } catch {
      // This might happen if 'ready' hasn't fired yet. So we're just going
      // to silence these errors.
      console.log('[main] App not ready to "activate" yet');
    }
  }
});

// When a folder path is opened from the OS (CLI arg, Finder "Open With", etc.),
// normalise it into the open-folder deep link so the renderer has a single,
// well-formed entry point. Returns null when the path isn't an existing folder.
const toOpenFolderDeepLink = async (rawPath: string): Promise<string | null> => {
  try {
    if (!rawPath || !path.isAbsolute(rawPath)) {
      return null;
    }
    const stats = await fs.stat(rawPath);
    if (!stats.isDirectory()) {
      return null;
    }
    return `insomnia://app/open-folder?path=${encodeURIComponent(rawPath)}`;
  } catch {
    return null;
  }
};

const _launchApp = async () => {
  await _trackStats();
  let window: BrowserWindow;
  // Handle URLs sent via command line args
  ipcMainOnce('halfSecondAfterAppStart', async () => {
    console.log('[main] Window ready, handling command line arguments', process.argv);
    const args = process.argv.slice(1).filter(a => a !== '.');
    console.log('[main] Check args and create windows', args);
    if (args.length) {
      window = windowUtils.createWindowsAndReturnMain();
      // A folder path (e.g. `insomnia /path/to/repo`) opens it as a Git project.
      const folderDeepLink = await toOpenFolderDeepLink(args[args.length - 1]);
      window.webContents.send('shell:open', folderDeepLink || args.join(','));
    }
  });
  // Disable deep linking in playwright e2e tests in order to run multiple tests in parallel
  if (!process.env.PLAYWRIGHT_TEST) {
    // Deep linking logic - https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      console.error('[app] Failed to get instance lock');
      app.quit();
    } else {
      // Called when second instance launched with args (Windows/Linux)
      app.on('second-instance', async (_1, args) => {
        console.log('[main] Second instance listener received:', args.join('||'));
        window = windowUtils.createWindowsAndReturnMain();
        if (window) {
          if (window.isMinimized()) {
            window.restore();
          }
          window.focus();
        }
        const lastArg = args.slice(-1).join(',');
        console.log('[main] Open Deep Link URL sent from second instance', lastArg);
        const folderDeepLink = await toOpenFolderDeepLink(lastArg);
        window.webContents.send('shell:open', folderDeepLink || lastArg);
      });
      window = windowUtils.createWindowsAndReturnMain();

      openDeepLinkUrl = async (url: string) => {
        console.log('[main] Open Deep Link URL', url);
        window = windowUtils.createWindowsAndReturnMain();
        if (window) {
          if (window.isMinimized()) {
            window.restore();
          }
          window.focus();
        } else {
          window = windowUtils.createWindowsAndReturnMain();
        }
        return window.webContents.send('shell:open', url);
      };

      app.on('open-url', (_event, url) => {
        openDeepLinkUrl(url);
      });
      // macOS Finder "Open With" → Insomnia for a folder (declared as a folder
      // document type in electron-builder.config.js). Only folders are adopted.
      app.on('open-file', async (event, filePath) => {
        event.preventDefault();
        const folderDeepLink = await toOpenFolderDeepLink(filePath);
        if (folderDeepLink) {
          openDeepLinkUrl(folderDeepLink);
        }
      });
      ipcMainOn('openDeepLink', (_event, url) => {
        openDeepLinkUrl(url);
      });
    }
  } else {
    window = windowUtils.createWindowsAndReturnMain();
  }

  // Don't send origin header from Insomnia because we're not technically using CORS
  session.defaultSession.webRequest.onBeforeSendHeaders((details, fn) => {
    delete details.requestHeaders.Origin;
    fn({
      cancel: false,
      requestHeaders: details.requestHeaders,
    });
  });
};

/*
  Only one instance should exist of these models
  On rare occasions, race conditions during initialization result in multiple being created
  To avoid that, create them explicitly prior to any initialization steps
 */
async function _createModelInstances() {
  await services.stats.get();
  const offlineSettings = await services.settings.getOrCreate();
  await services.settings.update(offlineSettings, { enableAnalytics: false, updateAutomatically: false });
  await services.userSession.update({ id: '', accountId: '', email: '', firstName: '', lastName: '', hashedAccountId: '' });
  const offlineProjects = await services.project.listByOrganizationIds(models.organization.OFFLINE_ORGANIZATION_ID);
  if (offlineProjects.length === 0) {
    const project = await services.project.create({ name: 'Local Project', parentId: models.organization.OFFLINE_ORGANIZATION_ID });
    await services.workspace.create({ name: 'My Collection', scope: 'collection', parentId: project._id });
  }

  try {
    const scratchpadProject = await services.project.getById(models.project.SCRATCHPAD_PROJECT_ID);
    const scratchPad = await services.workspace.getById(models.workspace.SCRATCHPAD_WORKSPACE_ID);
    if (!scratchpadProject) {
      console.log('[main] Initializing Scratch Pad Project');
      await services.project.create({
        _id: models.project.SCRATCHPAD_PROJECT_ID,
        name: getProductName(),
        remoteId: null,
        parentId: models.organization.SCRATCHPAD_ORGANIZATION_ID,
      });
    }

    if (!scratchPad) {
      console.log('[main] Initializing Scratch Pad');
      await services.workspace.create({
        _id: models.workspace.SCRATCHPAD_WORKSPACE_ID,
        name: 'Scratch Pad',
        parentId: models.project.SCRATCHPAD_PROJECT_ID,
        scope: 'collection',
      });
    }
  } catch (err) {
    console.warn('[main] Failed to create default project. It probably already exists', err);
  }
}

function getOperatingSystem(): string {
  switch (process.platform) {
    case 'darwin': {
      return 'macOS';
    }
    case 'win32': {
      return 'Windows';
    }
    case 'linux': {
      return 'Linux';
    }
    case 'freebsd': {
      return 'FreeBSD';
    }
    case 'openbsd': {
      return 'OpenBSD';
    }
    case 'aix': {
      return 'AIX';
    }
    default: {
      return process.platform;
    }
  }
}

async function _trackStats() {
  // Handle the stats
  const oldStats = await services.stats.get();
  const stats: Stats = await services.stats.update({
    currentLaunch: Date.now(),
    lastLaunch: oldStats.currentLaunch,
    currentVersion: getAppVersion(),
    lastVersion: oldStats.currentVersion,
    launches: oldStats.launches + 1,
  });

  const localProjects = await services.project.count({
    remoteId: null,
    parentId: { $ne: null },
    _id: { $ne: models.project.SCRATCHPAD_PROJECT_ID },
  });

  const remoteProjects = await services.project.count({
    remoteId: { $ne: null },
    parentId: { $ne: null },
  });

  const settings = await services.settings.get();

  trackAnalyticsEvent(AnalyticsEvent.appStarted, {
    localProjects,
    remoteProjects,
    createdRequests: stats.createdRequests,
    deletedRequests: stats.deletedRequests,
    executedRequests: stats.executedRequests,
    themeName: settings.theme,
    operatingSystem: getOperatingSystem(),
    osVersion: release(),
    architecture: arch(),
  });

  ipcMainOnce('halfSecondAfterAppStart', async () => {
    const { currentVersion, launches, lastVersion } = stats;

    const firstLaunch = launches === 1;
    const justUpdated = !firstLaunch && currentVersion !== lastVersion;
    if (!justUpdated || !currentVersion) {
      return;
    }
    console.log('[main] App update detected', currentVersion, lastVersion);
    // Wait a bit before showing the user because the app just launched.
    setTimeout(async () => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('show-toast', {
          content: {
            title: `Updated to ${currentVersion}`,
            status: 'info',
            link: {
              label: "See What's New",
              url: 'https://insomnia.rest/changelog',
              external: true,
            },
          },
        });
      }
    }, 5000);
  });
  return stats;
}
