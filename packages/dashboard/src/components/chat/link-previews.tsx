'use client';

/**
 * @file packages/dashboard/src/components/chat/link-previews.tsx
 * @description Defines reusable UI components for the dashboard.
 */

import { gatewayFetch } from '@/lib/api';
import { clsx } from 'clsx';
import { ExternalLink, Globe } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { extractLinksFromMarkdown, sanitizeLinkUrl } from './markdown-utils';

interface LinkPreviewData {
  url: string;
  domain: string;
  title: string;
  description?: string;
  image?: string;
  favicon?: string;
}

const previewCache = new Map<string, LinkPreviewData>();
const pendingCache = new Map<string, Promise<LinkPreviewData>>();

export function LinkPreviewList({ content, max = 3 }: { content: string; max?: number }) {
  const links = useMemo(() => extractLinksFromMarkdown(content, max), [content, max]);
  const [previews, setPreviews] = useState<LinkPreviewData[]>([]);

  useEffect(() => {
    let active = true;
    if (links.length === 0) {
      setPreviews([]);
      return () => {
        active = false;
      };
    }

    void (async () => {
      const loaded = await Promise.all(links.map((url) => loadPreview(url)));
      if (!active) return;
      setPreviews(loaded);
    })();

    return () => {
      active = false;
    };
  }, [links.join('\n')]);

  if (previews.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {previews.map((preview) => (
        <a
          key={preview.url}
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className={clsx(
            'group flex items-start gap-3 rounded-lg border border-border-primary/70 bg-bg-primary/60 px-3 py-2.5',
            'transition-colors duration-150 hover:border-accent-primary/40 hover:bg-bg-primary',
          )}
        >
          <FaviconBadge favicon={preview.favicon} domain={preview.domain} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent-primary">
              {preview.title}
            </p>
            {preview.description && (
              <p
                className="mt-0.5 text-xs text-text-secondary"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {preview.description}
              </p>
            )}
            <p className="mt-1 text-[11px] text-text-muted">{preview.domain}</p>
          </div>
          {preview.image && (
            <img
              src={preview.image}
              alt=""
              className="h-12 w-20 shrink-0 rounded-md border border-border-primary/70 object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-accent-primary" />
        </a>
      ))}
    </div>
  );
}

function FaviconBadge({ favicon, domain }: { favicon?: string; domain: string }) {
  const [failed, setFailed] = useState(false);
  const safeFavicon = favicon ? sanitizeLinkUrl(favicon) : null;
  if (safeFavicon && !failed) {
    return (
      <img
        src={safeFavicon}
        alt=""
        className="mt-0.5 h-8 w-8 shrink-0 rounded-md border border-border-primary/80 bg-bg-secondary object-cover p-1"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-primary/80 bg-bg-secondary">
      <Globe className="h-3.5 w-3.5 text-text-tertiary" />
      <span className="sr-only">{domain}</span>
    </div>
  );
}

async function loadPreview(url: string): Promise<LinkPreviewData> {
  const cached = previewCache.get(url);
  if (cached) return cached;

  const pending = pendingCache.get(url);
  if (pending) return pending;

  const task = fetchPreview(url).finally(() => {
    pendingCache.delete(url);
  });

  pendingCache.set(url, task);
  const preview = await task;
  previewCache.set(url, preview);
  return preview;
}

async function fetchPreview(url: string): Promise<LinkPreviewData> {
  try {
    const response = await gatewayFetch<{
      url?: string;
      domain?: string;
      title?: string;
      description?: string;
      image?: string;
      favicon?: string;
    }>(`/api/link-preview?url=${encodeURIComponent(url)}`);

    return normalizePreviewResponse(url, response);
  } catch {
    return fallbackPreview(url);
  }
}

function normalizePreviewResponse(
  fallbackUrl: string,
  payload: {
    url?: string;
    domain?: string;
    title?: string;
    description?: string;
    image?: string;
    favicon?: string;
  },
): LinkPreviewData {
  const resolvedUrl = sanitizeLinkUrl(payload.url || '') || fallbackUrl;
  const fallback = fallbackPreview(resolvedUrl);

  return {
    url: resolvedUrl,
    domain: payload.domain?.trim() || fallback.domain,
    title: payload.title?.trim() || fallback.title,
    description: payload.description?.trim() || '',
    image: payload.image ? sanitizeLinkUrl(payload.image) || undefined : undefined,
    favicon: payload.favicon ? sanitizeLinkUrl(payload.favicon) || undefined : fallback.favicon,
  };
}

function fallbackPreview(rawUrl: string): LinkPreviewData {
  const safeUrl = sanitizeLinkUrl(rawUrl) || rawUrl;
  try {
    const parsed = new URL(safeUrl);
    return {
      url: parsed.toString(),
      domain: parsed.hostname,
      title: parsed.hostname,
      description: '',
      favicon: `${parsed.protocol}//${parsed.host}/favicon.ico`,
    };
  } catch {
    return {
      url: rawUrl,
      domain: rawUrl,
      title: rawUrl,
      description: '',
    };
  }
}
