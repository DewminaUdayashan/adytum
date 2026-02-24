/**
 * @file workspace/skills/telegram/index.ts
 * @description Telegram bot integration using grammY.
 */

import { Bot, HttpError } from 'grammy';
import { z } from 'zod';

const TELEGRAM_ACTIONS = [
  'send_message',
  'read_messages',
  'react',
  'pin_message',
  'unpin_message',
] as const;

type TelegramAction = (typeof TELEGRAM_ACTIONS)[number];

const TelegramActionPermissionsSchema = z.object({
  send_message: z.boolean().default(true),
  read_messages: z.boolean().default(true),
  react: z.boolean().default(true),
  pin_message: z.boolean().default(true),
  unpin_message: z.boolean().default(true),
});

const TelegramPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string().optional(),
  tokenEnv: z.string().default('ADYTUM_TELEGRAM_BOT_TOKEN'),
  defaultChatId: z.string().optional(),
  defaultChatIdEnv: z.string().default('ADYTUM_TELEGRAM_DEFAULT_CHAT_ID'),
  allowedChatIds: z.array(z.string()).default([]),
  listenIncoming: z.boolean().default(true),
  respondToMentionsOnly: z.boolean().default(false),
  outboundReplyPrefix: z.string().default(''),
  actionPermissions: TelegramActionPermissionsSchema.default({}),
});

type TelegramPluginConfig = z.infer<typeof TelegramPluginConfigSchema>;

class TelegramService {
  private bot: Bot | null = null;
  private agent: any = null;
  private config: TelegramPluginConfig;
  private logger: any;

  constructor(rawConfig: unknown, logger: any) {
    this.config = resolveConfig(rawConfig);
    this.logger = logger;
  }

  get id(): string {
    return 'telegram-service';
  }

  async start(ctx: { agent: any }): Promise<void> {
    this.agent = ctx.agent;

    if (!this.config.enabled) {
      this.logger.info('Telegram service disabled by config');
      return;
    }

    if (!this.config.botToken) {
      this.logger.warn('Telegram bot token missing');
      return;
    }

    this.bot = new Bot(this.config.botToken);

    this.bot.on('message', (ctx) => {
      this.handleMessage(ctx).catch((err) => {
        this.logger.error(`Error handling Telegram message: ${err}`);
      });
    });

    this.bot.catch((err) => {
      const ctx = err.ctx;
      this.logger.error(`Error in Telegram bot: ${err.error}`);
    });

    // Start bot in background
    this.bot.start().catch((err) => {
      this.logger.error(`Failed to start Telegram bot: ${err}`);
    });

    this.logger.info('Telegram service started');
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
  }

  async sendMessage(params: { content: string; chatId?: string; replyToMessageId?: number }) {
    if (!this.bot) throw new Error('Telegram bot not started');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No chatId provided and no defaultChatId configured');

    const result = await this.bot.api.sendMessage(chatId, params.content, {
      reply_to_message_id: params.replyToMessageId,
    });

    return {
      messageId: String(result.message_id),
      chatId: String(result.chat.id),
    };
  }

  async react(chatId: string, messageId: number, emoji: string) {
    if (!this.bot) throw new Error('Telegram bot not started');
    // Note: Reacting requires higher Bot API version or specific library support
    // In grammY, it's setMessageReaction
    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [
        { type: 'emoji', emoji: emoji as any },
      ]);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to set reaction: ${err}`);
      return false;
    }
  }

  private async handleMessage(ctx: any) {
    if (!this.config.listenIncoming) return;
    if (ctx.from?.is_bot) return;

    const chatId = String(ctx.chat.id);
    if (this.config.allowedChatIds.length > 0 && !this.config.allowedChatIds.includes(chatId)) {
      return;
    }

    const text = ctx.message?.text;
    if (!text) return;

    if (this.config.respondToMentionsOnly) {
      const botInfo = await this.bot?.api.getMe();
      if (botInfo && !text.includes(`@${botInfo.username}`)) {
        return;
      }
    }

    const sessionId = `telegram:${chatId}`;
    const result = await this.agent.run(text, sessionId);

    if (result.response) {
      await this.sendMessage({
        content: result.response,
        chatId: chatId,
        replyToMessageId: ctx.message.message_id,
      });
    }
  }
}

function resolveConfig(rawConfig: unknown): TelegramPluginConfig {
  const parsed = TelegramPluginConfigSchema.parse(rawConfig || {});
  const token = parsed.botToken || process.env[parsed.tokenEnv];
  const defaultChatId = parsed.defaultChatId || process.env[parsed.defaultChatIdEnv];

  return {
    ...parsed,
    botToken: token,
    defaultChatId: defaultChatId,
  };
}

export default {
  id: 'telegram',
  name: 'Telegram',
  register(api: any) {
    const service = new TelegramService(api.pluginConfig, api.logger);
    api.registerService(service);

    api.registerTool({
      name: 'telegram_send_message',
      description: 'Send a message to a Telegram chat',
      parameters: z.object({
        content: z.string().describe('The message content'),
        chatId: z.string().optional().describe('Target chat ID. Defaults to configured default.'),
      }),
      execute: async (params: any) => {
        return await service.sendMessage(params);
      },
    });

    api.registerTool({
      name: 'telegram_react',
      description: 'React to a Telegram message with an emoji',
      parameters: z.object({
        chatId: z.string().describe('The chat ID'),
        messageId: z.number().describe('The message ID'),
        emoji: z.string().describe('The emoji to use for reaction'),
      }),
      execute: async (params: any) => {
        return await service.react(params.chatId, params.messageId, params.emoji);
      },
    });
  },
};
