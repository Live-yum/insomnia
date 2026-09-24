import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, net, protocol } from 'electron';

import { OFFLINE_APP_ORIGIN } from '../common/offline-policy';
import { assertOfflineBrowserRequest } from './offline-network';
import { resolveDbByKey } from './templating-worker-database';

export interface RegisterProtocolOptions {
  scheme: string;
}

const insomniaStreamScheme = 'insomnia-event-source';
const templatingWorkerDatabaseInterface = 'insomnia-templating-worker-database';

export async function registerInsomniaProtocols() {
  protocol.registerSchemesAsPrivileged([
    { scheme: insomniaStreamScheme, privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: 'https', privileges: { secure: true, standard: true, supportFetchAPI: true } },
    { scheme: 'http', privileges: { secure: true, standard: true, supportFetchAPI: true } },
    { scheme: templatingWorkerDatabaseInterface, privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
  await app.whenReady();

  // This custom scheme is the product's cloud event stream, not user-created SSE requests.
  // Removing the native Curl forwarding path is essential: webRequest alone cannot cover it.
  if (!protocol.isProtocolHandled(insomniaStreamScheme)) {
    protocol.handle(insomniaStreamScheme, () => new Response('Cloud event stream disabled', { status: 503 }));
  }

  const handleBrowserRequest = async (request: Request): Promise<Response> => {
    try {
      assertOfflineBrowserRequest(request.url);
      const url = new URL(request.url);
      if (url.origin === OFFLINE_APP_ORIGIN) {
        const rootDir = path.resolve(__dirname, 'client');
        const pathname = decodeURIComponent(url.pathname);
        const filePath = pathname.startsWith('/assets/')
          ? path.resolve(rootDir, `.${pathname}`)
          : path.join(rootDir, 'index.html');
        if (!filePath.startsWith(rootDir + path.sep)) return new Response('Forbidden', { status: 403 });
        return await net.fetch(pathToFileURL(filePath).href, { bypassCustomProtocolHandlers: true });
      }
      // Only explicit administrator origins (and exact Vite dev origin) reach this branch.
      // The per-session webRequest policy rechecks redirected URLs.
      return await net.fetch(request, { bypassCustomProtocolHandlers: true });
    } catch {
      return new Response('Blocked by offline browser policy', { status: 403 });
    }
  };
  for (const scheme of ['https', 'http']) {
    if (!protocol.isProtocolHandled(scheme)) protocol.handle(scheme, handleBrowserRequest);
  }
  if (!protocol.isProtocolHandled(templatingWorkerDatabaseInterface)) {
    protocol.handle(templatingWorkerDatabaseInterface, resolveDbByKey);
  }
}
