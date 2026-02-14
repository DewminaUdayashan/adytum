import { z } from 'zod';

const SEARCH_PROVIDERS = ['duckduckgo', 'serpapi', 'searxng'] as const;
type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

const DEFAULT_BLOCKED_DOMAINS = [
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
];

const WebSurfConfigSchema = z.object({
  enabled: z.boolean().default(true),
  searchProvider: z.enum(SEARCH_PROVIDERS).default('duckduckgo'),
  serpApiKey: z.string().optional(),
  serpApiKeyEnv: z.string().default('SERPAPI_API_KEY'),
  searxngBaseUrl: z.string().default('http://localhost:8080'),
  defaultMaxResults: z.number().int().min(1).max(20).default(8),
  defaultMaxPages: z.number().int().min(1).max(12).default(4),
  defaultRotations: z.number().int().min(1).max(6).default(2),
  maxTotalExtractChars: z.number().int().min(2_000).max(200_000).default(28_000),
  maxExtractCharsPerPage: z.number().int().min(500).max(50_000).default(7_000),
  requestTimeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
  blockPrivateIps: z.boolean().default(true),
  safeDomains: z.array(z.string()).default([]),
  blockedDomains: z.array(z.string()).default(DEFAULT_BLOCKED_DOMAINS),
  userAgent: z.string().default('Adytum-WebSurf/0.1'),
  includeSearchSnippetsInContext: z.boolean().default(true),
});

type WebSurfConfig = z.infer<typeof WebSurfConfigSchema>;

type WebLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  domain: string;
}

interface SearchReport {
  provider: SearchProvider;
  query: string;
  results: SearchResult[];
  warnings: string[];
}

interface PageReport {
  url: string;
  domain: string;
  title?: string;
  status: number;
  contentType?: string;
  charsUsed: number;
  approxTokens: number;
  excerpt: string;
  content?: string;
  error?: string;
}

