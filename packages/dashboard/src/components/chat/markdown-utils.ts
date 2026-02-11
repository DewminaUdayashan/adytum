const MARKDOWN_LINK_REGEX = /\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const AUTO_LINK_REGEX = /https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"]/g;

export function sanitizeLinkUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractLinksFromMarkdown(content: string, max = 4): string[] {
  if (!content.trim()) return [];

  const urls = new Set<string>();

  for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
    const candidate = sanitizeLinkUrl(stripTrailingPunctuation(match[1] || ''));
    if (candidate) {
      urls.add(candidate);
      if (urls.size >= max) return Array.from(urls);
    }
  }

  for (const match of content.matchAll(AUTO_LINK_REGEX)) {
    const candidate = sanitizeLinkUrl(stripTrailingPunctuation(match[0] || ''));
    if (candidate) {
      urls.add(candidate);
      if (urls.size >= max) return Array.from(urls);
    }
  }

  return Array.from(urls);
}

export function stripTrailingPunctuation(value: string): string {
  let current = value.trim();

  while (current.length > 0) {
    const tail = current[current.length - 1];

    if (tail === ')' && !hasUnbalancedClosingParen(current)) break;
    if (!/[),.!?;:'"]/.test(tail)) break;

    current = current.slice(0, -1);
  }

  return current;
}

function hasUnbalancedClosingParen(value: string): boolean {
  const opens = (value.match(/\(/g) || []).length;
  const closes = (value.match(/\)/g) || []).length;
  return closes > opens;
}
