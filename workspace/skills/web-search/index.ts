import { z } from 'zod';
import type { AdytumSkillPluginApi, ToolDefinition } from '@adytum/shared';

type Provider = 'duckduckgo' | 'serper';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

async function ddgSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, kl: 'us-en' });
  const res = await fetch(`https://duckduckgo.com/html/?${params.toString()}`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Adytum-WebSearch/0.1',
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const results: SearchResult[] = [];
  const regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match && results.length < maxResults) {
    const url = match[1];
    const title = stripTags(decode(match[2])).trim();
    const snippet = stripTags(decode(match[3])).trim();
    results.push({ title, url, snippet });
    match = regex.exec(html);
  }
  return results;
}

async function serperSearch(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  const payload = { q: query, gl: 'us', hl: 'en', num: maxResults };
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      'User-Agent': 'Adytum-WebSearch/0.1',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`serper error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as any;
  const organic = Array.isArray(json.organic) ? json.organic : [];
  return organic.slice(0, maxResults).map((entry: any) => ({
    title: String(entry.title || entry.link || ''),
    url: String(entry.link || ''),
    snippet: String(entry.snippet || ''),
  }));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function createTools(api: AdytumSkillPluginApi): ToolDefinition[] {
  const cfg = api.pluginConfig || {};
  const provider = (cfg.provider as Provider) || 'duckduckgo';
  const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
  const maxResults = typeof cfg.maxResults === 'number' ? cfg.maxResults : 5;
  const rotations = typeof cfg.rotations === 'number' ? cfg.rotations : 2;
  const maxTokens = typeof cfg.maxTokens === 'number' ? cfg.maxTokens : 6000;

  const searchTool: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web and return top results with titles, URLs, and snippets.',
    parameters: z.object({
      query: z.string(),
      maxResults: z.number().int().min(1).max(20).default(maxResults),
      provider: z.enum(['duckduckgo', 'serper']).optional(),
    }),
    execute: async (args: any) => {
      const q = String(args.query || '').trim();
      const limit = Number(args.maxResults || maxResults);
      const p = (args.provider as Provider) || provider;
      if (!q) return { results: [], tokens: 0 };
      const selectedProvider = p;
      if (selectedProvider === 'serper') {
        if (!apiKey) {
          return { error: 'serper provider selected but no apiKey configured', results: [] };
        }
        const results = await serperSearch(q, apiKey, limit);
        const tokens = approxTokens(results.map((r) => r.snippet || r.title).join(' '));
        return { provider: 'serper', results, tokens };
      }
      const results = await ddgSearch(q, limit);
      const tokens = approxTokens(results.map((r) => r.snippet || r.title).join(' '));
      return { provider: 'duckduckgo', results, tokens };
    },
  };

  const surfTool: ToolDefinition = {
    name: 'web_surf',
    description:
      'Search and then fetch top pages, returning condensed text. Respects rotations (depth) and token budget.',
    parameters: z.object({
      query: z.string(),
      maxResults: z.number().int().min(1).max(10).default(Math.min(3, maxResults)),
      rotations: z.number().int().min(0).max(4).default(rotations),
      maxTokens: z.number().int().default(maxTokens),
    }),
    execute: async (args: any) => {
      const q = String(args.query || '').trim();
      const limit = Number(args.maxResults || Math.min(3, maxResults));
      const hopLimit = Number(args.rotations || rotations);
      const tokenBudget = Number(args.maxTokens || maxTokens);
      if (!q) return { pages: [], tokens: 0 };
      const results =
        provider === 'serper' && apiKey
          ? await serperSearch(q, apiKey, limit)
          : await ddgSearch(q, limit);

      const pages: Array<{ url: string; title: string; snippet: string; content: string }> = [];
      let tokensUsed = 0;

      for (const result of results) {
        if (!result.url) continue;
        if (tokensUsed >= tokenBudget) break;

        const resp = await fetch(result.url, {
          headers: { 'User-Agent': 'Adytum-WebSearch/0.1' },
          signal: AbortSignal.timeout(12000),
        }).catch(() => null);
        if (!resp || !resp.ok) continue;
        const html = await resp.text();
        const text = stripTags(html).replace(/\s+/g, ' ').trim();
        const content = text.slice(0, 4000);
        tokensUsed += approxTokens(content);
        pages.push({
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          content,
        });
        if (pages.length >= hopLimit + 1) break;
      }

      return {
        provider: apiKey ? provider : 'duckduckgo',
        pages,
        tokens: tokensUsed,
      };
    },
  };

  return [searchTool, surfTool];
}

export async function register(api: AdytumSkillPluginApi) {
  for (const tool of createTools(api)) {
    api.registerTool(tool);
  }
}
