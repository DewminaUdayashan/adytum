import { z } from 'zod';

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  defaultParentPageId: z.string().optional(),
  defaultDatabaseId: z.string().optional(),
  notionVersion: z.string().default('2025-09-03'),
  baseUrl: z.string().default('https://api.notion.com'),
});

type Cfg = z.infer<typeof ConfigSchema>;

const SearchSchema = z.object({
  query: z.string().min(1).describe('Search query string'),
  pageSize: z.number().int().min(1).max(50).default(10).describe('Results page size (1-50)'),
});

const GetPageSchema = z.object({
  pageId: z.string().min(3).describe('Notion page id (with or without dashes)'),
});

const CreatePageSchema = z.object({
  title: z.string().min(1).describe('Page title'),
  parentId: z.string().optional().describe('Parent page id; falls back to defaultParentPageId'),
  databaseId: z
    .string()
    .optional()
    .describe('Database id to create in; falls back to defaultDatabaseId'),
  properties: z.record(z.unknown()).optional().describe('Optional Notion properties JSON'),
  children: z.array(z.record(z.unknown())).optional().describe('Optional block children array'),
});

const AppendBlocksSchema = z.object({
  pageId: z.string().min(3).describe('Page id to append blocks to'),
  children: z.array(z.record(z.unknown())).min(1).describe('Blocks array per Notion API'),
});

const notionPlugin = {
  id: 'notion',
  name: 'Notion',
  description: 'Create and search Notion pages and append blocks via the official API.',

  register(api: any) {
    const cfg = resolveConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info('Notion skill disabled (enabled=false)');
      return;
    }

    api.registerTool({
      name: 'notion_search',
      description: 'Search pages and databases in Notion.',
      parameters: SearchSchema,
      execute: (args: z.infer<typeof SearchSchema>) =>
        request(cfg, api, '/v1/search', 'POST', {
          query: args.query,
          page_size: args.pageSize,
        }),
    });

    api.registerTool({
      name: 'notion_get_page',
      description: 'Get a Notion page by id.',
      parameters: GetPageSchema,
      execute: (args: z.infer<typeof GetPageSchema>) =>
        request(cfg, api, `/v1/pages/${normalizeId(args.pageId)}`, 'GET'),
    });

    api.registerTool({
      name: 'notion_create_page',
      description: 'Create a page in a database or under a parent page.',
      parameters: CreatePageSchema,
      execute: (args: z.infer<typeof CreatePageSchema>) => {
        const parentId = normalizeId(args.parentId || cfg.defaultParentPageId || '');
        const databaseId = normalizeId(args.databaseId || cfg.defaultDatabaseId || '');
        const parent = databaseId
          ? { parent: { database_id: databaseId } }
          : parentId
            ? { parent: { page_id: parentId } }
            : { parent: { workspace: true } };
        const body = {
          ...parent,
          properties: args.properties || {
            title: {
              title: [
                {
                  text: { content: args.title },
                },
              ],
            },
          },
          children: args.children || [],
        };
        return request(cfg, api, '/v1/pages', 'POST', body);
      },
    });

    api.registerTool({
      name: 'notion_append_blocks',
      description: 'Append blocks to an existing page.',
      parameters: AppendBlocksSchema,
      execute: (args: z.infer<typeof AppendBlocksSchema>) =>
        request(cfg, api, `/v1/blocks/${normalizeId(args.pageId)}/children`, 'PATCH', {
          children: args.children,
        }),
    });
  },
};

export default notionPlugin;

function resolveConfig(raw: unknown): Cfg {
  const parsed = ConfigSchema.safeParse(raw || {});
  if (!parsed.success) return ConfigSchema.parse({});
  return parsed.data;
}

function normalizeId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.replace(/-/g, '').trim();
}

async function request(cfg: Cfg, api: any, path: string, method: string, body?: unknown) {
  const apiKey = cfg.apiKey || api.pluginConfig?.apiKey || process.env.NOTION_API_KEY;
  if (!apiKey) {
    return {
      error: 'Missing NOTION_API_KEY',
      guidance: 'Set skills.entries.notion.apiKey or env NOTION_API_KEY',
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': cfg.notionVersion || '2025-09-03',
    'Content-Type': 'application/json',
  };

  const url = `${cfg.baseUrl || 'https://api.notion.com'}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    return { error: `Notion API ${res.status}: ${res.statusText}`, detail: json };
  }

  return json;
}
