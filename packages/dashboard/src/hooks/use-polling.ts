'use client';

/**
 * @file packages/dashboard/src/hooks/use-polling.ts
 * @description Provides reusable React hooks for dashboard behavior.
 */

import { useState, useEffect, useCallback } from 'react';
import { gatewayFetch } from '@/lib/api';

export function usePolling<T>(path: string, intervalMs: number = 5000, initialData?: T) {
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await gatewayFetch<T>(path);
      setData(result);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}
