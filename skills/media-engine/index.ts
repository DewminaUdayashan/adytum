/**
 * @file skills/media-engine/index.ts
 * @description Skill for on-demand processing of archives and complex media.
 */

import { z } from 'zod';
import { container } from 'tsyringe';
import AdmZip from 'adm-zip';
import { join, basename, extname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { ConfigService } from '../../packages/gateway/src/infrastructure/config/config-service.js';
import { logger } from '../../packages/gateway/src/logger.js';

export default {
  tools: [
    {
      name: 'list_archive',
      description: 'Lists the contents of a ZIP or similar archive without extracting.',
      parameters: z.object({
        path: z.string().describe('Relative path to the archive file.'),
      }),
      async execute({ path }: { path: string }) {
        const configService = container.resolve(ConfigService);
        const workspacePath = configService.get('workspacePath');
        const fullPath = join(workspacePath, path);

        if (!existsSync(fullPath)) {
          return { error: `Archive not found at ${path}` };
        }

        try {
          const zip = new AdmZip(fullPath);
          const entries = zip.getEntries().map(e => ({
            name: e.entryName,
            size: e.header.size,
            isDirectory: e.isDirectory
          }));
          return { name: basename(path), entries };
        } catch (err: any) {
          return { error: `Failed to read archive: ${err.message}` };
        }
      },
    },
    {
      name: 'extract_zip',
      description: 'Extracts a ZIP archive to a managed hidden directory in the workspace.',
      parameters: z.object({
        path: z.string().describe('Relative path to the ZIP file.'),
      }),
      async execute({ path }: { path: string }) {
        const configService = container.resolve(ConfigService);
        const workspacePath = configService.get('workspacePath');
        const fullPath = join(workspacePath, path);
        const extractBase = join(workspacePath, '.adytum_extracted');
        const targetDir = join(extractBase, basename(path, extname(path)));

        if (!existsSync(fullPath)) {
          return { error: `Archive not found at ${path}` };
        }

        try {
          mkdirSync(targetDir, { recursive: true });
          const zip = new AdmZip(fullPath);
          zip.extractAllTo(targetDir, true);
          
          return { 
            success: true, 
            message: `Extracted ${path} to managed directory.`,
            extraction_path: targetDir,
            note: 'You can now use list_dir and read_file on this path.'
          };
        } catch (err: any) {
          return { error: `Extraction failed: ${err.message}` };
        }
      },
    }
  ],
};
