import { z } from 'zod';
import type { ToolDefinition } from '@adytum/shared';
import type { DiscordBridge } from '../agent/discord-bridge.js';

const DiscordSendSchema = z.object({
  content: z.string().describe('Message to send to Discord'),
  channelId: z.string().optional().describe('Discord channel ID (optional if default is configured)'),
});

export function createDiscordTools(bridge: DiscordBridge): ToolDefinition[] {
  return [
    {
      name: 'discord_send',
      description: 'Send a message to a Discord channel via the configured bot.',
      parameters: DiscordSendSchema,
      execute: async (args: unknown) => {
        if (!bridge.isReady()) {
          return 'Discord bot is not connected. Check configuration and restart the gateway.';
        }

        const { content, channelId } = DiscordSendSchema.parse(args);
        await bridge.sendMessage(content, channelId);
        return channelId
          ? `Sent Discord message to channel ${channelId}.`
          : 'Sent Discord message to the default channel.';
      },
    },
  ];
}
