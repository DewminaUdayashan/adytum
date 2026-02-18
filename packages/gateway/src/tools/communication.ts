/**
 * @file packages/gateway/src/tools/communication.ts
 * @description Tools for agent-to-agent communication.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { DirectMessagingService } from '../application/services/direct-messaging-service.js';

export function createCommunicationTools(messagingService: DirectMessagingService, senderId: string): ToolDefinition[] {
  return [
    {
      name: 'send_message',
      description:
        'Send a direct message to another agent. This triggers an immediate response from the recipient. Use this to coordinate, ask questions, or delegate tasks without spawning a new agent. Recipient must be active.',
      parameters: z.object({
        recipient: z.string().describe('Name or ID of the agent to message.'),
        content: z.string().describe('The message content. Be clear and concise.'),
      }),
      execute: async (args: unknown) => {
        const { recipient, content } = args as { recipient: string; content: string };
        const result = await messagingService.sendMessage(senderId, recipient, content);
        if (result.success) {
          return `Message sent to "${recipient}". Response: ${result.response}`;
        } else {
          return `Failed to send message: ${result.error}`;
        }
      },
    },
  ];
}
