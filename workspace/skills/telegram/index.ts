/**
 * @file workspace/skills/telegram/index.ts
 * @description Telegram skill plugin for Adytum using grammy.
 */

import { z } from 'zod';
import { Bot } from 'grammy';

const TELEGRAM_ACTIONS = [
  'send_message',
  'send_photo',
  'send_document',
  'send_poll',
  'edit_message',
  'delete_message',
] as const;

type TelegramAction = (typeof TELEGRAM_ACTIONS)[number];

type TelegramLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const TelegramActionPermissionsSchema = z.object({
  send_message: z.boolean().default(true),
  send_photo: z.boolean().default(true),
  send_document: z.boolean().default(true),
  send_poll: z.boolean().default(true),
  edit_message: z.boolean().default(true),
  delete_message: z.boolean().default(true),
});

const TelegramPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string().optional(),
  tokenEnv: z.string().default('ADYTUM_TELEGRAM_BOT_TOKEN'),
  defaultChatId: z.string().optional(),
  defaultChatIdEnv: z.string().default('ADYTUM_TELEGRAM_DEFAULT_CHAT_ID'),
  allowedUserIds: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        const parts = val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        return parts.map((s) => Number(s));
      }
      if (Array.isArray(val)) {
        return val.map((i) => Number(i));
      }
      return val;
    }, z.array(z.number()))
    .default([]),
  listenIncoming: z.boolean().default(true),
  actionPermissions: TelegramActionPermissionsSchema.default({}),
});

type TelegramPluginConfig = z.infer<typeof TelegramPluginConfigSchema>;

const TelegramSendSchema = z.object({
  text: z.string().min(1).describe('Message text to send to Telegram'),
  chatId: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Target chat ID. Defaults to configured default chat ID.'),
  replyToMessageId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .optional()
    .describe('Message ID to reply to.'),
});

const TelegramActionSchema = z.object({
  action: z.enum(TELEGRAM_ACTIONS),
  chatId: z.union([z.string(), z.number()]).optional().describe('Target chat ID.'),
  text: z.string().optional().describe('Text for message or caption.'),
  photoUrl: z.string().optional().describe('URL of the photo to send.'),
  documentUrl: z.string().optional().describe('URL of the document to send.'),
  messageId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .optional()
    .describe('Message ID for edit or delete actions.'),
  pollQuestion: z.string().optional().describe('Question for the poll.'),
  pollOptions: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        if (val.startsWith('[') && val.endsWith(']')) {
          try {
            return JSON.parse(val);
          } catch (e) {
            // fall through
          }
        }
        return val.split(',').map((s) => s.trim());
      }
      return val;
    }, z.array(z.string()))
    .optional()
    .describe('Options for the poll.'),
});

class TelegramService {
  private bot: Bot | null = null;
  private agent: any = null;
  private config: TelegramPluginConfig;

  constructor(
    rawConfig: unknown,
    private logger: TelegramLogger,
  ) {
    this.config = resolveConfig(rawConfig);
  }

  get id(): string {
    return 'telegram-service';
  }

  isReady(): boolean {
    return this.bot !== null && this.bot.isInited();
  }

  isActionEnabled(action: TelegramAction): boolean {
    return this.config.actionPermissions[action] !== false;
  }

  assertActionEnabled(action: TelegramAction): void {
    if (this.isActionEnabled(action)) return;
    throw new Error(`Telegram action "${action}" is disabled in config.`);
  }

  async start(ctx: { agent: any }): Promise<void> {
    this.agent = ctx.agent;

    if (!this.config.enabled) {
      this.logger.info('disabled by plugin config');
      return;
    }

    if (!this.config.botToken) {
      this.logger.warn(
        'missing bot token; set skills.entries.telegram.config.botToken or ADYTUM_TELEGRAM_BOT_TOKEN',
      );
      return;
    }

    if (this.bot) {
      return;
    }

    this.bot = new Bot(this.config.botToken);

    this.bot.on('message', async (ctxMsg) => {
      try {
        await this.handleMessage(ctxMsg);
      } catch (error) {
        this.logger.error(`message handling error: ${String(error)}`);
      }
    });

    this.bot.catch((err) => {
      this.logger.error(`Telegram bot error: ${String(err)}`);
    });

    // Start bot in background
    this.bot
      .start({
        onStart: (botInfo) => {
          this.logger.info(`connected as ${botInfo.username}`);
        },
        drop_pending_updates: true,
      })
      .catch((err) => {
        this.logger.error(`Failed to start Telegram bot: ${String(err)}`);
        this.bot = null;
      });
  }

