import { z } from 'zod';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextBasedChannel,
  type User,
} from 'discord.js';

const MAX_DISCORD_MESSAGE_LENGTH = 1900;

const DISCORD_ACTIONS = [
  'send_message',
  'read_messages',
  'fetch_message',
  'react',
  'create_poll',
  'create_thread',
  'reply_thread',
  'create_channel',
  'pin_message',
  'unpin_message',
  'list_channels',
  'list_guilds',
  'guild_info',
  'list_members',
] as const;

type DiscordAction = (typeof DISCORD_ACTIONS)[number];

type DiscordLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type DiscordSendChannel = TextBasedChannel & {
  id: string;
  send: (payload: any) => Promise<any>;
  messages?: {
    fetch: (id: string) => Promise<any>;
  };
};

const DiscordActionPermissionsSchema = z.object({
  send_message: z.boolean().default(true),
  read_messages: z.boolean().default(true),
  fetch_message: z.boolean().default(true),
  react: z.boolean().default(true),
  create_poll: z.boolean().default(true),
  create_thread: z.boolean().default(true),
  reply_thread: z.boolean().default(true),
  create_channel: z.boolean().default(true),
  pin_message: z.boolean().default(true),
  unpin_message: z.boolean().default(true),
  list_channels: z.boolean().default(true),
  list_guilds: z.boolean().default(true),
  guild_info: z.boolean().default(true),
  list_members: z.boolean().default(true),
});

const DiscordPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string().optional(),
  tokenEnv: z.string().default('ADYTUM_DISCORD_BOT_TOKEN'),
  defaultChannelId: z.string().optional(),
  defaultChannelIdEnv: z.string().default('ADYTUM_DISCORD_DEFAULT_CHANNEL_ID'),
  defaultUserId: z.string().optional(),
  defaultUserIdEnv: z.string().default('ADYTUM_DISCORD_DEFAULT_USER_ID'),
  guildId: z.string().optional(),
  guildIdEnv: z.string().default('ADYTUM_DISCORD_GUILD_ID'),
  allowedChannelIds: z.array(z.string()).default([]),
  allowedUserIds: z.array(z.string()).default([]),
  allowDm: z.boolean().default(true),
  listenIncoming: z.boolean().default(true),
  respondToMentionsOnly: z.boolean().default(false),
  includeAttachmentLinksInInbound: z.boolean().default(true),
  outboundReplyPrefix: z.string().default(''),
  enableMessageContentIntent: z.boolean().default(true),
  enableGuildMembersIntent: z.boolean().default(false),
  actionPermissions: DiscordActionPermissionsSchema.default({}),
});

type DiscordPluginConfig = z.infer<typeof DiscordPluginConfigSchema>;
type DiscordActionPermissions = z.infer<typeof DiscordActionPermissionsSchema>;

const DiscordSendSchema = z.object({
  content: z.string().min(1).describe('Message text to send to Discord'),
  channelId: z
    .string()
    .optional()
    .describe('Target channel ID. Defaults to configured default channel.'),
  userId: z.string().optional().describe('Target Discord user ID (for DM).'),
  threadId: z.string().optional().describe('Target thread ID.'),
  replyToMessageId: z.string().optional().describe('Optional message ID to reply to.'),
});

