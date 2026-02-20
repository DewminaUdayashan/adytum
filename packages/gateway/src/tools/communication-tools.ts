import { z } from 'zod';
import { ToolDefinition } from '@adytum/shared';
import { SwarmMessenger } from '../domain/logic/swarm-messenger.js';
import { SwarmManager } from '../domain/logic/swarm-manager.js';

export const createCommunicationTools = (
  messenger: SwarmMessenger,
  swarmManager: SwarmManager,
): ToolDefinition[] => {
  return [
    {
      name: 'send_message',
      description: 'Send a message to another agent or broadcast to all agents.',
      parameters: z.object({
        toAgentId: z
          .string()
          .describe('The ID of the target agent, or "BROADCAST" to send to all.'),
        content: z.string().describe('The content of the message.'),
        type: z
          .enum(['instruction', 'report', 'query', 'alert', 'chat'])
          .default('chat')
          .describe('The type of message (default: chat).'),
      }),
      execute: async ({ toAgentId, content, type }, context) => {
        const fromAgentId = context.agentId || 'unknown';

        if (toAgentId === 'BROADCAST') {
          messenger.broadcast(fromAgentId, content, type as any);
          return `Broadcast message sent to all agents.`;
        }

        // Verify target exists
        const target = swarmManager.getAgent(toAgentId);
        if (!target) {
          throw new Error(`Agent with ID ${toAgentId} not found.`);
        }

        messenger.send(fromAgentId, toAgentId, content, type as any);
        return `Message sent to ${target.name} (${toAgentId}).`;
      },
    },
    {
      name: 'check_inbox',
      description: 'Check for new messages from other agents.',
      parameters: z.object({}),
      execute: async (_, context) => {
        const agentId = context.agentId || 'unknown';
        const messages = messenger.getMessages(agentId);

        if (messages.length === 0) {
          return 'No new messages.';
        }

        return messages
          .map(
            (m) =>
              `[${new Date(m.timestamp).toISOString()}] From ${m.fromAgentId} (${m.type}): ${m.content}`,
          )
          .join('\n');
      },
    },
  ];
};
