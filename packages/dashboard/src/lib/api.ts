/**
 * @file packages/dashboard/src/lib/api.ts
 * @description Provides shared utility functions for client/server modules.
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || '/api';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

function joinGatewayPath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Support legacy env values like ".../api" with request paths that already include "/api/*".
  if (normalizedBase.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    normalizedPath = normalizedPath.slice('/api'.length);
  }

  return `${normalizedBase}${normalizedPath}`;
}

export async function gatewayFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers || {});
  const hasBody = options?.body !== undefined && options?.body !== null;
  if (hasBody && !headers.has('Content-Type') && !(options?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(joinGatewayPath(GATEWAY_URL, path), {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${path}: ${msg}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const payload = (await res.json()) as { error?: string; message?: string };
      detail = payload.error || payload.message || '';
    } catch {
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        detail = '';
      }
    }
    throw new Error(
      detail
        ? `Gateway error: ${res.status} ${res.statusText} - ${detail}`
        : `Gateway error: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

export function getWebSocketUrl(): string {
  return WS_URL;
}

export const api = {
  get: <T = any>(path: string, options?: RequestInit) => gatewayFetch<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body?: any, options?: RequestInit) => 
    gatewayFetch<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: <T = any>(path: string, body?: any, options?: RequestInit) => 
    gatewayFetch<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = any>(path: string, options?: RequestInit) => gatewayFetch<T>(path, { ...options, method: 'DELETE' }),
};

export { GATEWAY_URL, WS_URL };
