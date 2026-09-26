import fs from 'node:fs';
import path from 'node:path';

import { app, type Session, session } from 'electron';

import { isDevelopment } from '../common/constants';
import { isOfflineBrowserUrlAllowed, parseOfflineOrigins } from '../common/offline-policy';
import { configureOfflineChromium } from './offline-chromium-policy';

let installed = false;
let browserOrigins: ReadonlySet<string> | undefined;
const configuredSessions = new WeakSet<Session>();

export function getOfflineBrowserOrigins(): ReadonlySet<string> {
  if (browserOrigins) return browserOrigins;
  const origins = new Set(parseOfflineOrigins(process.env.INSOMNIA_OFFLINE_BROWSER_ORIGINS));
  // Match window-utils.ts: only the exact Vite loopback origin, and only in development.
  if (isDevelopment()) {
    let port = '3334';
    try {
      port = fs.readFileSync(path.resolve(__dirname, '..', '.vite-port'), 'utf8').trim();
    } catch {
      // Same fallback as the app's existing development URL.
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
      throw new Error('Invalid offline development server port.');
    }
    origins.add(`http://localhost:${Number(port)}`);
    origins.add(`ws://localhost:${Number(port)}`);
  }
  browserOrigins = origins;
  return origins;
}

export function assertOfflineBrowserRequest(url: string): void {
  if (!isOfflineBrowserUrlAllowed(url, getOfflineBrowserOrigins())) {
    // Never log a request URL: it may contain credentials, tokens or internal paths.
    throw new Error('Browser network access is disabled by the offline build policy.');
  }
}

const configureSession = (target: Session) => {
  if (configuredSessions.has(target)) return;
  configuredSessions.add(target);
  const origins = getOfflineBrowserOrigins();
  target.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isOfflineBrowserUrlAllowed(details.url, origins) });
  });
  target.setSpellCheckerEnabled(false);
  target.setSpellCheckerLanguages([]);
  // No implicit OS/PAC discovery in Chromium. Explicit API-request proxies are handled
  // by Insomnia's native request engine, which is intentionally not monkey-patched here.
  void target.setProxy({ mode: 'direct' }).catch(() => {
    console.warn('[offline] Could not configure the Chromium direct-proxy policy.');
  });
};

/** Install before registerInsomniaProtocols and before any windows are created. */
export function installOfflineNetworkPolicy(): void {
  if (installed) return;
  getOfflineBrowserOrigins(); // Validate administrator configuration before continuing startup.
  configureOfflineChromium(app.commandLine);
  installed = true;
  app.on('session-created', configureSession);
  if (app.isReady()) {
    configureSession(session.defaultSession);
  } else {
    app.once('ready', () => configureSession(session.defaultSession));
  }
}

/** Help/marketing links must not hand URLs to a separately network-enabled browser. */
export async function openOfflineExternal(_url: string): Promise<void> {
  console.info('[offline] Opening an external browser is disabled in this build.');
}
