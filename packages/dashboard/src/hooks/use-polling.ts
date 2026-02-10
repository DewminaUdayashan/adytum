'use client';

import { useState, useEffect, useCallback } from 'react';
import { gatewayFetch } from '@/lib/api';

export function usePolling<T>(
  path: string,
  intervalMs: number = 5000,
  initialData?: T,
) {
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await gatewayFetch<T>(path);
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}
