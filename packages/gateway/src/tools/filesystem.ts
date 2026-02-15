/**
 * @file packages/gateway/src/tools/filesystem.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ToolDefinition } from '@adytum/shared';
import type { PermissionManager } from '../security/permission-manager.js';

/**
 * Creates file system tools.
 * @param permissionManager - Permission manager.
 * @returns The resulting collection of values.
 */
export function createFileSystemTools(permissionManager: PermissionManager): ToolDefinition[] {
  return [
    {
      name: 'file_read',
      description: 'Read the contents of a file. Paths are relative to the workspace root.',
      parameters: z.object({
        path: z.string().describe('File path relative to the workspace root'),
        encoding: z.string().default('utf-8').describe('File encoding'),
        workspaceId: z.string().optional().describe('Internal workspace ID'),
      }),
      execute: async (args: any) => {
        const { path, encoding, workspaceId } = args as {
          path: string;
          encoding: string;
          workspaceId?: string;
        };
        const resolved = permissionManager.validatePath(path, 'read', workspaceId);
        const content = readFileSync(resolved, encoding as BufferEncoding);
        return {
          path: resolved,
          content: content.slice(0, 50000), // Cap at 50k chars
          size: content.length,
          truncated: content.length > 50000,
        };
      },
    },
    {
      name: 'file_write',
      description:
        'Write content to a file. Creates parent directories if needed. Paths are relative to the workspace root.',
      parameters: z.object({
        path: z.string().describe('File path relative to the workspace root'),
        content: z.string().describe('Content to write'),
        createDirs: z.boolean().default(true).describe('Create parent directories if missing'),
        workspaceId: z.string().optional().describe('Internal workspace ID'),
      }),
      execute: async (args: any) => {
        const { path, content, createDirs, workspaceId } = args as {
          path: string;
          content: string;
          createDirs: boolean;
          workspaceId?: string;
        };
        const resolved = permissionManager.validatePath(path, 'write', workspaceId);

        if (createDirs) {
          const { dirname } = await import('node:path');
          mkdirSync(dirname(resolved), { recursive: true });
        }

        writeFileSync(resolved, content, 'utf-8');
        return { path: resolved, bytesWritten: Buffer.byteLength(content), success: true };
      },
    },
    {
      name: 'file_list',
      description:
        'List files and directories in a given path. Paths are relative to the workspace root. Use "." for the workspace root.',
      parameters: z.object({
        path: z
          .string()
          .describe('Directory path relative to the workspace root, or "." for workspace root'),
        recursive: z.boolean().default(false).describe('List recursively'),
        maxDepth: z.number().default(3).describe('Max depth for recursive listing'),
        workspaceId: z.string().optional().describe('Internal workspace ID'),
      }),
      execute: async (args: any) => {
        const { path, recursive, maxDepth, workspaceId } = args as {
          path: string;
          recursive: boolean;
          maxDepth: number;
          workspaceId?: string;
        };
        const resolved = permissionManager.validatePath(path, 'read', workspaceId);

        /**
         * Executes list dir.
         * @param dir - Dir.
         * @param depth - Depth.
         * @returns The resulting collection of values.
         */
        const listDir = (dir: string, depth: number): any[] => {
          if (depth > maxDepth) return [];
          const entries = readdirSync(dir, { withFileTypes: true });
          return entries
            .map((entry) => {
              const fullPath = join(dir, entry.name);
              const stat = statSync(fullPath);
              const item: Record<string, unknown> = {
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: stat.size,
              };
              if (recursive && entry.isDirectory()) {
                item.children = listDir(fullPath, depth + 1);
              }
              return item;
            })
            .slice(0, 100); // Cap at 100 entries per level
        };

        return { path: resolved, entries: listDir(resolved, 0) };
      },
    },
    {
      name: 'file_search',
      description:
        'Search for text within files in a directory. Paths are relative to the workspace root.',
      parameters: z.object({
        path: z.string().describe('Directory to search in, relative to the workspace root'),
        query: z.string().describe('Text or regex pattern to search for'),
        extensions: z.array(z.string()).optional().describe('File extensions to include'),
        maxResults: z.number().default(20).describe('Maximum number of results'),
        workspaceId: z.string().optional().describe('Internal workspace ID'),
      }),
      execute: async (args: any) => {
        const { path, query, extensions, maxResults, workspaceId } = args as {
          path: string;
          query: string;
          extensions?: string[];
          maxResults: number;
          workspaceId?: string;
        };
        const resolved = permissionManager.validatePath(path, 'read', workspaceId);
        const results: Array<{ file: string; line: number; content: string }> = [];
        const regex = new RegExp(query, 'gi');

        /**
         * Executes search dir.
         * @param dir - Dir.
         */
        const searchDir = (dir: string): void => {
          if (results.length >= maxResults) return;
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) return;
            const fullPath = join(dir, entry.name);
            if (
              entry.isDirectory() &&
              !entry.name.startsWith('.') &&
              entry.name !== 'node_modules'
            ) {
              searchDir(fullPath);
            } else if (entry.isFile()) {
              if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) continue;
              try {
                const content = readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (regex.test(lines[i])) {
                    results.push({ file: fullPath, line: i + 1, content: lines[i].trim() });
                    if (results.length >= maxResults) return;
                  }
                  regex.lastIndex = 0;
                }
              } catch {
                /* skip binary files */
              }
            }
          }
        };

        searchDir(resolved);
        return { path: resolved, query, resultCount: results.length, results };
      },
    },
  ];
}
