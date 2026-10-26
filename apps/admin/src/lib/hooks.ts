'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs, type Page } from './api';

/** A paginated admin list with filters. Changing a filter goes back to page 1. */
export function usePagedList<T, F extends Record<string, string>>(path: string, initialFilters: F, pageSize = 20) {
  const [page, setPage] = useState(1);
  const [filters, setFiltersState] = useState<F>(initialFilters);
  const query = useQuery({
    queryKey: [path, filters, page, pageSize],
    queryFn: () => api.get<Page<T>>(`${path}${qs({ ...filters, page, pageSize })}`),
  });
  const setFilter = (key: keyof F, value: string) => {
    setFiltersState((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  return { query, page, setPage, filters, setFilter, pageSize };
}

/** Runs an API call, then refreshes the given queries (by key prefix). */
export function useAction<TArgs = void, TResult = unknown>(fn: (args: TArgs) => Promise<TResult>, refresh: unknown[][] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(refresh.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}
