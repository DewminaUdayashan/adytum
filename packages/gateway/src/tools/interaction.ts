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
  context?: { sessionId?: string; workspaceId?: string },
  agentMode: 'reactive' | 'daemon' | 'scheduled' = 'reactive',
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
      execute: async (args: unknown, execContext?: any) => {
        // Prevent headless agents from blocking on user input
        if (agentMode === 'daemon' || agentMode === 'scheduled') {
          return `TOOL_ERROR: You are running in ${agentMode} mode (HEADLESS). You cannot ask the user for input.
            Unrecoverable error? Report to your manager.
            Missing info? Search for it yourself.
            DO NOT CALL ask_user AGAIN.`;
        }

        const { question } = args as { question: string };
        const effectiveAgentId = execContext?.agentId || agentId;
        const answer = await interactionService.askUser(effectiveAgentId, question, {
          ...context,
          ...execContext,
        });
        return `User Response: ${answer}`;
      },
    },
  ];
}
