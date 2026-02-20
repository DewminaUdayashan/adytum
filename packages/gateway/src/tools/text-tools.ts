import { z } from 'zod';
import { ToolDefinition } from '@adytum/shared';
import { ModelRouter } from '../infrastructure/llm/model-router.js';

/**
 * Creates text processing tools.
 * @param modelRouter - The model router for LLM calls.
 * @returns Array of tool definitions.
 */
export const createTextTools = (modelRouter: ModelRouter): ToolDefinition[] => {
  return [
    {
      name: 'text_completion',
      description: `
        Generates a completion or summary for a given text prompt using an LLM.
        Use this for tasks like summarizing long content, extracting key details, 
        or transforming text data without needing a full sub-agent.
      `,
      parameters: z.object({
        prompt: z.string().describe('The prompt or context to process.'),
        systemInstructions: z
          .string()
          .optional()
          .describe('Optional system instructions to guide the model.'),
        modelRole: z
          .enum(['thinking', 'fast', 'local'])
          .default('fast')
          .describe('Priority level for the model.'),
      }),
      execute: async ({ prompt, systemInstructions, modelRole }) => {
        const messages: any[] = [];
        if (systemInstructions) {
          messages.push({ role: 'system', content: systemInstructions });
        }
        messages.push({ role: 'user', content: prompt });

        const { message } = await modelRouter.chat(modelRole, messages, {
          temperature: 0.3,
          fallbackRole: 'fast' as any,
        });

        return message.content || 'No response generated.';
      },
    },
  ];
};
