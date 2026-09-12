import { useEffect, useRef, useState } from 'react';
import type { ServiceResult } from '@/types/common';

interface AsyncDataState<T> {
  key: string | null;
  data: T | null;
  error: string | null;
}

/**
 * Fetches data keyed by a dependency (e.g. a company id or route param) without ever calling
 * setState synchronously in the effect body - only from inside the fetch's `.then` callback,
 * which is the pattern React's docs recommend for "effects that synchronize with an external
 * system" (and what the newer react-hooks/set-state-in-effect lint rule enforces). `loading`
 * is derived (current key vs. the key the last resolved result belongs to) rather than a
 * separately reset piece of state, and a stale response for an old key is ignored so a fast
 * key change followed by a slow one can't clobber the newer result.
 *
 * Every list/detail page in the app that fetches by company id or route param should use this
 * instead of its own ad hoc `useState` + `useEffect` pair.
 */
export function useAsyncData<T>(
  key: string | null,
  fetcher: () => Promise<ServiceResult<T>>,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<AsyncDataState<T>>({ key: null, data: null, error: null });
  const latestKeyRef = useRef<string | null>(null);
  const fetcherRef = useRef(fetcher);

  // Refs may only be written outside of render (an effect, in this case) - never directly in
  // the render body. Declared before the load-triggering effect below so it's guaranteed to
  // run first (React runs effects in declaration order) and `fetcherRef` is always fresh by
  // the time `load()` reads it, including on the very first mount.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  function load() {
    latestKeyRef.current = key;
    if (key === null) return;
    fetcherRef.current().then((result) => {
      if (latestKeyRef.current !== key) return; // a newer request has since started - ignore
      setState({ key, data: result.ok ? result.data : null, error: result.ok ? null : result.error.message });
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed deliberately by `key` only
  }, [key]);

  const loading = key !== null && state.key !== key;
  return {
    data: state.key === key ? state.data : null,
    loading,
    error: state.key === key ? state.error : null,
    reload: load,
  };
}
