/** Immutable policy for this fork. No preference or environment variable enables cloud services. */
export const OFFLINE_BUILD = true;
export const OFFLINE_ORGANIZATION_ID = 'org_offline';
export const OFFLINE_PLUGIN_NAME = 'insomnia-plugin-offline-toolkit';

export class OfflineModeError extends Error {
  constructor() {
    super('Cloud services and online installation are disabled in this offline build.');
    this.name = 'OfflineModeError';
  }
}

/** Host allowlist for Electron traffic, not a replacement for a host/network firewall. */
export function isOfflineNetworkUrlAllowed(value: string, allowedHosts: readonly string[] = []): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (['file:', 'data:', 'blob:', 'insomnia:', 'insomniadev:', 'insomnia-templating-worker-database:'].includes(url.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const vendorDomains = ['insomnia.rest', 'insomnia.plus', 'konghq.com', 'segment.io', 'segment.com', 'customer.io', 'customerio.com', 'gist.build', 'sentry.io'];
  if (vendorDomains.some(domain => host === domain || host.endsWith('.' + domain))) return false;
  if (url.protocol === 'https:' && host === 'insomnia-app.local' && !url.port) return true;
  if (host === 'localhost' || host === '::1') return true;
  if (allowedHosts.some(allowed => allowed.toLowerCase().trim() === host)) return true;
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some(value => value > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return host.includes(':') && /^(fc|fd)[0-9a-f]{2}:/.test(host);
}