const DiscordActionSchema = z.object({
  action: z.enum(DISCORD_ACTIONS),

  target: z
    .string()
    .optional()
    .describe('Target format: channel:<id>, thread:<id>, user:<id>, or plain channel ID.'),
  channelId: z.string().optional(),
  threadId: z.string().optional(),
  userId: z.string().optional(),

  content: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),

  messageId: z.string().optional(),
  messageLink: z.string().optional(),
  emoji: z.string().optional(),

  pollQuestion: z.string().optional(),
  pollAnswers: z.array(z.string()).optional(),
  pollDurationHours: z.number().int().min(1).max(168).optional(),
  pollAllowMultiselect: z.boolean().optional(),

  threadName: z.string().optional(),
  autoArchiveDuration: z.number().int().optional(),
  channelName: z.string().optional(),
  channelType: z.enum(['text', 'voice', 'forum', 'announcement', 'stage', 'category']).optional(),
  topic: z.string().optional(),
  nsfw: z.boolean().optional(),
  parentId: z.string().optional(),
  rateLimitPerUser: z.number().int().min(0).max(21600).optional(),

  guildId: z.string().optional(),
  includeVoiceChannels: z.boolean().optional(),
  includeCategories: z.boolean().optional(),

  memberQuery: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

type OutboundTarget =
  | { type: 'channel'; id: string }
  | { type: 'thread'; id: string }
  | { type: 'user'; id: string };

const isSnowflake = (value?: string): boolean =>
  typeof value === 'string' && /^\d{17,20}$/.test(value.trim());

class DiscordService {
  private client: Client | null = null;
  private agent: any = null;
  private config: DiscordPluginConfig;
  private privilegedIntentsActive = false;

  constructor(
    rawConfig: unknown,
    private logger: DiscordLogger,
  ) {
    this.config = resolveConfig(rawConfig);
  }

  get id(): string {
    return 'discord-service';
  }

  isReady(): boolean {
    return this.client?.isReady() ?? false;
  }

  isActionEnabled(action: DiscordAction): boolean {
    return this.config.actionPermissions[action] !== false;
  }

  assertActionEnabled(action: DiscordAction): void {
    if (this.isActionEnabled(action)) return;
    throw new Error(
      `Discord action "${action}" is disabled in config (skills.entries.discord.config.actionPermissions.${action}=false)`,
    );
  }

  async start(ctx: { agent: any }): Promise<void> {
    this.agent = ctx.agent;

    if (!this.config.enabled) {
      this.logger.info('disabled by plugin config');
      return;
    }

    if (!this.config.botToken) {
      this.logger.warn(
        'missing bot token; set skills.entries.discord.config.botToken or ADYTUM_DISCORD_BOT_TOKEN',
      );
      return;
    }

    if (this.client?.isReady()) {
      return;
    }

    this.client = this.createClient({
      withMessageContent: this.config.enableMessageContentIntent,
      withGuildMembers: this.config.enableGuildMembersIntent,
    });

    try {
      await this.client.login(this.config.botToken);
      this.privilegedIntentsActive =
        this.config.enableMessageContentIntent || this.config.enableGuildMembersIntent;
      this.logger.info(`connected as ${this.client.user?.tag || 'unknown-user'}`);
    } catch (error: any) {
      const isDisallowedIntents = isDisallowedIntentsError(error);
      if (!isDisallowedIntents) {
        throw error;
      }

      this.logger.warn(
        'Discord rejected privileged intents. Retrying with reduced intents (outbound still works).',
      );

      await this.client.destroy();
      this.client = this.createClient({
        withMessageContent: false,
        withGuildMembers: false,
      });

      await this.client.login(this.config.botToken);
      this.privilegedIntentsActive = false;
      this.logger.info(
        `connected with reduced intents as ${this.client.user?.tag || 'unknown-user'}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await this.client.destroy();
    this.client = null;
    this.agent = null;
  }

  async sendMessage(params: {
    content: string;
    target?: OutboundTarget;
    channelId?: string;
    userId?: string;
    threadId?: string;
    replyToMessageId?: string;
  }): Promise<{ messageId: string; channelId: string; target: string }> {
    if (!this.client?.isReady()) {
      throw new Error('Discord client is not connected');
    }

    // Normalize IDs: if caller passed a non-numeric userId, prefer defaultUserId; otherwise reject.
    const normalizedUserId =
      (params.userId && isSnowflake(params.userId) && params.userId.trim()) ||
      (this.config.defaultUserId && isSnowflake(this.config.defaultUserId)
        ? this.config.defaultUserId.trim()
        : undefined) ||
      (params.userId ? undefined : undefined);

    const target =
      params.target ||
      parseTarget({
        target: undefined,
        channelId: params.channelId,
        userId: normalizedUserId,
        threadId: params.threadId,
      }) ||
      (this.config.defaultChannelId
        ? ({ type: 'channel', id: this.config.defaultChannelId } as OutboundTarget)
        : this.config.defaultUserId
          ? ({ type: 'user', id: this.config.defaultUserId } as OutboundTarget)
          : null);

    if (!target) {
      throw new Error(
        'No target provided. Use target/channelId/userId/threadId or configure defaultChannelId/defaultUserId.',
      );
    }

    const channel = await this.resolveSendChannel(target);
    const payload = this.config.outboundReplyPrefix
      ? `${this.config.outboundReplyPrefix}${params.content}`
      : params.content;

    let sent: any;
    if (params.replyToMessageId && channel.messages?.fetch) {
      try {
        const source = await channel.messages.fetch(params.replyToMessageId);
        sent = await channel.send({ content: payload, reply: { messageReference: source.id } });
      } catch {
        sent = await channel.send(payload);
      }
    } else {
      sent = await channel.send(payload);
    }

    return {
      messageId: sent.id,
      channelId: channel.id,
      target: `${target.type}:${target.id}`,
    };
  }

  async readMessages(channelId: string, limit: number = 20): Promise<any[]> {
    const channel = await this.getReadableChannel(channelId);
    const messages = await channel.messages!.fetch({ limit });

    return Array.from(messages.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => normalizeMessage(message));
  }

  async fetchMessage(input: {
    channelId?: string;
    messageId?: string;
    messageLink?: string;
  }): Promise<any> {
    const fromLink = input.messageLink ? parseDiscordMessageLink(input.messageLink) : null;
    const channelId = fromLink?.channelId || input.channelId;
    const messageId = fromLink?.messageId || input.messageId;

    if (!channelId || !messageId) {
      throw new Error('fetch_message requires channelId+messageId or messageLink');
    }

    const channel = await this.getReadableChannel(channelId);
    const message = await channel.messages!.fetch(messageId);
    return normalizeMessage(message);
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<string> {
    const channel = await this.getReadableChannel(channelId);
    const message = await channel.messages!.fetch(messageId);
    await message.react(emoji);
    return `Added reaction ${emoji} to message ${messageId}`;
  }

  async createPoll(input: {
    target?: OutboundTarget;
    channelId?: string;
    pollQuestion: string;
    pollAnswers: string[];
    pollDurationHours?: number;
    pollAllowMultiselect?: boolean;
  }): Promise<{ messageId: string; channelId: string }> {
    const target =
      input.target ||
      parseTarget({ target: undefined, channelId: input.channelId }) ||
      (this.config.defaultChannelId
        ? ({ type: 'channel', id: this.config.defaultChannelId } as OutboundTarget)
        : null);

    if (!target) {
      throw new Error('No target channel for poll');
    }

    if (target.type === 'user') {
      throw new Error('Polls are not supported in user DM targets');
    }

    const channel = await this.resolveSendChannel(target);
    const answers = input.pollAnswers.map((text) => ({ text }));

    const sent = await channel.send({
      poll: {
        question: { text: input.pollQuestion },
        answers,
        duration: input.pollDurationHours ?? 24,
        allowMultiselect: input.pollAllowMultiselect ?? false,
      },
    } as any);

    return { messageId: sent.id, channelId: channel.id };
  }

  async createThread(input: {
    channelId: string;
    threadName: string;
    messageId?: string;
    autoArchiveDuration?: number;
  }): Promise<{ threadId: string; threadName: string }> {
    if (!this.client?.isReady()) throw new Error('Discord client is not connected');

    const channel = await this.client.channels.fetch(input.channelId);
    if (!channel || !('threads' in (channel as any))) {
      throw new Error(`Channel ${input.channelId} does not support threads`);
    }

    if (input.messageId && (channel as any).messages?.fetch) {
      const message = await (channel as any).messages.fetch(input.messageId);
      const thread = await message.startThread({
        name: input.threadName,
        autoArchiveDuration: input.autoArchiveDuration,
      });
      return { threadId: thread.id, threadName: thread.name };
    }

    const thread = await (channel as any).threads.create({
      name: input.threadName,
      autoArchiveDuration: input.autoArchiveDuration,
    });

    return { threadId: thread.id, threadName: thread.name };
  }

  async createChannel(input: {
    guildId?: string;
    channelName: string;
    channelType?: 'text' | 'voice' | 'forum' | 'announcement' | 'stage' | 'category';
    topic?: string;
    nsfw?: boolean;
    parentId?: string;
    rateLimitPerUser?: number;
  }): Promise<{ guildId: string; channelId: string; channelName: string; channelType: string }> {
    const guild = await this.resolveGuild(input.guildId);

    const channelTypeMap: Record<NonNullable<typeof input.channelType>, ChannelType> = {
      text: ChannelType.GuildText,
      voice: ChannelType.GuildVoice,
      forum: ChannelType.GuildForum,
      announcement: ChannelType.GuildAnnouncement,
      stage: ChannelType.GuildStageVoice,
      category: ChannelType.GuildCategory,
    };

    const resolvedType = input.channelType
      ? channelTypeMap[input.channelType]
      : ChannelType.GuildText;

    const payload: any = {
      name: input.channelName,
      type: resolvedType,
      parent: input.parentId,
    };

    if (typeof input.topic === 'string') payload.topic = input.topic;
    if (typeof input.nsfw === 'boolean') payload.nsfw = input.nsfw;
    if (typeof input.rateLimitPerUser === 'number')
      payload.rateLimitPerUser = input.rateLimitPerUser;

    const created = await guild.channels.create(payload);
    return {
      guildId: guild.id,
      channelId: created.id,
      channelName: created.name,
      channelType: ChannelType[created.type] || String(created.type),
    };
  }

  async replyThread(
    threadId: string,
    content: string,
  ): Promise<{ messageId: string; threadId: string }> {
    const channel = await this.getTextChannel(threadId);
    if (!channel) throw new Error(`Thread not found: ${threadId}`);

    const sent = await channel.send(content);
    return { messageId: sent.id, threadId: channel.id };
  }

  async pinMessage(channelId: string, messageId: string): Promise<string> {
    const channel = await this.getReadableChannel(channelId);
    const message = await channel.messages!.fetch(messageId);
    await message.pin();
    return `Pinned message ${messageId}`;
  }

  async unpinMessage(channelId: string, messageId: string): Promise<string> {
    const channel = await this.getReadableChannel(channelId);
    const message = await channel.messages!.fetch(messageId);
    await message.unpin();
    return `Unpinned message ${messageId}`;
  }

  async listChannels(input?: {
    guildId?: string;
    includeVoiceChannels?: boolean;
    includeCategories?: boolean;
  }): Promise<any[]> {
    if (!this.client?.isReady()) throw new Error('Discord client is not connected');

    const guild = await this.resolveGuild(input?.guildId);
    const channels = await guild.channels.fetch();

    return channels
      .filter((channel) => {
        if (!channel) return false;
        if (channel.type === ChannelType.GuildVoice && !input?.includeVoiceChannels) return false;
        if (channel.type === ChannelType.GuildCategory && !input?.includeCategories) return false;
        return true;
      })
      .map((channel) => ({
        id: channel!.id,
        name: channel!.name,
        type: ChannelType[channel!.type] || String(channel!.type),
      }));
  }

  async listGuilds(): Promise<any[]> {
    if (!this.client?.isReady()) throw new Error('Discord client is not connected');
    const guilds = await this.client.guilds.fetch();

    const details = await Promise.all(
      guilds.map(async (entry) => {
        try {
          const full = await entry.fetch();
          return {
            id: full.id,
            name: full.name,
            memberCount: full.memberCount,
            ownerId: full.ownerId,
          };
        } catch {
          return {
            id: entry.id,
            name: entry.name,
          };
        }
      }),
    );

    return details.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async guildInfo(guildId?: string): Promise<any> {
    if (!this.client?.isReady()) throw new Error('Discord client is not connected');

    const guild = await this.resolveGuild(guildId);
    return {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      channels: guild.channels.cache.size,
      ownerId: guild.ownerId,
      createdAt: guild.createdAt?.toISOString(),
    };
  }

  async listMembers(input?: {
    guildId?: string;
    memberQuery?: string;
    limit?: number;
  }): Promise<any[]> {
    if (!this.privilegedIntentsActive) {
      throw new Error(
        'Guild member intent is disabled. Enable enableGuildMembersIntent and toggle Server Members Intent in Discord Developer Portal.',
      );
    }

    const guild = await this.resolveGuild(input?.guildId);
    const members = await guild.members.fetch({
      query: input?.memberQuery,
      limit: input?.limit ?? 25,
    });

    return members.map((member) => ({
      id: member.id,
      username: member.user?.username,
      displayName: member.displayName,
      bot: member.user?.bot,
    }));
  }

  private createClient(options: {
    withMessageContent: boolean;
    withGuildMembers: boolean;
  }): Client {
    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
    ];

    if (options.withMessageContent) intents.push(GatewayIntentBits.MessageContent);
    if (options.withGuildMembers) intents.push(GatewayIntentBits.GuildMembers);

    const client = new Client({
      intents,
      partials: [Partials.Channel],
    });

    client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((error) => {
        this.logger.error(`message handling error: ${String(error)}`);
      });
    });

    client.on(Events.Error, (error) => {
      this.logger.error(`client error: ${String(error)}`);
    });

    return client;
  }

  private async resolveSendChannel(target: OutboundTarget): Promise<DiscordSendChannel> {
    if (!this.client) throw new Error('Discord client is not connected');

    if (target.type === 'user') {
      if (!isSnowflake(target.id)) {
        throw new Error('Discord userId must be a numeric snowflake.');
      }
      const user = await this.client.users.fetch(target.id);
      const dm = await user.createDM();
      return dm as unknown as DiscordSendChannel;
    }

    if (!isSnowflake(target.id)) {
      throw new Error('Discord channel/thread ID must be a numeric snowflake.');
    }
    const channel = await this.getTextChannel(target.id);
    if (!channel) {
      throw new Error(`Target channel/thread not found or not text-based: ${target.id}`);
    }

    return channel;
  }

  private async getTextChannel(channelId: string): Promise<DiscordSendChannel | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
    return channel as unknown as DiscordSendChannel;
  }

  private async getReadableChannel(channelId: string): Promise<DiscordSendChannel> {
    const channel = await this.getTextChannel(channelId);
    if (!channel || !channel.messages || typeof channel.messages.fetch !== 'function') {
      throw new Error(`Channel ${channelId} does not support message history`);
    }
    return channel;
  }

  private async resolveGuild(guildId?: string): Promise<any> {
    if (!this.client?.isReady()) throw new Error('Discord client is not connected');

    const resolvedGuildId = guildId || this.config.guildId || this.client.guilds.cache.first()?.id;
    if (!resolvedGuildId) {
      throw new Error('No guildId provided and no default guild is available');
    }

    const guild = await this.client.guilds.fetch(resolvedGuildId);
    if (!guild) throw new Error(`Guild not found: ${resolvedGuildId}`);
    return guild;
  }

  private shouldHandle(message: Message): boolean {
    if (message.author.bot) return false;
    if (!this.config.listenIncoming) return false;

    if (
      this.config.allowedUserIds.length > 0 &&
      !this.config.allowedUserIds.includes(message.author.id)
    ) {
      return false;
    }

    if (message.guildId && this.config.guildId && message.guildId !== this.config.guildId) {
      return false;
    }

    if (
      this.config.allowedChannelIds.length > 0 &&
      !this.config.allowedChannelIds.includes(message.channelId)
    ) {
      return false;
    }

    if (!message.guildId && this.config.allowDm === false) {
      return false;
    }

    if (this.config.respondToMentionsOnly && message.guildId && this.client?.user) {
      if (!message.mentions.has(this.client.user.id)) {
        return false;
      }
    }

    return true;
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.client || !this.agent || !this.shouldHandle(message)) return;

    const content = message.content?.trim();
    const hasAttachments = message.attachments?.size > 0;
    if (!content && !hasAttachments) return;

    const attachmentLines = this.config.includeAttachmentLinksInInbound
      ? Array.from(message.attachments.values()).map((a) => `- ${a.name || 'attachment'}: ${a.url}`)
      : [];

    const contextHeader = [
      '[Discord Context]',
      `ChannelID: ${message.channelId}`,
      `Author: ${message.author.username} (${message.author.id})`,
      message.guildId ? `GuildID: ${message.guildId}` : 'DirectMessage: true',
      `MessageID: ${message.id}`,
    ].join(' | ');

    const promptParts = [contextHeader, content || '[User sent an attachment]'];
    if (attachmentLines.length > 0) {
      promptParts.push('Attachments:\n' + attachmentLines.join('\n'));
    }

    const prompt = promptParts.join('\n\n');
    const sessionId = `discord:${message.channelId}:${message.author.id}`;

    const result = await this.agent.run(prompt, sessionId);
    if (result.response?.trim()) {
      if (!this.isActionEnabled('send_message')) {
        this.logger.warn('send_message action is disabled; skipping inbound auto-reply');
        return;
      }
      await this.sendMessage({
        content: result.response,
        channelId: message.channelId,
        replyToMessageId: message.id,
      });
    }
  }
}

function resolveConfig(rawConfig: unknown): DiscordPluginConfig {
  const parsed = DiscordPluginConfigSchema.parse(rawConfig || {});

  const resolvedToken = parsed.botToken?.trim() || readEnv(parsed.tokenEnv);
  const resolvedDefaultChannel =
    parsed.defaultChannelId?.trim() || readEnv(parsed.defaultChannelIdEnv);
  const resolvedDefaultUser = parsed.defaultUserId?.trim() || readEnv(parsed.defaultUserIdEnv);
  const resolvedGuildId = parsed.guildId?.trim() || readEnv(parsed.guildIdEnv);

  return {
    ...parsed,
    botToken: resolvedToken,
    defaultChannelId: resolvedDefaultChannel,
    defaultUserId: resolvedDefaultUser,
    guildId: resolvedGuildId,
    actionPermissions: resolveActionPermissions(parsed.actionPermissions),
  };
}

function isDisallowedIntentsError(error: any): boolean {
  const text = [error?.message, error?.code, error?.name, error?.cause?.message, error?.cause?.code]
    .filter(Boolean)
    .map((part) => String(part))
    .join(' ');

  if (/disallowed intents|used disallowed intents|intents.+not.+enabled|4014/i.test(text)) {
    return true;
  }

  const numericCodes = [error?.code, error?.closeCode, error?.cause?.code]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numericCodes.includes(4014);
}

function resolveActionPermissions(value: DiscordActionPermissions): DiscordActionPermissions {
  return DiscordActionPermissionsSchema.parse(value || {});
}

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
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

function parseTarget(input: {
  target?: string;
  channelId?: string;
  userId?: string;
  threadId?: string;
}): OutboundTarget | null {
  if (input.userId) return { type: 'user', id: input.userId };
  if (input.threadId) return { type: 'thread', id: input.threadId };
  if (input.channelId) return { type: 'channel', id: input.channelId };

  const raw = input.target?.trim();
  if (!raw) return null;

  if (raw.startsWith('channel:')) return { type: 'channel', id: raw.slice('channel:'.length) };
  if (raw.startsWith('thread:')) return { type: 'thread', id: raw.slice('thread:'.length) };
  if (raw.startsWith('user:')) return { type: 'user', id: raw.slice('user:'.length) };

  return { type: 'channel', id: raw };
}

function parseDiscordMessageLink(
  link: string,
): { guildId: string; channelId: string; messageId: string } | null {
  const match = link.match(/discord\.com\/channels\/(.+?)\/(\d+)\/(\d+)/i);
  if (!match) return null;
  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

function normalizeMessage(message: any): any {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id,
      username: message.author?.username,
      bot: message.author?.bot,
    },
    content: message.content,
    createdAt: message.createdAt?.toISOString?.() || null,
    editedAt: message.editedAt?.toISOString?.() || null,
    pinned: message.pinned,
    reactions: Array.from(message.reactions?.cache?.values?.() || []).map((reaction: any) => ({
      emoji: reaction.emoji?.name || reaction.emoji?.id,
      count: reaction.count,
    })),
    attachments: Array.from(message.attachments?.values?.() || []).map((attachment: any) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    jumpUrl: message.url,
  };
}

const discordPlugin = {
  id: 'discord',
  name: 'Discord',
  description:
    'Comprehensive Discord skill with inbound listener, outbound messaging, reactions, polls, threads, and discovery actions.',

  register(api: any) {
    const service = new DiscordService(api.pluginConfig, api.logger);

    api.registerService(service);

    api.registerTool({
      name: 'discord_send',
      description: 'Send a message to a Discord channel/thread/DM via the configured bot.',
      parameters: DiscordSendSchema,
      execute: async ({
        content,
        channelId,
        userId,
        threadId,
        replyToMessageId,
      }: z.infer<typeof DiscordSendSchema>) => {
        if (!service.isReady()) {
          return 'Discord bot is not connected. Check token/config and restart gateway.';
        }

        service.assertActionEnabled('send_message');

        // Prefer numeric userId; if caller passed a non-snowflake string, fall back to configured defaultUserId when present.
        let effectiveUserId = userId;
        if (
          effectiveUserId &&
          !isSnowflake(effectiveUserId) &&
          service['config'].defaultUserId &&
          isSnowflake(service['config'].defaultUserId)
        ) {
          effectiveUserId = service['config'].defaultUserId;
        }
        if (effectiveUserId && !isSnowflake(effectiveUserId)) {
          throw new Error('userId must be a numeric snowflake (17–20 digits).');
        }

        const result = await service.sendMessage({
          content,
          channelId,
          userId: effectiveUserId,
          threadId,
          replyToMessageId,
        });

        return `Sent message ${result.messageId} to ${result.target}.`;
      },
    });

    api.registerTool({
      name: 'discord_action',
      description:
        'Advanced Discord actions: read/fetch messages, react, create polls/threads, pin/unpin, and channel/guild/member discovery.',
      parameters: DiscordActionSchema,
      execute: async (args: z.infer<typeof DiscordActionSchema>) => {
        if (!service.isReady()) {
          return 'Discord bot is not connected. Check token/config and restart gateway.';
        }

        service.assertActionEnabled(args.action);

        switch (args.action) {
          case 'send_message': {
            if (!args.content) throw new Error('content is required for send_message');
            const target = parseTarget(args);
            return service.sendMessage({
              content: args.content,
              target: target || undefined,
              channelId: args.channelId,
              userId: args.userId,
              threadId: args.threadId,
              replyToMessageId: args.replyToMessageId,
            });
          }

          case 'read_messages': {
            const target = parseTarget(args);
            const channelId =
              args.channelId || args.threadId || (target?.type !== 'user' ? target?.id : undefined);
            if (!channelId)
              throw new Error('channelId/threadId/target is required for read_messages');
            return service.readMessages(channelId, args.limit ?? 20);
          }

          case 'fetch_message':
            return service.fetchMessage({
              channelId: args.channelId || args.threadId,
              messageId: args.messageId,
              messageLink: args.messageLink,
            });

          case 'react': {
            const target = parseTarget(args);
            const channelId =
              args.channelId || args.threadId || (target?.type !== 'user' ? target?.id : undefined);
            if (!channelId || !args.messageId || !args.emoji) {
              throw new Error('react requires channelId/threadId/target + messageId + emoji');
            }
            return service.addReaction(channelId, args.messageId, args.emoji);
          }

          case 'create_poll': {
            if (!args.pollQuestion || !args.pollAnswers || args.pollAnswers.length < 2) {
              throw new Error('create_poll requires pollQuestion and at least 2 pollAnswers');
            }
            const target = parseTarget(args);
            return service.createPoll({
              target: target || undefined,
              channelId: args.channelId,
              pollQuestion: args.pollQuestion,
              pollAnswers: args.pollAnswers,
              pollDurationHours: args.pollDurationHours,
              pollAllowMultiselect: args.pollAllowMultiselect,
            });
          }

          case 'create_thread': {
            const target = parseTarget(args);
            const channelId =
              args.channelId || (target?.type === 'channel' ? target.id : undefined);
            if (!channelId || !args.threadName) {
              throw new Error('create_thread requires channelId/target and threadName');
            }
            return service.createThread({
              channelId,
              threadName: args.threadName,
              messageId: args.messageId,
              autoArchiveDuration: args.autoArchiveDuration,
            });
          }

          case 'reply_thread': {
            const target = parseTarget(args);
            const threadId = args.threadId || (target?.type === 'thread' ? target.id : undefined);
            if (!threadId || !args.content) {
              throw new Error('reply_thread requires threadId/target and content');
            }
            return service.replyThread(threadId, args.content);
          }

          case 'create_channel': {
            if (!args.channelName) {
              throw new Error('create_channel requires channelName');
            }
            return service.createChannel({
              guildId: args.guildId,
              channelName: args.channelName,
              channelType: args.channelType,
              topic: args.topic,
              nsfw: args.nsfw,
              parentId: args.parentId,
              rateLimitPerUser: args.rateLimitPerUser,
            });
          }

          case 'pin_message': {
            const target = parseTarget(args);
            const channelId =
              args.channelId || args.threadId || (target?.type !== 'user' ? target?.id : undefined);
            if (!channelId || !args.messageId) {
              throw new Error('pin_message requires channelId/threadId/target and messageId');
            }
            return service.pinMessage(channelId, args.messageId);
          }

          case 'unpin_message': {
            const target = parseTarget(args);
            const channelId =
              args.channelId || args.threadId || (target?.type !== 'user' ? target?.id : undefined);
            if (!channelId || !args.messageId) {
              throw new Error('unpin_message requires channelId/threadId/target and messageId');
            }
            return service.unpinMessage(channelId, args.messageId);
          }

          case 'list_channels':
            return service.listChannels({
              guildId: args.guildId,
              includeVoiceChannels: args.includeVoiceChannels,
              includeCategories: args.includeCategories,
            });

          case 'list_guilds':
            return service.listGuilds();

          case 'guild_info':
            return service.guildInfo(args.guildId);

          case 'list_members':
            return service.listMembers({
              guildId: args.guildId,
              memberQuery: args.memberQuery,
              limit: args.limit,
            });

          default:
            throw new Error(`Unsupported action: ${args.action}`);
        }
      },
    });
  },
};

export default discordPlugin;