  async stop(): Promise<void> {
    if (!this.bot) return;
    await this.bot.stop();
    this.bot = null;
    this.agent = null;
  }

  async sendMessage(params: { chatId?: string | number; text: string; replyToMessageId?: number }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');

    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) {
      throw new Error('No target chat ID provided or configured default.');
    }

    const sent = await this.bot.api.sendMessage(chatId, params.text, {
      reply_parameters: params.replyToMessageId
        ? { message_id: params.replyToMessageId }
        : undefined,
    });

    return {
      messageId: sent.message_id,
      chatId: sent.chat.id,
    };
  }

  async sendPhoto(params: { chatId?: string | number; photoUrl: string; caption?: string }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No target chat ID provided.');

    const sent = await this.bot.api.sendPhoto(chatId, params.photoUrl, {
      caption: params.caption,
    });
    return { messageId: sent.message_id, chatId: sent.chat.id };
  }

  async sendDocument(params: { chatId?: string | number; documentUrl: string; caption?: string }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No target chat ID provided.');

    const sent = await this.bot.api.sendDocument(chatId, params.documentUrl, {
      caption: params.caption,
    });
    return { messageId: sent.message_id, chatId: sent.chat.id };
  }

  async sendPoll(params: { chatId?: string | number; question: string; options: string[] }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No target chat ID provided.');

    const sent = await this.bot.api.sendPoll(chatId, params.question, params.options);
    return { messageId: sent.message_id, chatId: sent.chat.id };
  }

  async editMessage(params: { chatId?: string | number; messageId: number; text: string }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No target chat ID provided.');

    const edited = await this.bot.api.editMessageText(chatId, params.messageId, params.text);
    return edited;
  }

  async deleteMessage(params: { chatId?: string | number; messageId: number }) {
    if (!this.bot) throw new Error('Telegram bot is not connected');
    const chatId = params.chatId || this.config.defaultChatId;
    if (!chatId) throw new Error('No target chat ID provided.');

    const deleted = await this.bot.api.deleteMessage(chatId, params.messageId);
    return deleted;
  }

  private shouldHandle(ctxMsg: any): boolean {
    if (!this.config.listenIncoming) return false;

    const fromId = ctxMsg.from?.id;
    if (
      this.config.allowedUserIds.length > 0 &&
      fromId &&
      !this.config.allowedUserIds.includes(fromId)
    ) {
      return false;
    }

    return true;
  }

  private async handleMessage(ctxMsg: any): Promise<void> {
    if (!this.bot || !this.agent || !this.shouldHandle(ctxMsg)) return;

    const content = ctxMsg.message?.text || ctxMsg.message?.caption?.trim();
    if (!content && !ctxMsg.message?.photo && !ctxMsg.message?.document) return;

    const contextHeader = [
      '[Telegram Context]',
      `ChatID: ${ctxMsg.chat?.id}`,
      `From: ${ctxMsg.from?.username || ctxMsg.from?.first_name} (${ctxMsg.from?.id})`,
      `MessageID: ${ctxMsg.message?.message_id}`,
    ].join(' | ');

    const promptContent = content || '[User sent an attachment]';

    const promptParts = [contextHeader, promptContent];
    const prompt = promptParts.join('\n\n');
    const sessionId = `telegram:${ctxMsg.chat?.id}:${ctxMsg.from?.id}`;

    const result = await this.agent.run(prompt, sessionId);
    if (result.response?.trim()) {
      if (!this.isActionEnabled('send_message')) {
        this.logger.warn('send_message action is disabled; skipping inbound auto-reply');
        return;
      }
      await this.sendMessage({
        text: result.response,
        chatId: ctxMsg.chat?.id,
        replyToMessageId: ctxMsg.message?.message_id,
      });
    }
  }
}