const WebSearchSchema = z.object({
  query: z.string().min(2).describe('Search query'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of search results'),
  focusDomains: z
    .array(z.string())
    .optional()
    .describe('Optional domain allowlist for this search, e.g. ["developer.mozilla.org"]'),
});

const WebFetchPageSchema = z.object({
  url: z.string().url().describe('Page URL to fetch'),
  maxChars: z.number().int().min(200).max(50_000).optional().describe('Max characters to extract'),
  focusDomains: z
    .array(z.string())
    .optional()
    .describe('Optional per-call domain allowlist for safety'),
});

const WebSurfSchema = z.object({
  query: z.string().min(2).describe('Research query'),
  goal: z.string().optional().describe('Optional research intent to guide rotations'),
  rotations: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe('How many search rotations to perform'),
  maxResults: z.number().int().min(1).max(20).optional().describe('Results per rotation'),
  maxPages: z.number().int().min(1).max(12).optional().describe('How many pages to open and read'),
  maxChars: z
    .number()
    .int()
    .min(2_000)
    .max(200_000)
    .optional()
    .describe('Total extraction budget in characters (rough token burn control)'),
  includeRawText: z
    .boolean()
    .default(false)
    .describe('Include full extracted text in the response (can be large)'),
  focusDomains: z.array(z.string()).optional().describe('Optional domain allowlist for this run'),
});

class WebSurfEngine {
  private config: WebSurfConfig;

  constructor(
    rawConfig: unknown,
    private logger: WebLogger,
  ) {
    this.config = resolveConfig(rawConfig);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async searchOnly(args: z.infer<typeof WebSearchSchema>): Promise<any> {
    const maxResults = clampInteger(args.maxResults, 1, 20, this.config.defaultMaxResults);

    const searchReport = await this.searchWithFallback(args.query, maxResults);
    const filtered = this.filterResultsByDomains(searchReport.results, args.focusDomains);

    return {
      query: args.query,
      provider: searchReport.provider,
      resultCount: filtered.length,
      warnings: searchReport.warnings,
      results: filtered.map((result, index) => ({
        rank: index + 1,
        title: result.title,
        url: result.url,
        domain: result.domain,
        snippet: result.snippet || '',
      })),
    };
  }

  async fetchSinglePage(args: z.infer<typeof WebFetchPageSchema>): Promise<any> {
    const maxChars = clampInteger(
      args.maxChars,
      200,
      this.config.maxExtractCharsPerPage,
      Math.min(this.config.maxExtractCharsPerPage, 5_000),
    );

    const page = await this.fetchPage(args.url, maxChars, args.focusDomains);
    return {
      ...page,
      budget: {
        maxChars,
      },
    };
  }

  async surf(args: z.infer<typeof WebSurfSchema>): Promise<any> {
    const rotations = clampInteger(args.rotations, 1, 6, this.config.defaultRotations);
    const maxResults = clampInteger(args.maxResults, 1, 20, this.config.defaultMaxResults);
    const maxPages = clampInteger(args.maxPages, 1, 12, this.config.defaultMaxPages);
    const maxCharsBudget = clampInteger(
      args.maxChars,
      2_000,
      this.config.maxTotalExtractChars,
      this.config.maxTotalExtractChars,
    );

    const queries = buildRotationQueries(args.query, args.goal, rotations);

    const searches: Array<{
      rotation: number;
      query: string;
      provider: SearchProvider;
      warnings: string[];
      results: Array<{ title: string; url: string; domain: string; snippet: string }>;
    }> = [];

    const deduped = new Map<string, { result: SearchResult; rotation: number; query: string }>();

    for (let i = 0; i < queries.length; i += 1) {
      const query = queries[i];
      const report = await this.searchWithFallback(query, maxResults);
      const filtered = this.filterResultsByDomains(report.results, args.focusDomains);

      searches.push({
        rotation: i + 1,
        query,
        provider: report.provider,
        warnings: report.warnings,
        results: filtered.map((entry) => ({
          title: entry.title,
          url: entry.url,
          domain: entry.domain,
          snippet: entry.snippet || '',
        })),
      });

      for (const result of filtered) {
        const key = normalizeUrlForDedup(result.url);
        if (!key || deduped.has(key)) continue;
        deduped.set(key, {
          result,
          rotation: i + 1,
          query,
        });
      }
    }

    const candidates = Array.from(deduped.values()).slice(0, maxPages);

    const pages: Array<PageReport & { sourceQuery: string; sourceRotation: number }> = [];
    let charsUsed = 0;
    let budgetHit = false;

    for (const candidate of candidates) {
      const remaining = maxCharsBudget - charsUsed;
      if (remaining <= 0) {
        budgetHit = true;
        break;
      }

      const pageCharBudget = Math.min(this.config.maxExtractCharsPerPage, remaining);
      const report = await this.fetchPage(candidate.result.url, pageCharBudget, args.focusDomains);

      pages.push({
        ...report,
        sourceQuery: candidate.query,
        sourceRotation: candidate.rotation,
      });

      charsUsed += report.charsUsed;
      if (charsUsed >= maxCharsBudget) {
        budgetHit = true;
        break;
      }
    }

    const successfulPages = pages.filter((page) => !page.error && page.charsUsed > 0);

    const contextBlocks = successfulPages.map((page, index) => {
      const header = `[${index + 1}] ${page.title || 'Untitled'}\nURL: ${page.url}\nDomain: ${page.domain}\nFrom query: ${page.sourceQuery}`;
      if (!args.includeRawText) {
        return `${header}\nExcerpt: ${page.excerpt}`;
      }
      return `${header}\n\n${page.content || page.excerpt}`;
    });

    if (!args.includeRawText && this.config.includeSearchSnippetsInContext) {
      const snippetBlocks = candidates
        .slice(0, maxPages)
        .map((candidate, index) => {
          const snippet = candidate.result.snippet || '';
          if (!snippet) return null;
          return `[S${index + 1}] ${candidate.result.title}\nURL: ${candidate.result.url}\nSnippet: ${snippet}`;
        })
        .filter((entry): entry is string => Boolean(entry));
      if (snippetBlocks.length > 0) {
        contextBlocks.push('Search snippets:\n' + snippetBlocks.join('\n\n'));
      }
    }

    return {
      query: args.query,
      goal: args.goal || null,
      budget: {
        rotations,
        maxResultsPerRotation: maxResults,
        maxPages,
        maxChars: maxCharsBudget,
        maxCharsPerPage: this.config.maxExtractCharsPerPage,
      },
      usage: {
        searchedQueries: searches.length,
        uniqueResults: deduped.size,
        pagesVisited: pages.length,
        successfulPages: successfulPages.length,
        charsUsed,
        approxTokensUsed: approximateTokens(charsUsed),
        budgetHit,
      },
      searches,
      pages,
      citations: successfulPages.map((page) => page.url),
      combinedContext: contextBlocks.join('\n\n---\n\n'),
      guidance:
        successfulPages.length === 0
          ? 'No readable pages were fetched. Try a broader query, adjust focusDomains, or change provider config.'
          : 'Use citations when answering and mention uncertainty when evidence conflicts.',
    };
  }

  private async searchWithFallback(query: string, limit: number): Promise<SearchReport> {
    const preferred = this.config.searchProvider;
    const order = [preferred, ...SEARCH_PROVIDERS.filter((provider) => provider !== preferred)];

    const warnings: string[] = [];

    for (const provider of order) {
      try {
        const results = await this.searchByProvider(provider, query, limit);
        if (results.length > 0) {
          if (provider !== preferred) {
            warnings.push(
              `Configured provider \"${preferred}\" returned no results; used \"${provider}\" fallback.`,
            );
          }
          return { provider, query, results, warnings };
        }
        warnings.push(`Provider \"${provider}\" returned no results.`);
      } catch (error: any) {
        warnings.push(`Provider \"${provider}\" failed: ${error?.message || String(error)}`);
      }
    }

    return {
      provider: preferred,
      query,
      results: [],
      warnings,
    };
  }

  private async searchByProvider(
    provider: SearchProvider,
    query: string,
    limit: number,
  ): Promise<SearchResult[]> {
    switch (provider) {
      case 'duckduckgo':
        return this.searchDuckDuckGo(query, limit);
      case 'serpapi':
        return this.searchSerpApi(query, limit);
      case 'searxng':
        return this.searchSearxng(query, limit);
      default:
        return [];
    }
  }

  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.config.userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`duckduckgo status ${response.status}`);
    }

    const html = await response.text();
    const anchors =
      /<a[^>]*class=\"[^\"]*result__a[^\"]*\"[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/gi;

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = anchors.exec(html)) && results.length < limit) {
      const href = decodeHtmlEntities(match[1] || '');
      const resolved = resolveDuckDuckGoHref(href);
      if (!resolved) continue;

      const normalizedKey = normalizeUrlForDedup(resolved);
      if (!normalizedKey || seen.has(normalizedKey)) continue;

      const host = safeHostname(resolved);
      if (!host) continue;

      const title = cleanTextFragment(match[2] || '');
      const region = html.slice(match.index, match.index + 2_000);
      const snippetMatch = region.match(
        /class=\"[^\"]*result__snippet[^\"]*\"[^>]*>([\s\S]*?)<\/(?:a|span)>/i,
      );
      const snippet = cleanTextFragment(snippetMatch?.[1] || '');

      results.push({
        title: title || resolved,
        url: resolved,
        snippet,
        domain: host,
      });

      seen.add(normalizedKey);
    }

    return results;
  }

  private async searchSerpApi(query: string, limit: number): Promise<SearchResult[]> {
    const apiKey = this.config.serpApiKey || readEnv(this.config.serpApiKeyEnv);
    if (!apiKey) {
      throw new Error(
        `SERPAPI key is missing. Set skills.entries.web-surf.config.serpApiKey or ${this.config.serpApiKeyEnv}.`,
      );
    }

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(limit));
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': this.config.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`serpapi status ${response.status}`);
    }

    const payload = (await response.json()) as {
      organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    };

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const item of payload.organic_results || []) {
      if (!item.link) continue;
      const key = normalizeUrlForDedup(item.link);
      if (!key || seen.has(key)) continue;
      const host = safeHostname(item.link);
      if (!host) continue;

      results.push({
        title: item.title?.trim() || item.link,
        url: item.link,
        snippet: item.snippet?.trim() || '',
        domain: host,
      });

      seen.add(key);
      if (results.length >= limit) break;
    }

    return results;
  }

  private async searchSearxng(query: string, limit: number): Promise<SearchResult[]> {
    const base = this.config.searxngBaseUrl.trim().replace(/\/$/, '');
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.config.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`searxng status ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const item of payload.results || []) {
      if (!item.url) continue;
      const key = normalizeUrlForDedup(item.url);
      if (!key || seen.has(key)) continue;
      const host = safeHostname(item.url);
      if (!host) continue;

      results.push({
        title: item.title?.trim() || item.url,
        url: item.url,
        snippet: item.content?.trim() || '',
        domain: host,
      });

      seen.add(key);
      if (results.length >= limit) break;
    }

    return results;
  }

  private filterResultsByDomains(results: SearchResult[], focusDomains?: string[]): SearchResult[] {
    if (!focusDomains || focusDomains.length === 0) return results;
    const clean = focusDomains.map((entry) => normalizeDomain(entry)).filter(Boolean);
    if (clean.length === 0) return results;

    return results.filter((result) => matchesDomainList(result.domain, clean));
  }

  private async fetchPage(
    rawUrl: string,
    maxChars: number,
    focusDomains?: string[],
  ): Promise<PageReport> {
    const normalized = this.normalizeAndValidateUrl(rawUrl, focusDomains);
    if (!normalized.ok) {
      return {
        url: rawUrl,
        domain: safeHostname(rawUrl) || 'unknown',
        status: 0,
        charsUsed: 0,
        approxTokens: 0,
        excerpt: '',
        error: normalized.error,
      };
    }

    try {
      const response = await fetch(normalized.url, {
        method: 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      const contentType = response.headers.get('content-type') || undefined;
      const raw = await response.text();

      const extracted =
        contentType && contentType.includes('application/json')
          ? extractJsonText(raw)
          : extractTextContent(raw);

      const sliced = extracted.slice(0, maxChars);
      const title = extractTitle(raw);

      return {
        url: normalized.url,
        domain: normalized.domain,
        title,
        status: response.status,
        contentType,
        charsUsed: sliced.length,
        approxTokens: approximateTokens(sliced.length),
        excerpt: sliced.slice(0, 500),
        content: sliced,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        url: normalized.url,
        domain: normalized.domain,
        status: 0,
        charsUsed: 0,
        approxTokens: 0,
        excerpt: '',
        error: error?.message || String(error),
      };
    }
  }

  private normalizeAndValidateUrl(
    rawUrl: string,
    focusDomains?: string[],
  ): { ok: true; url: string; domain: string } | { ok: false; error: string } {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { ok: false, error: 'Invalid URL' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: `Unsupported URL protocol: ${parsed.protocol}` };
    }

    const domain = normalizeDomain(parsed.hostname);
    if (!domain) {
      return { ok: false, error: 'Could not resolve URL hostname' };
    }

    if (this.config.blockPrivateIps && isPrivateOrLocalHost(domain)) {
      return { ok: false, error: `Blocked private/local host: ${domain}` };
    }

    const blocked = this.config.blockedDomains
      .map((entry) => normalizeDomain(entry))
      .filter(Boolean);
    if (blocked.length > 0 && matchesDomainList(domain, blocked)) {
      return { ok: false, error: `Blocked domain: ${domain}` };
    }

    const safe = this.config.safeDomains.map((entry) => normalizeDomain(entry)).filter(Boolean);
    if (safe.length > 0 && !matchesDomainList(domain, safe)) {
      return { ok: false, error: `Domain not in safeDomains allowlist: ${domain}` };
    }

    const focus = (focusDomains || []).map((entry) => normalizeDomain(entry)).filter(Boolean);
    if (focus.length > 0 && !matchesDomainList(domain, focus)) {
      return { ok: false, error: `Domain not in focusDomains allowlist: ${domain}` };
    }

    parsed.hash = '';
    return {
      ok: true,
      url: parsed.toString(),
      domain,
    };
  }
}

function resolveConfig(rawConfig: unknown): WebSurfConfig {
  const parsed = WebSurfConfigSchema.parse(rawConfig || {});
  return {
    ...parsed,
    searchProvider: parsed.searchProvider,
    safeDomains: uniqueNormalized(parsed.safeDomains),
    blockedDomains: uniqueNormalized(parsed.blockedDomains),
  };
}

function buildRotationQueries(
  query: string,
  goal: string | undefined,
  rotations: number,
): string[] {
  const base = query.trim();
  if (!base) return [];

  const variants = [base];
  const suffixes = [
    'official documentation',
    'latest updates',
    'deep dive',
    'practical guide',
    'comparison',
  ];

  for (let i = 1; i < rotations; i += 1) {
    if (goal && i === 1) {
      variants.push(`${base} ${goal}`.trim());
      continue;
    }
    variants.push(`${base} ${suffixes[(i - 1) % suffixes.length]}`.trim());
  }

  return Array.from(new Set(variants));
}

function normalizeUrlForDedup(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function resolveDuckDuckGoHref(rawHref: string): string | null {
  if (!rawHref) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawHref, 'https://duckduckgo.com');
  } catch {
    return null;
  }

  if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      try {
        return decodeURIComponent(uddg);
      } catch {
        return uddg;
      }
    }
  }

  return parsed.toString();
}

function safeHostname(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

function matchesDomainList(domain: string, list: string[]): boolean {
  const normalized = normalizeDomain(domain);
  return list.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = normalizeDomain(hostname);
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const bytes = ipv4.slice(1).map((entry) => Number(entry));
  if (bytes.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return true;

  const [a, b] = bytes;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 0) return true;
  return false;
}

function extractTextContent(input: string): string {
  const stripped = input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return cleanTextFragment(stripped);
}

function extractJsonText(input: string): string {
  try {
    const parsed = JSON.parse(input);
    return cleanTextFragment(JSON.stringify(parsed, null, 2));
  } catch {
    return cleanTextFragment(input);
  }
}

function extractTitle(input: string): string | undefined {
  const titleMatch = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return undefined;
  const value = cleanTextFragment(titleMatch[1] || '');
  return value || undefined;
}

function cleanTextFragment(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num) : _m;
    });
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function uniqueNormalized(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => normalizeDomain(entry)).filter(Boolean)));
}

function approximateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value || !value.trim()) return undefined;
  return value.trim();
}

const webSurfPlugin = {
  id: 'web-surf',
  name: 'Web Surf',
  description:
    'Autonomous web research skill with search + crawl + configurable extraction budgets.',

  register(api: any) {
    const engine = new WebSurfEngine(api.pluginConfig, api.logger);

    api.registerTool({
      name: 'web_search',
      description:
        'Search the web for a query and return ranked results. Use this when you need URLs before reading pages.',
      parameters: WebSearchSchema,
      execute: async (args: z.infer<typeof WebSearchSchema>) => {
        if (!engine.isEnabled()) {
          return 'web-surf skill is disabled in config';
        }
        return engine.searchOnly(args);
      },
    });

    api.registerTool({
      name: 'web_fetch_page',
      description:
        'Fetch and extract readable text from a single web page with configurable size and domain safety checks.',
      parameters: WebFetchPageSchema,
      execute: async (args: z.infer<typeof WebFetchPageSchema>) => {
        if (!engine.isEnabled()) {
          return 'web-surf skill is disabled in config';
        }
        return engine.fetchSinglePage(args);
      },
    });

    api.registerTool({
      name: 'web_surf',
      description:
        'Run autonomous web research: rotate queries, collect results, open pages, and return combined evidence with citations.',
      parameters: WebSurfSchema,
      execute: async (args: z.infer<typeof WebSurfSchema>) => {
        if (!engine.isEnabled()) {
          return 'web-surf skill is disabled in config';
        }
        return engine.surf(args);
      },
    });
  },
};

export default webSurfPlugin;
