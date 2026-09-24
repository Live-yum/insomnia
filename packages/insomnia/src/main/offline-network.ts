import { app, session, type Session, shell } from 'electron';

import { isOfflineNetworkUrlAllowed } from '../common/offline';

// Only the administrator-provided exact hostnames are accepted; no wildcards or remote configuration.
const allowedHosts = (process.env.INSOMNIA_OFFLINE_ALLOWED_HOSTS || '').split(',').filter(Boolean);
const protectedSessions = new WeakSet<Session>();

export function protectOfflineSession(target: Session) {
  if (protectedSessions.has(target)) return;
  protectedSessions.add(target);
  target.setSpellCheckerEnabled(false);
  target.webRequest.onBeforeRequest((details, callback) => {
    const cancel = !isOfflineNetworkUrlAllowed(details.url, allowedHosts);
    if (cancel) console.warn('[offline-network] Blocked non-allowlisted Electron request');
    callback({ cancel });
  });
}

export function installOfflineNetworkPolicy() {
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('no-pings');
  app.on('session-created', protectOfflineSession);
  app.on('ready', () => protectOfflineSession(session.defaultSession));
  const openExternal = shell.openExternal.bind(shell);
  shell.openExternal = (url, options) => {
    if (!isOfflineNetworkUrlAllowed(url, allowedHosts)) {
      console.warn('[offline-network] External navigation disabled');
      return Promise.resolve();
    }
    return openExternal(url, options);
  };
}
