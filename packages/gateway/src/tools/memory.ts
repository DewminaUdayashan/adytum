/**
 * @file packages/gateway/src/tools/memory.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { MemoryStore } from '../infrastructure/repositories/memory-store.js';

/**
 * Creates memory tools.
 * @param memoryStore - Memory store.
 * @returns The resulting collection of values.
 */
export function createMemoryTools(memoryStore: MemoryStore): ToolDefinition[] {
  return [
    {
      name: 'memory_store',
      description: 'Store a persistent memory (fact, preference, or decision) for future sessions.',
      parameters: z.object({
        content: z.string().describe('Memory content to store'),
        tags: z.array(z.string()).optional().describe('Optional tags for the memory'),
        category: z
          .string()
          .optional()
          .describe(
            'Memory category (episodic_raw, episodic_summary, dream, monologue, curiosity, general, user_fact)',
          ),
      }),
      execute: async (args: any) => {
        const { content, tags, category } = args as {
          content: string;
          tags?: string[];
          category?: string;
        };
        const record = memoryStore.add(
          content,
          'user',
          tags,
          undefined,
          (category as any) || 'general',
        );
        return { success: true, memory: record };
      },
    },
    {
      name: 'memory_search',
      description: 'Search persistent memory using keyword overlap. Returns top matches.',
      parameters: z.object({
        query: z.string().describe('Search query'),
        topK: z.number().default(3).describe('Number of results to return'),
      }),
      execute: async (args: any) => {
        const { query, topK } = args as { query: string; topK: number };
        const results = memoryStore.search(query, topK);
        return { query, results };
      },
    },
    {
      name: 'memory_list',
      description: 'List recent persistent memories.',
      parameters: z.object({
        limit: z.number().default(20).describe('Number of memories to return'),
      }),
      execute: async (args: any) => {
        const { limit } = args as { limit: number };
        const results = memoryStore.list(limit);
        return { results };
      },
    },
  ];
}
