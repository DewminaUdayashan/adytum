import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { MemoryStore } from '../infrastructure/repositories/memory-store.js';

/**
 * Creates semantic search tools.
 * @param memoryStore - Memory store.
 * @returns The resulting collection of values.
 */
export function createSemanticTools(memoryStore: MemoryStore): ToolDefinition[] {
  return [
    {
      name: 'semantic_search',
      description:
        'Search for files and documents using natural language query (semantic search). Use this when you want to find code or logic by concept rather than exact text match.',
      parameters: z.object({
        query: z.string().describe('Natural language query describing what you are looking for'),
        maxResults: z.number().default(10).describe('Maximum number of results to return'),
        workspaceId: z.string().optional().describe('Internal workspace ID'),
      }),
      execute: async (args: any) => {
        const { query, maxResults } = args as {
          query: string;
          maxResults: number;
        };

        const results = await memoryStore.searchHybrid(query, maxResults, {
          category: 'doc_chunk',
        });

        const data = {
          query,
          count: results.length,
          results: results.map((r) => ({
            score: (r as any).score?.toFixed(3),
            path: (r.metadata as any)?.path || 'unknown',
            content: r.content,
            tags: r.tags,
          })),
        };

        return `
\`\`\`search-results
${JSON.stringify(data, null, 2)}
\`\`\`

Found ${results.length} relevant snippets for "${query}".
        `.trim();
      },
    },
  ];
}