function resolveConfig(rawConfig: unknown): TelegramPluginConfig {
  const parsed = TelegramPluginConfigSchema.parse(rawConfig || {});

  const readEnv = (key: string): string | undefined => {
    const value = process.env[key];
    return value && value.trim() ? value.trim() : undefined;
  };

  const resolvedToken = parsed.botToken?.trim() || readEnv(parsed.tokenEnv);
  const resolvedDefaultChatId = parsed.defaultChatId?.trim() || readEnv(parsed.defaultChatIdEnv);

  return {
    ...parsed,
    botToken: resolvedToken,
    defaultChatId: resolvedDefaultChatId,
  };
}

const telegramPlugin = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Native Telegram skill with inbound listener and outbound messaging capabilities.',

  register(api: any) {
    const service = new TelegramService(api.pluginConfig, api.logger);

    api.registerService(service);

    api.registerTool({
      name: 'telegram_send',
      description: 'Send a message to a Telegram chat via the configured bot.',
      parameters: TelegramSendSchema,
      execute: async ({ text, chatId, replyToMessageId }: z.infer<typeof TelegramSendSchema>) => {
        if (!service.isReady()) {
          return 'Telegram bot is not connected. Check token/config and restart gateway.';
        }

        service.assertActionEnabled('send_message');

        const result = await service.sendMessage({
          text,
          chatId,
          replyToMessageId,
        });

        return `Sent message ${result.messageId} to chat ${result.chatId}.`;
      },
    });

    api.registerTool({
      name: 'telegram_action',
      description: 'Advanced Telegram actions: send photo, document, poll, edit, delete messages.',
      parameters: TelegramActionSchema,
      execute: async (args: z.infer<typeof TelegramActionSchema>) => {
        if (!service.isReady()) {
          return 'Telegram bot is not connected. Check token/config and restart gateway.';
        }

        service.assertActionEnabled(args.action);

        switch (args.action) {
          case 'send_message': {
            if (!args.text) throw new Error('text is required for send_message');
            const result = await service.sendMessage({
              text: args.text,
              chatId: args.chatId,
            });
            return `Sent message to chat ${result.chatId}.`;
          }

          case 'send_photo': {
            if (!args.photoUrl) throw new Error('photoUrl is required for send_photo');
            const result = await service.sendPhoto({
              chatId: args.chatId,
              photoUrl: args.photoUrl,
              caption: args.text,
            });
            return `Sent photo to chat ${result.chatId}.`;
          }

          case 'send_document': {
            if (!args.documentUrl) throw new Error('documentUrl is required for send_document');
            const result = await service.sendDocument({
              chatId: args.chatId,
              documentUrl: args.documentUrl,
              caption: args.text,
            });
            return `Sent document to chat ${result.chatId}.`;
          }

          case 'send_poll': {
            if (!args.pollQuestion || !args.pollOptions || args.pollOptions.length < 2) {
              throw new Error('send_poll requires pollQuestion and at least 2 pollOptions');
            }
            const result = await service.sendPoll({
              chatId: args.chatId,
              question: args.pollQuestion,
              options: args.pollOptions,
            });
            return `Sent poll to chat ${result.chatId}.`;
          }

          case 'edit_message': {
            if (!args.messageId || !args.text) {
              throw new Error('edit_message requires messageId and text');
            }
            await service.editMessage({
              chatId: args.chatId,
              messageId: args.messageId,
              text: args.text,
            });
            return `Edited message ${args.messageId}.`;
          }

          case 'delete_message': {
            if (!args.messageId) {
              throw new Error('delete_message requires messageId');
            }
            await service.deleteMessage({
              chatId: args.chatId,
              messageId: args.messageId,
            });
            return `Deleted message ${args.messageId}.`;
          }

          default:
            throw new Error(`Unsupported action: ${args.action}`);
        }
      },
    });
  },
};

export default telegramPlugin;
