import type { QueriesOptions, QueriesResults, QueryKey, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { useQueries, useQuery } from '@tanstack/react-query';

import { useDBQueryClient } from '~/ui/context/app/insomnia-app-data-context';
import { useServerDataQueryClient } from '~/ui/context/app/server-data-context';

// Binds to the local database cache's query client
export function useDBQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData, TError> {
  return useQuery(options, useDBQueryClient());
}

export function useDBQueries<T extends any[], TCombinedResult = QueriesResults<T>>(options: {
  queries: readonly [...QueriesOptions<T>];
  combine?: (result: QueriesResults<T>) => TCombinedResult;
}): TCombinedResult {
  return useQueries(options, useDBQueryClient());
}

// Binds to the server-data (network) query client
export function useServerQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData, TError> {
  // Server queries must not run or retry in this local-only fork. DB queries above are unaffected.
  return useQuery({ ...options, enabled: false, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }, useServerDataQueryClient());
}
