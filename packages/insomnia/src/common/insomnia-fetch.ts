import type { FetchConfig } from 'insomnia-api';

import { OfflineModeError } from './offline';

// This adapter is ONLY for the application's cloud backend, never the user's API requests.
export function setFetchImplementation(_impl: (input: string, init?: RequestInit) => Promise<Response>) {
  // Intentionally do not retain or call a network implementation.
}

export const proxyAwareFetch: typeof globalThis.fetch = async () => {
  throw new OfflineModeError();
};

export async function insomniaFetch<T = void>(
  _options: FetchConfig & { retries?: number; onDeepLink?: (uri: string) => void },
): Promise<T> {
  throw new OfflineModeError();
}
