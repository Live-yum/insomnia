import type { FetchConfig } from 'insomnia-api';

import { OFFLINE_SERVICE_ERROR } from './offline-policy';

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

/** Keep the bootstrap interface, but do not retain an online fetch implementation. */
export function setFetchImplementation(_impl: FetchImplementation): void {}

/** Insomnia's service SDK transport, NOT the user's API-request transport. */
export const proxyAwareFetch: typeof globalThis.fetch = async () => {
  throw new Error(OFFLINE_SERVICE_ERROR);
};

export async function insomniaFetch<T = void>(
  _options: FetchConfig & { retries?: number; onDeepLink?: (uri: string) => void },
): Promise<T> {
  throw new Error(OFFLINE_SERVICE_ERROR);
}
