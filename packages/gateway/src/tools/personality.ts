import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { MemoryDB } from '../infrastructure/repositories/memory-db.js';

export function createPersonalityTools(memoryDb: MemoryDB): ToolDefinition[] {
  return [
    {
      name: 'update_soul',
      description: 'Propose an update to SOUL.md. The change is queued for approval.',
      parameters: z.object({
        content: z.string().describe('Proposed SOUL.md update or instruction'),
      }),
      execute: async (args: any) => {
        const { content } = args as { content: string };
        memoryDb.addPendingUpdate('soul', content);
        return { success: true, queued: true };
      },
    },
    {
      name: 'update_guidelines',
      description: 'Propose an update to GUIDELINES.md. The change is queued for approval.',
      parameters: z.object({
        content: z.string().describe('Proposed guideline update'),
      }),
      execute: async (args: any) => {
        const { content } = args as { content: string };
        memoryDb.addPendingUpdate('guidelines', content);
        return { success: true, queued: true };
      },
    },
  ];
}
