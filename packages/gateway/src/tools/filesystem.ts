/**
 * @file packages/gateway/src/tools/filesystem.ts
 * @description Defines tool handlers exposed to the runtime.
 */

import { z } from 'zod';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import type { ToolDefinition } from '@adytum/shared';
import type { PermissionManager } from '../security/permission-manager.js';

const execFileAsync = promisify(execFile);
const FILE_READ_MAX_CHARS = 50000;

type PdfExtractionResult = {
  content: string;
  extractor: 'pdftotext' | 'pypdf' | 'mdls' | 'ocr_tesseract' | 'strings';
};

/**
 * Executes run extractor.
 * @param name - Name.
 * @param args - Args.
 * @returns The run extractor result.
 */
async function runExtractor(name: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(name, args, {
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
    });
    return typeof stdout === 'string' ? stdout : '';
  } catch (error: any) {
    // Missing binary / unsupported environment should silently fall through to next extractor.
    if (error?.code === 'ENOENT' || error?.code === 127) return null;
    return null;
  }
}

/**
 * Executes normalize extracted text.
 * @param value - Value.
 * @returns The normalize extracted text result.
 */
function normalizeExtractedText(value: string | null): string {
  if (!value) return '';
  const normalized = value.replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
  if (!normalized || normalized === '(null)') return '';
  return normalized;
}

/**
 * Determines whether is meaningful extraction.
 * @param text - Text.
 * @returns True when is meaningful extraction.
 */
function isMeaningfulExtraction(text: string): boolean {
  if (!text) return false;
  const stripped = text.replace(/\s+/g, ' ').trim();
  return stripped.length >= 40;
}

/**
 * Executes parse page index.
 * @param fileName - File name.
 * @returns The parse page index result.
 */
function parsePageIndex(fileName: string): number {
  const match = fileName.match(/-(\d+)\.png$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

/**
 * Executes extract pdf text via ocr.
 * @param filePath - File path.
 * @returns The extract pdf text via ocr result.
 */
async function extractPdfTextViaOcr(filePath: string): Promise<string | null> {
  const tempPrefix = join(tmpdir(), 'adytum-pdf-ocr-');
  const tempDir = mkdtempSync(tempPrefix);
  const imagePrefix = join(tempDir, 'page');

  try {
    await execFileAsync(
      'pdftoppm',
      ['-f', '1', '-l', '8', '-r', '220', '-png', filePath, imagePrefix],
      {
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LANG: 'en_US.UTF-8' },
      },
    );

    const pageImages = readdirSync(tempDir)
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => parsePageIndex(a) - parsePageIndex(b));

    if (pageImages.length === 0) return null;

    const pageTexts: string[] = [];
    for (const image of pageImages) {
      const imagePath = join(tempDir, image);
      try {
        const { stdout } = await execFileAsync(
          'tesseract',
          [imagePath, 'stdout', '-l', 'eng', '--psm', '6'],
          {
            timeout: 30000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, LANG: 'en_US.UTF-8' },
          },
        );
        const normalized = normalizeExtractedText(stdout);
        if (normalized) pageTexts.push(normalized);
      } catch (error: any) {
        if (error?.code === 'ENOENT' || error?.code === 127) return null;
        // Continue with remaining pages when OCR fails for a single page.
      }
    }

    if (pageTexts.length === 0) return null;
    return pageTexts.join('\n\n');
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 127) return null;
    return null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Executes extract pdf text.
 * @param filePath - File path.
 * @returns The extract pdf text result.
 */
async function extractPdfText(filePath: string): Promise<PdfExtractionResult> {
  const pdftotextOutput = normalizeExtractedText(
    await runExtractor('pdftotext', ['-layout', '-enc', 'UTF-8', '-nopgbrk', filePath, '-']),
  );
  if (isMeaningfulExtraction(pdftotextOutput)) {
    return { content: pdftotextOutput, extractor: 'pdftotext' };
  }

  const pythonScript = [
    'import sys',
    'from pathlib import Path',
    'pdf_path = Path(sys.argv[1])',
    'try:',
    '    import pypdf',
    'except Exception:',
    '    sys.exit(3)',
    'try:',
    '    reader = pypdf.PdfReader(str(pdf_path))',
    '    parts = []',
    '    for page in reader.pages:',
    '        txt = page.extract_text() or ""',
    '        if txt.strip():',
    '            parts.append(txt)',
    '    sys.stdout.write("\\n\\n".join(parts))',
    'except Exception:',
    '    sys.exit(4)',
  ].join('\n');
  const pypdfOutput = normalizeExtractedText(
    await runExtractor('python3', ['-c', pythonScript, filePath]),
  );
  if (isMeaningfulExtraction(pypdfOutput)) {
    return { content: pypdfOutput, extractor: 'pypdf' };
  }

  const mdlsOutput = normalizeExtractedText(
    await runExtractor('mdls', ['-raw', '-name', 'kMDItemTextContent', filePath]),
  );
  if (isMeaningfulExtraction(mdlsOutput)) {
    return { content: mdlsOutput, extractor: 'mdls' };
  }

  const ocrOutput = normalizeExtractedText(await extractPdfTextViaOcr(filePath));
  if (isMeaningfulExtraction(ocrOutput)) {
    return { content: ocrOutput, extractor: 'ocr_tesseract' };
  }

  const stringsRaw = normalizeExtractedText(await runExtractor('strings', ['-n', '6', filePath]));
  if (stringsRaw) {
    const lines = stringsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 20)
      .slice(0, 4000);
    const stringsOutput = normalizeExtractedText(lines.join('\n'));
    if (isMeaningfulExtraction(stringsOutput)) {
      return { content: stringsOutput, extractor: 'strings' };
    }
  }

  throw new Error(
    'Unable to extract readable text from PDF. Install "pdftotext" (poppler) or OCR tools ("pdftoppm" + "tesseract"), or provide a text/markdown export.',
  );
}

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

        if (extname(resolved).toLowerCase() === '.pdf') {
          const extracted = await extractPdfText(resolved);
          const content = extracted.content.slice(0, FILE_READ_MAX_CHARS);
          return {
            path: resolved,
            content,
            size: extracted.content.length,
            truncated: extracted.content.length > FILE_READ_MAX_CHARS,
            format: 'pdf',
            extractor: extracted.extractor,
          };
        }

        const content = readFileSync(resolved, encoding as BufferEncoding);
        return {
          path: resolved,
          content: content.slice(0, FILE_READ_MAX_CHARS),
          size: content.length,
          truncated: content.length > FILE_READ_MAX_CHARS,
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
