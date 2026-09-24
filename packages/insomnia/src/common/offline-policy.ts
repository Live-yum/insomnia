/** Build-time policy for this fork. There is deliberately no online-mode toggle. */
export const OFFLINE_BUILD = true;
export const OFFLINE_APP_ORIGIN = 'https://insomnia-app.local';
export const OFFLINE_SERVICE_ERROR = 'Insomnia cloud services are disabled in this offline build.';

const networkProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** Reject characters URL parsing could silently normalize before origin validation. */
const hasForbiddenOriginCharacter = (value: string) =>
  [...value].some(character => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127 || character === '\\';
  });

/** Parse an administrator-managed list of EXACT origins; never accept host wildcards. */
export function parseOfflineOrigins(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set<string>();
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error('INSOMNIA_OFFLINE_BROWSER_ORIGINS must be a JSON array of exact origins.');
  }
  if (!Array.isArray(input) || input.some(item => typeof item !== 'string')) {
    throw new Error('INSOMNIA_OFFLINE_BROWSER_ORIGINS must be a JSON array of strings.');
  }
  const result = new Set<string>();
  for (const item of input as string[]) {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error('Invalid origin in INSOMNIA_OFFLINE_BROWSER_ORIGINS.');
    }
    if (
      !networkProtocols.has(url.protocol) ||
      hasForbiddenOriginCharacter(item) ||
      !/^(?:https?|wss?):\/\//i.test(item) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.hostname.includes('*') ||
      url.hostname.endsWith('.') ||
      item.trim() !== item ||
      url.origin === 'null'
    ) {
      throw new Error('Offline browser origins must have no credentials, paths, queries, fragments or wildcards.');
    }
    result.add(url.origin);
  }
  return result;
}

/**
 * This is a Chromium/browser-request policy, NOT a firewall for Node, libcurl,
 * Git, plugins, DNS or child processes. Those need an OS/network egress policy.
 * Extra origins are explicit administrator exceptions (for example an intranet IdP).
 */
export function isOfflineBrowserUrlAllowed(
  input: string,
  extraOrigins: ReadonlySet<string> = new Set<string>(),
): boolean {
  try {
    const url = new URL(input);
    if (url.username || url.password) return false;
    if (networkProtocols.has(url.protocol)) {
      return url.origin === OFFLINE_APP_ORIGIN || extraOrigins.has(url.origin);
    }
    if (url.protocol === 'file:') {
      // A remote file://host/share is network access (SMB/UNC), not a local asset.
      const pathname = decodeURIComponent(url.pathname);
      return url.host === '' && !pathname.startsWith('//') && !pathname.includes('\\');
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    return url.protocol === 'insomnia-templating-worker-database:';
  } catch {
    return false;
  }
}
