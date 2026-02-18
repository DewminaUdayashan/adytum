/**
 * @file packages/gateway/src/tools/interaction.ts
 * @description Tools for user interaction.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { UserInteractionService } from '../application/services/user-interaction-service.js';

export function createInteractionTools(
  interactionService: UserInteractionService, 
  agentId: string,
  context?: { sessionId?: string; workspaceId?: string }
): ToolDefinition[] {
  return [
    {
      name: 'ask_user',
      description:
        'Ask the user a question or request input. Execution pauses until the user responds. Use this when you are stuck, need clarification, or need a decision/approval that existing tools cannot provide.',
      parameters: z.object({
        question: z.string().describe('The question or request for the user.'),
      }),
      requiresApproval: false, // asking the user IS the approval basically
      execute: async (args: unknown) => {
        const { question } = args as { question: string };
        const answer = await interactionService.askUser(agentId, question, context);
        return `User Response: ${answer}`;
      },
    },
  ];
}
