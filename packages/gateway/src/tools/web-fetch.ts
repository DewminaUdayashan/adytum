/**
 * @file packages/gateway/src/tools/web-fetch.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';

/**
 * Creates web fetch tool.
 * @returns The create web fetch tool result.
 */
export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns the text content of the response.',
    parameters: z.object({
      url: z.string().url().describe('The URL to fetch'),
      method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('Additional headers'),
      body: z.string().optional().describe('Request body (for POST)'),
      maxLength: z.number().default(20000).describe('Max response length in characters'),
    }),
    execute: async (args: any) => {
      const { url, method, headers, body, maxLength } = args as {
        url: string;
        method: string;
        headers?: Record<string, string>;
        body?: string;
        maxLength: number;
      };

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'User-Agent': 'Adytum/0.1.0',
            ...headers,
          },
          body: method === 'POST' ? body : undefined,
          signal: AbortSignal.timeout(15000),
        });

        const text = await response.text();

        // Strip HTML tags for cleaner output
        const cleaned = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          url,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type'),
          content: cleaned.slice(0, maxLength),
          truncated: cleaned.length > maxLength,
        };
      } catch (error: any) {
        return {
          url,
          error: error.message,
          status: 0,
        };
      }
    },
  };
}
