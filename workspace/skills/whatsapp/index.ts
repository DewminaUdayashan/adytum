/**
 * @file workspace/skills/whatsapp/index.ts
 * @description Native WhatsApp skill for Adytum using @whiskeysockets/baileys.
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import type { Boom } from '@hapi/boom';

const WHATSAPP_ACTIONS = ['send_message', 'send_image', 'send_document', 'presence'] as const;
type WhatsAppAction = (typeof WHATSAPP_ACTIONS)[number];

type WhatsAppLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const WhatsAppActionPermissionsSchema = z.object({
  send_message: z.boolean().default(true),
  send_image: z.boolean().default(true),
  send_document: z.boolean().default(true),
  presence: z.boolean().default(true),
});

const WhatsAppPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sessionName: z.string().default('adytum-whatsapp'),
  sessionPath: z
    .string()
    .optional()
    .describe('Absolute path to store session data. Defaults to ~/.adytum/data/sessions/whatsapp'),
  listenIncoming: z.boolean().default(true),
  respondToGroups: z.boolean().default(false),
  allowedRemoteJids: z.array(z.string()).default([]),
  actionPermissions: WhatsAppActionPermissionsSchema.default({}),
});

type WhatsAppPluginConfig = z.infer<typeof WhatsAppPluginConfigSchema>;

const WhatsAppSendSchema = z.object({
  text: z.string().min(1).describe('Message text to send'),
  recipientId: z
    .string()
    .describe('Target JID (e.g. "1234567890@s.whatsapp.net" or "group-id@g.us")'),
});

const WhatsAppActionSchema = z.object({
  action: z.enum(WHATSAPP_ACTIONS),
  recipientId: z.string().optional(),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  documentUrl: z.string().optional(),
  fileName: z.string().optional(),
  presence: z.enum(['unavailable', 'available', 'composing', 'recording', 'paused']).optional(),
});

class WhatsAppService {
  private sock: WASocket | null = null;
  private agent: any = null;
  private config: WhatsAppPluginConfig;
  private isConnecting = false;

  constructor(
    rawConfig: unknown,
    private logger: WhatsAppLogger,
  ) {
    this.config = resolveConfig(rawConfig);
  }

  get id(): string {
    return 'whatsapp-service';
  }

  isReady(): boolean {
    return this.sock !== null && (this.sock?.ws as any)?.readyState === 1; // 1 = OPEN
  }

  isActionEnabled(action: WhatsAppAction): boolean {
    return this.config.actionPermissions[action] !== false;
  }

  assertActionEnabled(action: WhatsAppAction): void {
    if (this.isActionEnabled(action)) return;
    throw new Error(`WhatsApp action "${action}" is disabled in config.`);
  }

  private getSessionPath(): string {
    if (this.config.sessionPath) return this.config.sessionPath;
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    return join(home, '.adytum', 'data', 'sessions', 'whatsapp', this.config.sessionName);
  }

  async start(ctx: { agent: any }): Promise<void> {
    this.agent = ctx.agent;

    if (!this.config.enabled) {
      this.logger.info('disabled by plugin config');
      return;
    }

    if (this.isConnecting || this.sock) return;

    await this.connect();
  }

  private async connect() {
    this.isConnecting = true;
    const sessionDir = this.getSessionPath();

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this.logger.info(`Starting WhatsApp connection (Baileys v${version.join('.')})...`);

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger as any),
      },
      printQRInTerminal: false, // We'll handle it manually for better logging
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.logger.info('WhatsApp QR Code generated. Scan it with your phone:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.warn(
          `WhatsApp connection closed. Reason: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`,
        );
        this.sock = null;
        this.isConnecting = false;
        if (shouldReconnect) {
          setTimeout(() => this.connect(), 5000);
        }
      } else if (connection === 'open') {
        this.logger.info('WhatsApp connection opened successfully!');
        this.isConnecting = false;
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe) {
            await this.handleIncomingMessage(msg);
          }
        }
      }
    });
  }

  async stop(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.agent = null;
    this.isConnecting = false;
  }

  private async handleIncomingMessage(msg: any) {
    if (!this.agent || !this.config.listenIncoming) return;

    const jid = msg.key.remoteJid;
    if (!jid) return;

    const isGroup = jid.endsWith('@g.us');
    if (isGroup && !this.config.respondToGroups) return;

    if (this.config.allowedRemoteJids.length > 0 && !this.config.allowedRemoteJids.includes(jid)) {
      return;
    }

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption;

    if (!text) return;

    const senderName = msg.pushName || 'Unknown';
    const contextHeader = [
      '[WhatsApp Context]',
      `From: ${senderName} (${jid})`,
      isGroup ? `Group: true` : `Direct: true`,
      `MessageID: ${msg.key.id}`,
    ].join(' | ');

    const prompt = `${contextHeader}\n\n${text}`;
    const sessionId = `whatsapp:${jid}`;

    const result = await this.agent.run(prompt, sessionId);
    if (result.response?.trim()) {
      await this.sendMessage({
        recipientId: jid,
        text: result.response,
      });
    }
  }

  async sendMessage(params: { recipientId: string; text: string }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_message');

    await this.sock.sendMessage(params.recipientId, { text: params.text });
    return { status: 'sent', recipient: params.recipientId };
  }

  async sendImage(params: { recipientId: string; imageUrl: string; caption?: string }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_image');

    await this.sock.sendMessage(params.recipientId, {
      image: { url: params.imageUrl },
      caption: params.caption,
    });
    return { status: 'sent', recipient: params.recipientId };
  }

  async sendDocument(params: {
    recipientId: string;
    documentUrl: string;
    fileName?: string;
    caption?: string;
  }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_document');

    await this.sock.sendMessage(params.recipientId, {
      document: { url: params.documentUrl },
      fileName: params.fileName,
      caption: params.caption,
    });
    return { status: 'sent', recipient: params.recipientId };
  }

  async updatePresence(jid: string, presence: any) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('presence');
    await this.sock.sendPresenceUpdate(presence, jid);
    return { status: 'updated' };
  }
}

function resolveConfig(rawConfig: unknown): WhatsAppPluginConfig {
  return WhatsAppPluginConfigSchema.parse(rawConfig || {});
}

const whatsappPlugin = {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Native WhatsApp skill using Baileys. Requires scanning QR code in terminal.',

  register(api: any) {
    const service = new WhatsAppService(api.pluginConfig, api.logger);

    api.registerService(service);

    api.registerTool({
      name: 'whatsapp_send',
      description: 'Send a text message to a WhatsApp JID.',
      parameters: WhatsAppSendSchema,
      execute: async (args: z.infer<typeof WhatsAppSendSchema>) => {
        return await service.sendMessage(args);
      },
    });

    api.registerTool({
      name: 'whatsapp_action',
      description: 'Perform advanced WhatsApp actions: send images, documents, or update presence.',
      parameters: WhatsAppActionSchema,
      execute: async (args: z.infer<typeof WhatsAppActionSchema>) => {
        service.assertActionEnabled(args.action);

        switch (args.action) {
          case 'send_message':
            if (!args.recipientId || !args.text) throw new Error('recipientId and text required');
            return await service.sendMessage({ recipientId: args.recipientId, text: args.text });

          case 'send_image':
            if (!args.recipientId || !args.imageUrl)
              throw new Error('recipientId and imageUrl required');
            return await service.sendImage({
              recipientId: args.recipientId,
              imageUrl: args.imageUrl,
              caption: args.text,
            });

          case 'send_document':
            if (!args.recipientId || !args.documentUrl)
              throw new Error('recipientId and documentUrl required');
            return await service.sendDocument({
              recipientId: args.recipientId,
              documentUrl: args.documentUrl,
              fileName: args.fileName,
              caption: args.text,
            });

          case 'presence':
            if (!args.recipientId || !args.presence)
              throw new Error('recipientId and presence required');
            return await service.updatePresence(args.recipientId, args.presence);

          default:
            throw new Error(`Unsupported action: ${args.action}`);
        }
      },
    });
  },
};

export default whatsappPlugin;
