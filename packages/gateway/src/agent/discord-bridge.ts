import { Client, Events, GatewayIntentBits, Partials, type Message, type TextBasedChannel } from 'discord.js';
import type { AgentRuntime } from './runtime.js';
import type { DiscordConfig } from '@adytum/shared';

const MAX_DISCORD_MESSAGE_LENGTH = 1900;
type DiscordSendChannel = TextBasedChannel & { send: (content: string) => Promise<unknown> };

export class DiscordBridge {
  private client: Client | null = null;

  constructor(
    private agent: AgentRuntime,
    private config: DiscordConfig,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.config.botToken);
  }

  isReady(): boolean {
    return this.client?.isReady() ?? false;
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((error) => {
        console.error('[Discord] Message handling error:', error);
      });
    });

    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Client error:', error);
    });

    await this.client.login(this.config.botToken);
    console.log('[Discord] Connected.');
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }

  async sendMessage(content: string, channelId?: string): Promise<void> {
    if (!this.client) throw new Error('Discord client not initialized');
    const targetChannelId = channelId || this.config.defaultChannelId;
    if (!targetChannelId) throw new Error('No Discord channel ID configured');

    const channel = await this.getTextChannel(targetChannelId);
    if (!channel) throw new Error(`Discord channel not found or not text-based: ${targetChannelId}`);

    const chunks = splitMessage(content);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  private async getTextChannel(channelId: string): Promise<DiscordSendChannel | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
    return channel as DiscordSendChannel;
  }

  private shouldHandle(message: Message): boolean {
    if (message.author.bot) return false;

    if (this.config.allowedUserIds?.length && !this.config.allowedUserIds.includes(message.author.id)) {
      return false;
    }

    if (message.guildId && this.config.guildId && message.guildId !== this.config.guildId) {
      return false;
    }

    if (this.config.allowedChannelIds?.length && !this.config.allowedChannelIds.includes(message.channelId)) {
      return false;
    }

    if (!message.guildId && this.config.allowDm === false) {
      return false;
    }

    return true;
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.client || !this.shouldHandle(message)) return;

    const content = message.content?.trim();
    const hasAttachments = message.attachments?.size > 0;
    if (!content && !hasAttachments) return;

    const prompt = content || '[User sent an attachment]';
    const sessionId = `discord-${message.channelId}-${message.author.id}`;

    const result = await this.agent.run(prompt, sessionId);

    if (result.response?.trim()) {
      await this.sendMessage(result.response, message.channelId);
    }
  }
}

function splitMessage(content: string): string[] {
  if (content.length <= MAX_DISCORD_MESSAGE_LENGTH) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > MAX_DISCORD_MESSAGE_LENGTH) {
    let sliceIndex = remaining.lastIndexOf('\n', MAX_DISCORD_MESSAGE_LENGTH);
    if (sliceIndex < 0) sliceIndex = MAX_DISCORD_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, sliceIndex).trim());
    remaining = remaining.slice(sliceIndex).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
